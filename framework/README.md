# The Viral App Factory Framework (VAFF)

A repeatable system for turning cultural and technological signals into shipped,
instrumented, monetised applications — and for killing the ones that should not
be built before they consume a quarter.

The framework exists because the expensive failure in consumer app building is
not a bad build. It is a *plausible* concept that survives to launch because no
one was ever required to state, in advance and in numbers, what would make it
false. VAFF makes that statement mandatory at five points.

---

## The five stages

| Stage | Question it answers | Artefact | Executable |
| --- | --- | --- | --- |
| **1. Scan** | What is actually moving, and where do two movements intersect? | `data/signals.json` | `factory scan` |
| **2. Score** | Which concept earns a build, and what is its binding constraint? | `data/concepts.json` | `factory score` |
| **3. Shape** | Does the loop close arithmetically before it closes in code? | Loop model | `factory model` |
| **4. Ship** | Is the loop instrumented from the first commit? | App skeleton | `factory scaffold` |
| **5. Scale** | Do we double down, reshape, or kill? | Gate report | `factory gate` |

Each stage is documented in `docs/` and implemented in `factory/`. The
documentation and the code are the same system: if the two disagree, the code is
the specification and the documentation is the bug.

---

## Why these five and not more

Most innovation frameworks fail in one of two ways. They stay entirely verbal,
so every review becomes a rhetoric contest won by whoever is most senior. Or
they become a stage-gate bureaucracy where the gates measure documents rather
than reality.

VAFF resists both by holding to three rules:

1. **Every gate is falsifiable.** A gate states a number and a threshold. "The
   team feels good about retention" is not a gate; `D7 >= 25%` is.
2. **Absence of evidence fails the gate.** Unsupplied metrics do not pass by
   default. This single rule removes most of the optimism from a pipeline.
3. **The rubric names its own weakest point.** Scoring returns the *binding
   constraint* — the dimension losing the most weighted points — so the next
   action is determined by the score rather than debated after it.

---

## Quick start

```bash
node framework/factory/cli.mjs scan       # what signals were captured, and where
node framework/factory/cli.mjs rubric     # the scoring anchors, in full
node framework/factory/cli.mjs score      # rank every concept in the registry
node framework/factory/cli.mjs model --invites 3.2 --conv 0.18 --cac 12
node framework/factory/cli.mjs gate --id C --invites 3.2 --conv 0.18 --d7 0.29
node framework/factory/cli.mjs scaffold --id C --root apps
```

`npm run test:framework` exercises the rubric, the loop arithmetic, the gates and
the scaffold.

---

## The scoring rubric: VIRAL-M

Six dimensions, each scored 0-5 against published anchors, weighted to a 0-100
index. Run `factory rubric` for the full anchor text.

| Dimension | Weight | What it is really asking |
| --- | --- | --- |
| **V**elocity of signal | 15 | Is the wave still rising, and does the concept sit on more than one? |
| **I**nherent shareability | 25 | Is sharing the product, or a feature bolted onto it? |
| **R**etention hook | 20 | What brings the user back next week without a notification? |
| **A**cquisition economics | 15 | Can each cohort pay for the next? |
| **L**iquidity | 10 | Does the other side of the market already exist? |
| **M**onetization clarity | 15 | Is there a defined payer, moment, and defensible rate? |

Shareability carries the heaviest weight because it is the only dimension that
compounds. A weak retention hook costs a linear amount of money to patch with
notifications and content; a product with nothing worth sharing cannot be made
viral by any amount of spending downstream.

### Decision bands

| Index | Verdict | Action |
| --- | --- | --- |
| 85-100 | fast-track | Fund a full MVP and seed supply in parallel. |
| 70-84 | build-mvp | Build against the standard build spec. Instrument from commit one. |
| 55-69 | iterate | Do not build. Reshape the weakest dimension and re-score. |
| 0-54 | kill | Return the signal to the scan backlog. |

The bands are deliberately asymmetric. The midpoint is not the build threshold,
because building the wrong thing costs a quarter and iterating on a promising
one costs a week.

---

## Current registry status

From scan `scan-2026-001`:

| Concept | Index | Verdict | Binding constraint |
| --- | --- | --- | --- |
| **C — AI-Avatar Commerce** | **82** | **build-mvp** | Retention hook (8 pts) |
| D — Micro-Gig Social Network | 60 | iterate | Inherent shareability (15 pts) |
| A, B — Africa concepts | — | unscored | Premise not captured in the source scan |

Concept C was built. It lives in [`apps/avatar-commerce`](../apps/avatar-commerce).

Concepts A and B are recorded as `reserved` rather than invented. The scoring
engine refuses to produce a number for a concept it has no premise for — an
unscored concept must stay visibly unscored rather than defaulting to zero and
silently ranking last.

---

## Stage gates

| Gate | Threshold | Owner |
| --- | --- | --- |
| G0 Signal validated | Premise and wedge both stated | Research |
| G1 Concept scored | VIRAL-M >= 70 | Product |
| G2 Loop modelled, supply seeded | K >= 0.4 and supply target met | Growth + Operations |
| G3 Instrumented MVP | All six loop events emitted from real code paths | Engineering |
| G4 Retention floor | D7 >= 25% | Product |
| G5 Unit economics | Contribution per user > effective CAC | Finance |

Gates do not compensate for one another. A concept's pipeline position is its
*first* failing gate, however well it performs on later ones.

---

## The six loop events

Every app the factory emits carries the same six event names, so that growth
analysis is comparable across the portfolio:

`signup` · `core_action` · `share` · `share_view` · `referred_signup` · `revenue`

K is computed from these and no others:

```
K = invites per active user (i) x invite conversion (c)
```

Tracking K alone is insufficient — a team that sees K fall from 0.6 to 0.4
cannot tell whether users stopped sharing or shares stopped converting. Those
are different problems with different owners, so the framework always reports
both factors alongside K.

---

## Documentation

| Document | Contents |
| --- | --- |
| [01 — Signal scan](docs/01-signal-scan.md) | How to run a scan and what counts as a convergence |
| [02 — Concept scoring](docs/02-concept-scoring.md) | Applying VIRAL-M without inflating it |
| [03 — Loop design](docs/03-loop-design.md) | Loop patterns and the arithmetic of each |
| [04 — Build spec](docs/04-build-spec.md) | The standard skeleton every factory app starts from |
| [05 — Instrumentation](docs/05-instrumentation.md) | Event contract and metric definitions |
| [06 — Launch playbook](docs/06-launch-playbook.md) | Seeding supply, GTM, and the first 90 days |
| [07 — Governance](docs/07-governance.md) | Gate reviews, kill decisions, and ethics review |
