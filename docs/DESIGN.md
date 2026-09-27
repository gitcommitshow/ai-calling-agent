# Design

Write this after [REQUIREMENTS.md](REQUIREMENTS.md). This file is the technical source of truth. Record the implementation approach and the decisions behind it here so later agent sessions do not drift from what you already chose.

When you change architecture, APIs, or a recorded decision, update this file in the same change.

## Overview

<!-- How the system meets the requirements, in a few paragraphs. -->

## Requirements trace

<!-- Map each requirement or acceptance check to the design that covers it. -->

## Decisions

<!-- Decision, alternatives considered, why this one. Add a date. Do not silently reverse a decision in code. -->

## Interfaces

<!-- Public APIs, tools, events, CLI flags, HTTP routes. Leave blank until the layout exists. -->

## Data and control flow

<!-- What enters the agent, what it calls, what it returns, where state lives. -->

## Error handling

<!-- Timeouts, retries, user-visible failures, what must never be swallowed. -->

## Testing

<!-- What `npm test` covers vs `npm run test:e2e`. No live third-party services in unit/integration tests. -->
