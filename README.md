# Viral App Factory

A repeatable system for turning cultural and technological signals into shipped,
instrumented, monetised applications — and the first application it produced.

```
framework/              The Viral App Factory Framework (VAFF)
apps/avatar-commerce/   Concept C: AI-Avatar Commerce
```

## Quick start

```bash
npm run factory -- score      # rank the concept registry
npm run factory -- gate --id C --invites 3.2 --conv 0.18   # stage gates
npm run seed && npm run demo  # supply + a synthetic cohort
npm start                     # http://localhost:3000
npm test                      # 79 tests, no dependencies
```

Requires Node 22.5+ (for `node:sqlite` and `node:test`). **No runtime or build
dependencies** — nothing to install.

---

## The framework

Five stages, each documented in prose *and* implemented as code. Where the two
disagree, the code is the specification and the documentation is the bug.

| Stage | Question | Command |
| --- | --- | --- |
| **Scan** | What is moving, and where do two movements intersect? | `factory scan` |
| **Score** | Which concept earns a build, and what is its binding constraint? | `factory score` |
| **Shape** | Does the loop close arithmetically before it closes in code? | `factory model` |
| **Ship** | Is the loop instrumented from the first commit? | `factory scaffold` |
| **Scale** | Double down, reshape, or kill? | `factory gate` |

Three rules hold it together:

1. **Every gate is falsifiable.** A gate states a number and a threshold.
2. **Absence of evidence fails the gate.** Unsupplied metrics do not pass by
   default — this alone removes most of the optimism from a pipeline.
3. **The rubric names its own weakest point.** Scoring returns the dimension
   losing the most *weighted* points, so the next action follows from the score
   rather than being debated after it.

Full documentation: [`framework/README.md`](framework/README.md).

---

## What the factory decided

Run against the captured signal scan:

| Concept | Index | Verdict | Binding constraint |
| --- | --- | --- | --- |
| **C — AI-Avatar Commerce** | **82** | **build-mvp** | Retention hook (8 pts) |
| D — Micro-Gig Social Network | 60 | iterate | Inherent shareability (15 pts) |
| A, B — Africa concepts | — | unscored | Premise not captured in the source scan |

Concept D scores below the build threshold for a structural reason, not a
fixable one: a completed tap repair is not a shareable artefact, and hyperlocal
double cold start does not yield to better execution. The rubric is only useful
if it is allowed to say no.

Concepts A and B are recorded as `reserved` rather than invented — the scoring
engine refuses to produce a number for a premise it does not have, so an
unscored concept stays visibly unscored instead of defaulting to zero and
silently ranking last.

---

## What was built

[**AI-Avatar Commerce**](apps/avatar-commerce) — users create AI avatars that
try on clothes from local boutiques and share looks, earning affiliate
commissions.

- **Deterministic local try-on renderer.** Layered SVG, byte-identical for the
  same input, no external model API. A hosted provider slots in behind an
  interface; the local path stays the tested default.
- **A real money path.** Integer minor units, per-currency exponents, bounded
  attribution windows, a self-referral guard, idempotent HMAC-signed order
  webhooks, and an immutable commission ledger. Every control has a test.
- **Honest growth instrumentation.** The six framework events emitted from real
  code paths; K recomputed from both its factors and never stored; D7 over a
  fixed window; previewing deliberately excluded from `core_action` so the
  dashboard cannot flatter itself.
- **A public share page** that renders with no account, because a login wall
  caps invite conversion at the wall rather than at the artefact.

The app's README states its [known gaps](apps/avatar-commerce#known-gaps)
plainly — supply is at 6 boutiques against a gate requirement of 20, and the
seeder says so on every run.
