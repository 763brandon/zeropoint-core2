# 04 — Build Spec

## Purpose

Define the skeleton every factory app starts from, so that portfolio-level
analysis is possible and each new app does not re-litigate the same decisions.

```bash
node framework/factory/cli.mjs scaffold --id C --root apps
```

## Non-negotiables

**1. The six loop events are wired before the first feature.**
Instrumentation added after launch measures a loop that has already been shaped
by guesswork. The scaffold emits `src/events.mjs` with the event names fixed and
a tracker that throws on unknown names — extending the vocabulary must be a
deliberate act, not an incidental one.

**2. Shares are addressable and public.**
Every shareable artefact has a stable public URL that renders without an account.
A share that requires a login to view has a conversion ceiling set by the login
wall rather than by the artefact.

**3. Attribution is bounded and signed.**
Any money-carrying event is attributed through a token with an explicit
expiry, and inbound value events (order webhooks) are signature-verified.
Unbounded attribution windows are indefensible in a partner dispute.

**4. The core action works without a paid third-party API.**
Every factory app ships a local, deterministic implementation of its core
transformation. External model providers sit behind an interface and are
optional. This keeps tests hermetic, keeps demos possible offline, and keeps a
vendor outage from being a product outage.

**5. Money is integer minor units.**
No floats in a ledger, ever. Currency is stored alongside every amount.

## Standard layout

```
apps/<slug>/
  README.md            Premise, wedge, loop, monetization, run instructions
  server.mjs           Entry point
  src/
    db.mjs             Schema and migrations
    events.mjs         The six loop events, fixed
    routes/            One module per resource
    services/          Domain logic, independently testable
    lib/               Framework-agnostic helpers
  seed/                Deterministic seed data for local runs and demos
  public/              Client
  tests/               Domain tests, not just route smoke tests
```

## Test expectations

The gates read numbers, so the numbers must be trustworthy. A factory app is
expected to test, at minimum:

- The core transformation is deterministic given the same input.
- Attribution windows expire and self-attribution is refused.
- Money arithmetic, including rounding, at boundary values.
- Every loop event fires from the real code path, not from a stub.

Route-level smoke tests are not sufficient evidence for G3. A test that asserts
`200 OK` proves the server is running, not that the loop is instrumented.
