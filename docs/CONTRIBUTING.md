# Contributing

How to change this repo without drifting from the sources of truth.

Start with [REQUIREMENTS.md](REQUIREMENTS.md). Then update [DESIGN.md](DESIGN.md) before or with the code. UI changes follow [STYLE_GUIDE.md](STYLE_GUIDE.md). How to run it is in [DEPLOYMENT.md](DEPLOYMENT.md).

## Local setup

```
git clone <this repo> && cd ai-calling-agent
npm ci
cp .env.example .env
npm run seed   # optional example events
npm run dev    # server on port 4000, web on port 3000
```

`npm run dev` loads `.env` when that file exists. To run one app on its own, use `npm run dev --workspace apps/server` or `npm run dev --workspace apps/web`.

There is a sample Luma export at [apps/web/fixtures/luma-sample-guests.csv](../apps/web/fixtures/luma-sample-guests.csv) for trying the import without real guest data.

## Where code goes

This is an npm workspace monorepo with two apps and no shared packages (DESIGN D5).

- `apps/web` owns product rules: CSV mapping, phone normalization, filtering and ordering, eligibility, prompt assembly, campaign templates. They live in `apps/web/src/domain` and stay pure and testable.
- `apps/server` owns the API, storage, the runner, and the telephony, voice, and extraction adapters. It validates everything it is handed and never encodes product policy.
- Two rules are deliberately in both apps: prompt assembly and call eligibility. The web app renders them for the organizer, and the runner enforces them at dial time, because it acts long after the request returned. Change both in the same commit. There is no shared package for them yet (D5).
- The browser talks only to this app's route handlers in `apps/web/src/app/api`, which forward to the server through `apps/web/src/lib/server-api.ts`. Never call the server from a client component.

A module moves to `packages/` only when it has two real consumers or needs its own release cycle.

## Sources of truth

- Product: [REQUIREMENTS.md](REQUIREMENTS.md)
- Technical design and decisions: [DESIGN.md](DESIGN.md)
- Visual UI: [STYLE_GUIDE.md](STYLE_GUIDE.md)
- How it ships: [DEPLOYMENT.md](DEPLOYMENT.md)

Update the matching doc in the same change as the code.

## Tests

- Unit and integration tests live in each workspace under `test/` as `*.test.ts`, use Mocha + Chai + Sinon, and are run by `npm test` from the root. No live third-party services: providers are replaced with fakes. Mocha config is at the repo root in `.mocharc.json`, which excludes the e2e files.
- End-to-end tests that call live APIs are named `*.e2e.test.ts` and are run only by `npm run test:e2e` (config: `.mocharc.e2e.json`). CI never runs them. Any test that spends money or places a call must skip itself unless its own environment variable is set.
- Prefer one happy path and two edge or failure cases per change. More than three at a time is hard to review.

## Pull requests

Before merge: `npm test`, `npm run typecheck`, and `npm run lint` pass, and the docs above match the code. Keep the change inside one phase of the MVP plan in DESIGN.md.

Release-please tags versions from conventional commit messages on `main` (`feat:`, `fix:`, `docs:`). Use that shape if you want automated releases.

## Dependencies

Check the license before adding a package and record the choice in DESIGN D8. Anything not free for commercial use does not go in. Prefer Node built-ins and direct REST or WebSocket calls over vendor SDKs where the surface we need is small.

## Do not

- Do not add a provider SDK where a small REST or WebSocket surface will do (D8).
- Do not let a provider concept escape its adapter folder. Nothing outside `src/telephony` may name Plivo, and nothing outside `src/voice` may name ElevenLabs.
- Do not take a phone number from a request. The runner always reads it from storage by guest id, which is what keeps a number that is not on the list from being called.
- Do not read or write the data folder from the web app; go through the server API.
- Do not put product rules in `apps/server` or persistence in `apps/web`.
- No drive-by refactors or layout changes that are not in DESIGN.md.
