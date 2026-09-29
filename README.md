# ai-calling-agent

An outbound AI calling agent for event organizers. Import a guest list, choose who to call and in what order, write the prompt once, and get a structured result per guest without listening to every call.

**Status: phase 2 of the MVP.** The outbound call loop is built: Plivo dials, an ElevenLabs agent holds the conversation, and the transcript becomes the campaign's fields. Calling needs provider credentials and a public https origin, so it stays off until those are set. See the phase plan in [docs/DESIGN.md](docs/DESIGN.md).

## What works today

- Create an event with its name, start, and end time (entered as IST).
- Import a Luma guest CSV: known columns mapped, approval statuses preserved, custom question columns kept as guest attributes, guests without a callable Indian number skipped and counted.
- Filter guests by approval status, ticket type, and free text; select a subset; order the call queue; save it per campaign.
- Edit a campaign: prompt with placeholders, conversation language, fields to capture, calling window, attempts per guest. The prompt preview is the exact text a call uses.
- See per-guest eligibility with the reason a guest cannot be called yet.
- Call one guest, or run the saved queue one guest at a time, and stop it mid-run.
- Watch a run live: who is on the phone, how far through the queue it is, and which guests were skipped and why.
- Read per-attempt results: the call's timeline, the transcript, the captured fields, and the outcome.

## How a call works

Our server always sits between the phone call and the voice backend, which is what makes the voice approaches swappable (DESIGN D1).

1. The runner re-checks the guardrails, then dials through Plivo. The number is always read from storage by guest id, so a number that is not on the list can never be called.
2. When the guest answers, Plivo streams the call audio to the server over a WebSocket.
3. The server bridges that audio to an ElevenLabs agent session, overriding its prompt and language with the campaign's, and saves transcript turns as they arrive.
4. When the call ends, the end reason becomes the outcome, and one extraction step fills in the campaign's fields. Anything unclear is stored as `unknown`.

Call audio is relayed and dropped. Only the transcript is kept.

## Layout

npm workspaces, two apps, no shared packages yet (DESIGN D5).

```
apps/server   Node HTTP API and JSON file storage. Owns the data folder.
apps/web      Next.js organizer UI. Owns the product rules in src/domain.
docs/         Requirements, design, style guide, contributing, deployment.
```

The browser talks only to the web app's route handlers, which forward to the server. The server is the only process that reads or writes `data/`.

## Run it

```
npm ci
cp .env.example .env
npm run seed   # optional example events
npm run dev    # server http://127.0.0.1:4000, web http://localhost:3000
```

`npm run dev` loads `.env` when that file exists, then starts both apps. Shell variables win over `.env`. To run one app on its own, use `npm run dev --workspace apps/server` or `npm run dev --workspace apps/web`.

A sample Luma export to import is at [apps/web/fixtures/luma-sample-guests.csv](apps/web/fixtures/luma-sample-guests.csv).

Everything except calling works with no credentials. The server logs which variables are still missing on start, and `GET /health` reports the same list. To work on the run loop with no carrier and no provider spend, set `TELEPHONY_PROVIDER=fake` and `VOICE_PROVIDER=fake`: calls are simulated end to end and nothing is dialed. For real calls, or to install on a Linux VM, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Docs

- Product: [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)
- Technical design and decisions: [docs/DESIGN.md](docs/DESIGN.md)
- Visual UI: [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md)
- How to contribute: [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)
- How it runs and ships: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the API server and the web app for local development, loading `.env` when it exists. |
| `npm run build` | Build the web app for production. |
| `npm start` | Start the API server and the built web app, loading `.env` when it exists. |
| `npm test` | Mocha on `test/**/*.test.ts` in every workspace. No live services. |
| `npm run test:e2e` | Live-provider tests (`*.e2e.test.ts`). CI does not run these. |
| `npm run typecheck` | `tsc --noEmit` per workspace. |
| `npm run lint` | ESLint across `apps/`. |
| `npm run seed` | Write example events, guests, and attempts into the server's data folder. |

Per workspace, add `--workspace apps/server` or `--workspace apps/web`.

## Tests

Unit and integration tests live in `apps/*/test`, run under Mocha with Chai and Sinon, and cover CSV mapping, phone normalization, filtering and ordering, eligibility rules, the storage write guarantees, the runner's queue loop, and the Plivo adapter's translation. Providers are always replaced with fakes; CI runs `npm test` only.

One live test places a real call:

```
E2E_TEST_NUMBER=+919876543210 npm run test:e2e --workspace apps/server
```

It skips itself unless that number and the provider credentials are set, so nobody triggers a call by accident.

## API surface

The server exposes JSON over HTTP for the web app:

```
GET  /health
GET  /events                          POST /events
GET  /events/:id                      PUT  /events/:id
GET  /events/:id/guests               POST /events/:id/guests/import
GET  /events/:id/campaigns            POST /events/:id/campaigns
GET  /campaigns/:id                   PUT  /campaigns/:id
GET  /events/:id/attempts             GET  /events/:id/summary
POST /campaigns/:id/calls             POST /campaigns/:id/runs
GET  /runs/:id                        POST /runs/:id/stop
GET  /events/:id/runs
```

`POST /campaigns/:id/calls` calls one guest and `POST /campaigns/:id/runs` works the saved queue. Both answer 202 with a run to follow, and both read every number from storage by guest id. The server runs one call at a time and refuses a second run with 409.

Plivo also reaches `POST /telephony/plivo/{answer,ring,hangup}/:attemptId` and the audio socket at `/telephony/plivo/stream/:attemptId`. Those are defined by the telephony adapter, are signature-checked, and are not for the web app.
