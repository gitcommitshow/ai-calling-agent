# ai-agent-template

---

## About the template

This is a hygiene-only starter to build AI agent projects with AI Native Development approach. It is not an agent framework and it does not pick a repo layout.

Use it to skip the first hour of setup: GitHub Actions, TypeScript tooling, test conventions, and structured docs. You add the agent stack and the folder layout.

### Features

- Private root `package.json` for tooling only. No `src/`, no `packages/`, no `apps/`.
- TypeScript, ESLint 10, node:test, Chai, and Sinon. `npm test`, `typecheck`, and `lint` succeed with no source.
- GitHub Actions: unit tests on push/PR, release-please, npm publish with provenance, optional `@claude`.
- Docs stubs: requirements, design, style guide, contributing, and deployment.
- `.env.example` with generic API key placeholders.
- Single-package publish/release defaults, with notes for a later `packages/` + `apps/` workspace.

### What this is not

- Not a CLI, HTTP service, or npm library skeleton
- Not LangGraph, the Vercel AI SDK, or any other agent loop
- Not a `packages/` + `apps/` monorepo (and not a root `src/` app either)

## How to use this template

### First-clone checklist

- [ ] Create a repo from this template and clone it.
- [ ] Change the title and overview at the top of this README to the project.
- [ ] Rename the root `name` in `package.json` to your project. Keep `"private": true` until you intentionally publish.
- [ ] Set the GitHub Actions secrets you will actually use.
- [ ] Draft [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) and keep it current. That file is the product source of truth.
- [ ] Draft [docs/DESIGN.md](docs/DESIGN.md) from those requirements. That file is the technical source of truth so later agent sessions do not drift.
- [ ] Fill [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md) if the project has a UI.
- [ ] Set the GitHub Actions secrets you will actually use.
- [ ] Fill [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) with how you want changes made.
- [ ] Start building features one by one with the help of your coding agent or creating issues in GitHub and assign them to `claude` .
- [ ] Fill [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) when the project ships somewhere. Write "local-only" if it does not.
- [ ] Delete the "about the template". Keep or rewrite everything under "Project scaffolding".



### Repo layout

This template does not scaffolds repo layout.

If you're working with javascript/typescript project, you may try one of the following layout.

**Single package.** Add `src/` and `test/` at the repo root. `publish.yml` and release-please (`release-type: node`) already assume this shape. Before the publish workflow can succeed: set `"private": false` in `package.json`, set a unique npm `name`, and configure npm trusted publishing for that package.

**Monorepo (**`packages/` **+** `apps/`**).** Add those folders, then turn the root into an npm or pnpm workspace. Keep the root `"private": true` and never publish it. Replace the root `release-type: node` config with a [multi-package release-please manifest](https://github.com/googleapis/release-please#manifest-driven-release). Stop publishing the root. Point `publish.yml` at workspace packages. Root `npm test` / `typecheck` / `lint` only look at root `src/` and `test/`. Wire workspace scripts when you add packages.

### Template secrets

`test.yml` is the only workflow you need on day one. The others stay as single-package defaults.

Create `RELEASE_PLEASE_PAT` as a GitHub Actions secret holding a PAT that can open release PRs. Skip `ANTHROPIC_API_KEY` until you want `@claude` on issues and PRs.

---



## Project scaffolding

Keep what still matches. Rewrite the rest for the project. You do not have to delete this heading.

### Features



### Docs

- Product: [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)
- Technical design: [docs/DESIGN.md](docs/DESIGN.md)
- Visual UI: [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md)
- How to contribute: [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)
- How it ships: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)



### Scripts


| Script              | What it does                                                                           |
| ------------------- | -------------------------------------------------------------------------------------- |
| `npm test`          | `node --test` on `test/**/*.test.ts`, excluding `*.e2e.test.ts`.                       |
| `npm run test:e2e`  | `node --test` on `test/**/*.e2e.test.ts`. CI does not run this.                        |
| `npm run typecheck` | `tsc --noEmit`. Add `src/` or `test/` TypeScript before this is useful.                |
| `npm run lint`      | ESLint on `src/` and `test/` if those folders exist.                                   |


Dev dependencies are TypeScript, Chai, Sinon, ESLint, and typescript-eslint. Tests run on Node's built-in test runner. No model SDKs until you add them.

### Tests

- Unit and integration tests live under `test/` as `*.test.ts` and are run by `npm test` (no live third-party services).
- End-to-end tests that call live APIs live under `test/` as `*.e2e.test.ts` and are run only by `npm run test:e2e`.
- CI runs `npm test` only.



### GitHub Actions


| Workflow                                                                       | When it runs                           | Required secret                                                                              |
| ------------------------------------------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `[.github/workflows/test.yml](.github/workflows/test.yml)`                     | Push and PR to `main`                  | None                                                                                         |
| `[.github/workflows/release-please.yml](.github/workflows/release-please.yml)` | Push to `main`                         | `RELEASE_PLEASE_PAT`                                                                         |
| `[.github/workflows/publish.yml](.github/workflows/publish.yml)`               | GitHub release created                 | [npm trusted publishing (OIDC)](https://docs.npmjs.com/trusted-publishers), not an npm token |
| `[.github/workflows/claude.yml](.github/workflows/claude.yml)`                 | `@claude` comments or a `claude` label | `ANTHROPIC_API_KEY` (optional)                                                               |


