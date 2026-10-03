# Deployment

How to run this system: locally, on any Linux VM, and the extra steps an exe.dev VM needs. This file does not pick a host. Keep it current so a later agent session can start or stop the system from it without guessing.

## What ships

Two private workspace apps run side by side:

- `apps/server`: Node HTTP API on port `4000`, owns the data folder, the telephony callbacks, and the call audio socket.
- `apps/web`: Next.js organizer UI on port `3000`. It reaches the server only from its own server-side code.

The browser never talks to the API. Next.js server-side code does, over `SERVER_URL`. Bind the API to loopback (`HOST=127.0.0.1`) so the JSON API is not on the network.

Plivo has to reach this machine over public https for callbacks and the call audio WebSocket (`wss://.../telephony/plivo/stream/:attemptId`). Put a reverse proxy in front that forwards only those telephony paths (and `/health` if you want) to the API, and the organizer UI to Next.js. Do not proxy the rest of the API.

The product has no login. Access control is whatever the host provides in front of the UI.

The root package stays private and is never published.

## Environments

One organizer, one deployment, many events. Phase 1 tenancy is one organizer per process and data folder.

## Config and secrets

Copy `.env.example` to `.env`.

Everything except calling works with none of this set. The server logs the missing variables on start, `GET /health` returns the same list, and the calling endpoints answer 503 naming them.

| Variable | Used by | Default |
| --- | --- | --- |
| `PORT` | server | `4000` |
| `HOST` | server | `127.0.0.1` |
| `DATA_DIR` | server | `./data` relative to `apps/server` |
| `WEB_PORT` | web | `3000` |
| `SERVER_URL` | web | `http://127.0.0.1:4000` |

Calling, all server-side only:

| Variable | Used by | Default |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | telephony callbacks and audio socket | `http://HOST:PORT`, which is not enough for real calls. Use the public https origin with no trailing slash. |
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
| `ELEVENLABS_AGENT_ID` | [Agents](https://elevenlabs.io/app/conversational-ai). Open the agent. The id is the last segment of `.../conversational-ai/agents/<id>`. On the agent's **Security** tab, enable overrides for **System prompt** and **Language**. Without those, every live call is rejected as soon as we send the campaign script. | [Overrides](https://elevenlabs.io/docs/eleven-agents/customization/personalization/overrides). The server connects with a [signed URL](https://elevenlabs.io/docs/eleven-agents/customization/authentication), so the agent can stay private. |
| `OPENROUTER_API_KEY` | [OpenRouter keys](https://openrouter.ai/keys). This is the default extraction key. | [Quickstart](https://openrouter.ai/docs/quickstart) |
| `OPENAI_API_KEY` | [OpenAI API keys](https://platform.openai.com/api-keys) | Used only when `EXTRACTION_PROVIDER=openai`. |
| `ANTHROPIC_API_KEY` | [Anthropic API keys](https://console.anthropic.com/settings/keys) | Used only when `EXTRACTION_PROVIDER=anthropic`. |
| `GOOGLE_API_KEY` | [Google AI Studio API keys](https://aistudio.google.com/apikey) | Used only when `EXTRACTION_PROVIDER=google`. |

Provider credentials live only in the server environment. They are never sent to the web app and never written into `data/`.

The settings page reads the ElevenLabs agent's End call tool and can turn it on or off. That tool is what lets the agent hang up. The campaign prompt cannot do it alone. The page needs `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` for that card. A missing key leaves the card visible and uneditable.

`data/` is gitignored. It holds guest phone numbers and transcripts, so treat a copy of it as guest data, not as a fixture. Call audio is relayed and dropped, never written.

`openrouter/free` routes to whichever free model is available, which is rate limited and varies in quality. It is the right default for development and the live-call test. Point `EXTRACTION_MODEL` at a paid model before running a real campaign.

## Run it locally

```
npm ci
cp .env.example .env
npm run seed   # optional example data
npm run dev    # server on port 4000, web on port 3000
```

Then open `http://localhost:3000`. `npm run dev` loads `.env` when that file exists and starts both apps. Shell variables win over `.env`. To run one app on its own, use `npm run dev --workspace apps/server` or `npm run dev --workspace apps/web`.

### Without dialing anything

To work on the run loop with no carrier and no provider spend:

```
TELEPHONY_PROVIDER=fake VOICE_PROVIDER=fake npm run dev
```

The fake carrier answers immediately and the fake backend speaks a scripted exchange, so runs, attempts, timelines, and extraction all behave as they would on a real call. No number is dialed.

### With real calls on this machine

Plivo has to reach the server, so it needs a public https origin. Locally that means a tunnel to the API port.

1. Start a tunnel to the server port and copy the https URL it gives you.
2. Set `PUBLIC_BASE_URL` to exactly that origin, with no trailing slash. The Plivo signature is checked against that origin plus the POST body, so a mismatch shows up as 403 on every callback.
3. Set the Plivo, ElevenLabs, and extraction variables from [Where to copy each value](#where-to-copy-each-value).
4. Restart the server and check `GET /health` reports `calling.ready`.
5. Place one call to your own number from a campaign page, or the pipeline test page, before running a queue.

The audio socket is derived from the same origin, so a tunnel that does not forward WebSockets will connect the call and then carry no audio.

### Production build on this machine

```
npm ci
cp .env.example .env
npm run build
npm start
```

`npm start` loads `.env` when that file exists, then runs the API and `next start`. Shell variables win over `.env`. The site listens on `WEB_PORT` (default 3000). `PORT` stays the API on 4000. Ctrl+C stops both.

## Linux VM

Need Node 24 (`engines` in the root `package.json`). On Debian or Ubuntu, if `node -v` is missing or below 24:

```
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
```

Clone the repo, then from the clone directory:

```
npm ci
cp .env.example .env
chmod 600 .env
```

Edit `.env`:

```
HOST=127.0.0.1
PORT=4000
WEB_PORT=3000
SERVER_URL=http://127.0.0.1:4000
PUBLIC_BASE_URL=https://your-public-hostname
```

Set Plivo, ElevenLabs, and extraction from [Where to copy each value](#where-to-copy-each-value). `PUBLIC_BASE_URL` is the https origin Plivo is told to call: no trailing slash, no extra port unless that port is part of the public URL. Do not commit `.env`.

Build and keep both apps running across disconnects and reboots (systemd is one way; any supervisor that restarts `npm start` is fine):

```
npm run build
sudo tee /etc/systemd/system/calling-agent.service <<EOF
[Unit]
Description=AI calling agent
After=network.target

[Service]
Type=simple
WorkingDirectory=$(pwd)
EnvironmentFile=$(pwd)/.env
ExecStart=$(which npm) start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now calling-agent
```

Stop with `sudo systemctl stop calling-agent`. Do not restart mid-run. Live attempts are closed as interrupted.

### Reverse proxy

Terminate TLS at nginx (or equivalent) on the public https port. Forward the organizer UI to Next.js and only telephony (plus optional health) to the API. WebSocket upgrade is required on `/telephony/` or calls ring with no audio.

```
server {
    listen 443 ssl;
    server_name your-public-hostname;

    # TLS certificates: use whatever this host already uses (certbot, Caddy, etc.)

    location /telephony/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location /health {
        proxy_pass http://127.0.0.1:4000;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Put host access control in front of `location /` (VPN, firewall, reverse-proxy auth). Leave `/telephony/` reachable from the internet so Plivo can POST and open the audio socket without logging in.

Check `https://your-public-hostname/health` for `calling.ready`. Then open the UI, set a test number in Settings, and place a pipeline test before any guest queue.

### After a code change

```
git pull
npm ci
npm run build
sudo systemctl restart calling-agent
```

## exe.dev

Same as [Linux VM](#linux-vm), with these host facts:

- The VM is reachable over SSH as `<vm>.exe.xyz`. Create one with `ssh exe.dev new --name <vm>`, then `ssh <vm>.exe.xyz`.
- The [GitHub integration](https://exe.dev/docs/integrations/github) avoids a personal access token on every VM when cloning.
- The default exeuntu image may not include Node 24. Install it with the commands in [Linux VM](#linux-vm).
- exe.dev terminates TLS and proxies `https://<vm>.exe.xyz/` to one port on the VM (default `8000`). Ports `3000`-`9999` are also reachable as `https://<vm>.exe.xyz:<port>/`, but only for people with access to the VM. Only one port can be marked public (`share set-public`).

Plivo cannot log into exe.dev, so the public origin must be telephony-only. Keep the organizer UI on the private port so exe.dev login stays the access control.

1. Listen nginx on `127.0.0.1:8000` with only `/telephony/` and `/health` proxied to the API (same `location` blocks as above, `listen 127.0.0.1:8000`, and `location / { return 404; }`). Do not put Next.js on this public port.

2. From your laptop:

```
ssh exe.dev share port <vm> 8000
ssh exe.dev share set-public <vm>
```

3. Set `PUBLIC_BASE_URL=https://<vm>.exe.xyz` with no trailing slash and no `:8000`.

4. Leave `WEB_PORT=3000` private. The organizer UI is `https://<vm>.exe.xyz:3000` for anyone [shared on the VM](https://exe.dev/docs/features/sharing).

5. Health check: `curl -sS https://<vm>.exe.xyz/health`. Then open the UI on port 3000 and run a pipeline test.

## Release path

Release-please still tags versions from conventional commits on `main`. `publish.yml` stays inactive because no workspace is publishable. Shipping to a VM is pull, `npm ci`, `npm run build`, and restart of the process that runs `npm start`.

## Rollback

Stop the process (`sudo systemctl stop calling-agent` if you used the unit above). Data lives in plain JSON files under `DATA_DIR`, one folder per event, so restoring is a file copy. Keep a copy of that folder before an upgrade that changes record shapes. Then check out the previous git revision, `npm ci`, `npm run build`, and start again.

## Health and logs

- Server: `GET /health` (on the public origin, if you proxied it) returns `{"ok":true,"calling":{"ready":...,"missing":[...]}}`. On start it logs its port, data folder, chosen adapters, and anything missing. With the systemd unit: `journalctl -u calling-agent -f`.
- The runner logs one line per attempt with its outcome, and one line per skipped guest with the reason.
- Web: Next.js logs go to the same process. If a page shows "cannot reach the server", the API process is down or `SERVER_URL` is not the loopback API URL.

## Do not

- Do not run two server processes against one data folder. The design assumes a single writer (DESIGN D4), and both would try to run calls.
- Do not commit `data/` or a real guest CSV.
- Do not bind the API to a public interface. The full JSON API would then be on the internet.
- Do not reverse-proxy the JSON API to the public origin. Only `/telephony/` (and `/health` if you want) should reach the API from outside.
- Do not set `PLIVO_VERIFY_SIGNATURE=false` on a public origin. It exists for local debugging of callback bodies.
- Do not restart the server mid-run expecting it to carry on. Live attempts are closed as interrupted and the organizer starts again.
