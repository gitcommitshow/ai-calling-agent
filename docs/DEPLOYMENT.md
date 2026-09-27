# Deployment

**Still local-only.** Nothing is hosted and nothing is published. Phase 2 changes one thing: real calls need the telephony provider to reach this machine, so the server now needs a public https origin even when it runs locally.

Keep this file current. A later agent session should be able to start or stop the system from it without guessing.

## What ships

Nothing yet. Two private workspace apps run side by side:

- `apps/server`: Node HTTP API on `http://127.0.0.1:4000`, owns the data folder, the telephony callbacks, and the call audio socket.
- `apps/web`: Next.js organizer UI on `http://localhost:3000`, reaches the server only from its own server-side code.

The root package stays private and is never published.

## Environments

Local only. One organizer, one deployment, many events. Access control comes from the host environment, not the product, so do not expose either port to a network beyond the tunnel described below.

## Config and secrets

Copy `.env.example` to `.env`.

Everything except calling works with none of this set. The server logs the missing variables on start, `GET /health` returns the same list, and the calling endpoints answer 503 naming them.

| Variable | Used by | Default |
| --- | --- | --- |
| `PORT` | server | `4000` |
| `HOST` | server | `127.0.0.1` |
| `DATA_DIR` | server | `./data` relative to `apps/server` |
| `SERVER_URL` | web | `http://127.0.0.1:4000` |

Calling, all server-side only:

| Variable | Used by | Default |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | telephony callbacks and audio socket | `http://HOST:PORT`, which is not enough for real calls |
| `TELEPHONY_PROVIDER` | adapter choice: `plivo` or `fake` | `plivo` |
| `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN` | Plivo REST and callback signatures | none |
| `PLIVO_CALLER_ID` | the number calls come from | none |
| `PLIVO_VERIFY_SIGNATURE` | reject unsigned callbacks | `true` |
| `VOICE_PROVIDER` | adapter choice: `elevenlabs` or `fake` | `elevenlabs` |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` | the agent session | none |
| `EXTRACTION_PROVIDER`, `EXTRACTION_MODEL` | which model reads transcripts | `openrouter`, `openrouter/free` |
| `EXTRACTION_API_KEY` | that provider's key; falls back to `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_API_KEY` | none |
| `MAX_CALL_SECONDS` | hard cap per call | `240` |
| `SILENCE_SECONDS` | hang up after this much guest silence | `20` |
| `DIAL_TIMEOUT_SECONDS` | give up on an unanswered call | `45` |

### Where to copy each value

Each link opens the page that holds the value, or the doc for the one step that usually blocks a first call.

| Variable | Web app | Docs |
| --- | --- | --- |
| `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN` | [Plivo dashboard](https://console.plivo.com/dashboard/). The Auth ID is on the page. Reveal the Auth Token with the eye icon. | [How API requests are authenticated](https://www.plivo.com/docs/programmable-api/verify/api-overview) |
| `PLIVO_CALLER_ID` | [Phone numbers](https://console.plivo.com/phone-numbers/). Buy a number with Voice, then paste it in E.164. | [Renting numbers](https://www.plivo.com/docs/numbers). India outbound calls must use a Plivo-rented Indian number: [India compliance](https://www.plivo.com/docs/numbers/compliance). |
| `PLIVO_VERIFY_SIGNATURE` | Leave `true`. | [Signature validation](https://www.plivo.com/docs/voice/concepts/signature-validation) |
| `ELEVENLABS_API_KEY` | [API keys](https://elevenlabs.io/app/settings/api-keys). Allow Agents (Conversational AI). A text-to-speech-only key cannot open a call. | [Agents quickstart](https://elevenlabs.io/docs/eleven-agents/quickstart) |
| `ELEVENLABS_AGENT_ID` | [Agents](https://elevenlabs.io/app/conversational-ai). Open the agent. The id is the last segment of `.../conversational-ai/agents/<id>`. | [Agents quickstart](https://elevenlabs.io/docs/eleven-agents/quickstart). The server connects with a [signed URL](https://elevenlabs.io/docs/eleven-agents/customization/authentication), so the agent can stay private. |
| `OPENROUTER_API_KEY` | [OpenRouter keys](https://openrouter.ai/keys). This is the default extraction key. | [Quickstart](https://openrouter.ai/docs/quickstart) |
| `OPENAI_API_KEY` | [OpenAI API keys](https://platform.openai.com/api-keys) | Used only when `EXTRACTION_PROVIDER=openai`. |
| `ANTHROPIC_API_KEY` | [Anthropic API keys](https://console.anthropic.com/settings/keys) | Used only when `EXTRACTION_PROVIDER=anthropic`. |
| `GOOGLE_API_KEY` | [Google AI Studio API keys](https://aistudio.google.com/apikey) | Used only when `EXTRACTION_PROVIDER=google`. |

Provider credentials live only in the server environment. They are never sent to the web app and never written into `data/`.

`data/` is gitignored. It holds guest phone numbers and transcripts, so treat a copy of it as guest data, not as a fixture. Call audio is relayed and dropped, never written.

`openrouter/free` routes to whichever free model is available, which is rate limited and varies in quality. It is the right default for development and the live-call test. Point `EXTRACTION_MODEL` at a paid model before running a real campaign.

## Run it locally

```
npm ci
npm run seed --workspace apps/server   # optional example data
npm run dev --workspace apps/server    # terminal 1
npm run dev --workspace apps/web       # terminal 2
```

Then open `http://localhost:3000`.

### Without dialing anything

To work on the run loop with no carrier and no provider spend:

```
TELEPHONY_PROVIDER=fake VOICE_PROVIDER=fake npm run dev --workspace apps/server
```

The fake carrier answers immediately and the fake backend speaks a scripted exchange, so runs, attempts, timelines, and extraction all behave as they would on a real call. No number is dialed.

### With real calls

Plivo has to reach the server, so it needs a public https origin. Locally that means a tunnel.

1. Start a tunnel to the server port and copy the https URL it gives you.
2. Set `PUBLIC_BASE_URL` to exactly that origin, with no trailing slash. The Plivo signature is verified against it, so a mismatch shows up as 403 on every callback.
3. Set the Plivo, ElevenLabs, and extraction variables from [Where to copy each value](#where-to-copy-each-value).
4. Restart the server and check `GET /health` reports `calling.ready`.
5. Place one call to your own number from a campaign page before running a queue.

The audio socket is derived from the same origin (`wss://.../telephony/plivo/stream/:attemptId`), so a tunnel that does not forward WebSockets will connect the call and then carry no audio.

## Release path

None yet. Release-please still tags versions from conventional commits on `main`; `publish.yml` stays inactive because no workspace is publishable. Before anything ships, record the host and the process here first.

## Rollback

Stop both processes. Data lives in plain JSON files under `DATA_DIR`, one folder per event, so restoring is a file copy. Keep a copy of that folder before an upgrade that changes record shapes.

## Health and logs

- Server: `GET /health` returns `{"ok":true,"calling":{"ready":...,"missing":[...]}}`. On start it logs its port, data folder, chosen adapters, and anything missing.
- The runner logs one line per attempt with its outcome, and one line per skipped guest with the reason.
- Web: Next.js dev server logs to its terminal. If a page shows "cannot reach the server", the server process is down or `SERVER_URL` is wrong.

## Do not

- Do not run two server processes against one data folder. The design assumes a single writer (DESIGN D4), and both would try to run calls.
- Do not commit `data/` or a real guest CSV.
- Do not expose the server port directly to the internet. Only the telephony callback paths need to be reachable, and only over the tunnel or host origin in `PUBLIC_BASE_URL`.
- Do not set `PLIVO_VERIFY_SIGNATURE=false` anywhere reachable from the internet. It exists for local debugging of callback bodies.
- Do not restart the server mid-run expecting it to carry on. Live attempts are closed as interrupted and the organizer starts again.
