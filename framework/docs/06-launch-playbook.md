# 06 — Launch Playbook

## Sequencing

Supply first, loop second, spend third. Reversing this order is the most common
and most expensive launch error in two-sided consumer products: paid acquisition
into a market with no supply converts a fixable liquidity problem into a
permanent reputation one.

## Phase 0 — Seed supply (before any user acquisition)

For concept C this is 15-25 boutiques in a single city, onboarded by hand.

- Manual onboarding is correct at this stage. Automating partner onboarding
  before you know what partners need is premature optimisation of a process you
  do not yet understand.
- Each partner needs: catalogue, commission rate, payout terms, and a named
  contact who has agreed to the attribution model in writing.
- Gate G2 does not clear until the supply target is met. This is enforced in
  code, not in judgement.

## Phase 1 — Closed loop test (weeks 1-4)

Target: 200-500 seeded users in the launch city.

Measure `i`, `c`, cycle time and D7. Do not optimise anything yet — four weeks
of unmodified baseline is worth more than four weeks of uncontrolled
experimentation, because without a baseline no later experiment has a control.

The one thing to fix immediately is a broken artefact: if shared looks render
poorly on the platforms people actually paste them into, nothing downstream is
measurable.

## Phase 2 — Loop optimisation (weeks 5-10)

Work the binding factor identified by `factory model`, one at a time:

| If the constraint is | Work on |
| --- | --- |
| Invite volume (`i`) | Share surface placement, the moment of prompt, number of shareable artefacts per session |
| Conversion (`c`) | The public share page: load speed, immediate try-it-yourself affordance, signup friction |
| Cycle time | Time from signup to first shareable artefact |

Change one variable per two-week window. Overlapping experiments in a loop
produce results that cannot be attributed to either change.

## Phase 3 — Paid assist (week 11+)

Only once the loop is measured. With a sub-unity loop, paid acquisition is
valued at the effective CAC — paid CAC divided by the amplification factor. At
K = 0.576, a $12 CAC is really $5.09, which may change the channel decision
entirely.

Do not spend against an unmeasured loop. The amplification factor is the whole
argument for the spend, and an unmeasured amplification factor is an assumption.

## Compliance and disclosure

For concept C specifically, and any affiliate-carrying app generally:

- **Affiliate disclosure** must be persistent on every shared artefact and at
  the point of click, not buried in terms. This is a legal requirement in most
  target markets and a trust requirement in all of them.
- **Renders are labelled illustrative.** A generated try-on is not a photograph
  of the product on the buyer. Real product imagery must be shown alongside.
- **Likeness consent.** Avatars are user-parameterised and stylised by default.
  Any feature deriving an avatar from a real person's photograph requires
  explicit, revocable, separately-obtained consent.
- **No automatic body idealisation.** Body parameters are user-set and never
  silently adjusted toward a norm. This is a product ethics line, and it is also
  the difference between a fashion tool and a body-image harm.

## First 90 days — what success looks like

| Metric | Floor | Note |
| --- | --- | --- |
| Seeded boutiques | 20 | Gate G2 |
| K | 0.4 | Gate G2. Below this there is no loop to optimise. |
| D7 | 25% | Gate G4 |
| Attributed orders | Non-zero and reconciled | Proves the ledger, not the volume |
| Contribution > effective CAC | Yes | Gate G5 |

Missing a floor is not automatically a kill. Missing a floor with no identified
cause and no next experiment is.
