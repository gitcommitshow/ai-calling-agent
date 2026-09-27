# Deployment

Fill this in when the project ships somewhere. If it is local-only, write that here and stop.

Keep this file current. A later agent session should be able to release or roll back from it without guessing.

This is not a stack choice. Record what you actually deploy after you pick a layout and a host.

## What ships

<!-- npm package, CLI binary, HTTP service, worker, or nothing yet. -->

## Environments

<!-- local, staging, production. URLs, accounts, who can promote. -->

## Config and secrets

<!-- Env vars beyond `.env.example`. Where they are stored. What must never be committed. -->

## Release path

<!-- How a change reaches users. Default single-package path: release-please on `main`, then `publish.yml` on the GitHub release. -->

<!-- Monorepo: deploy or publish inner `packages/` and `apps/`, never the private root. -->

## Rollback

<!-- How to undo a bad release. Previous package version, previous image, feature flag. -->

## Health and logs

<!-- How you know it is up. Where logs and traces live. What to check first. -->

## Do not

<!-- One-off deploy steps that exist only in someone's head. Deploy from this file or change this file. -->
