# Contributing

How to change this repo without drifting from the sources of truth.

Start with [REQUIREMENTS.md](REQUIREMENTS.md). Then update [DESIGN.md](DESIGN.md) before or with the code. If the project has a UI, follow [STYLE_GUIDE.md](STYLE_GUIDE.md). If it ships, follow [DEPLOYMENT.md](DEPLOYMENT.md).

## Local setup

<!-- Clone, `npm ci`, copy `.env.example` to `.env`. Add project-specific steps only when they exist. -->

## Sources of truth

- Product: [REQUIREMENTS.md](REQUIREMENTS.md)
- Technical design and decisions: [DESIGN.md](DESIGN.md)
- Visual UI: [STYLE_GUIDE.md](STYLE_GUIDE.md)
- How it ships: [DEPLOYMENT.md](DEPLOYMENT.md)

Update the matching doc in the same change as the code.

## Tests

- Unit and integration tests live under `test/` as `*.test.ts`, use `node:test` + Chai + Sinon, and are run by `npm test`. No live third-party services.
- End-to-end tests that call live APIs live under `test/` as `*.e2e.test.ts` and are run only by `npm run test:e2e`.
- Prefer one happy path and two edge or failure cases per change.

## Pull requests

<!-- What must be true before merge: `npm test`, `npm run typecheck`, `npm run lint`, docs updated. -->

Release-please tags versions from conventional commit messages on `main` (`feat:`, `fix:`, `docs:`). Use that shape if you want automated releases.

## Dependencies

<!-- Check the license before adding a package. Do not add a dependency that is not free for commercial use unless that is an explicit, recorded decision. -->

## Do not

<!-- Drive-by refactors, new agent stacks, or layout changes that are not in DESIGN.md. -->
