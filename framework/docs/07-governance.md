# 07 — Governance

## The gate review

One meeting per gate. Thirty minutes. Three possible outcomes and no others:
**advance**, **iterate**, **kill**.

"Continue and revisit next month" is not an outcome. It is the absence of a
decision, and it is how a portfolio accumulates projects that no one believes in
but no one has ended.

```bash
node framework/factory/cli.mjs gate --id C \
  --invites 3.2 --conv 0.18 --supply 22 --supply-target 20 \
  --events signup,core_action,share,share_view,referred_signup,revenue \
  --d7 0.29 --contribution 9.4 --ecac 5.09
```

## Rules of the review

**Evidence is supplied before the meeting, not in it.** The gate command is run
against real numbers and the output is circulated in advance. A review that
begins with the team reading their own metrics for the first time is a
presentation, not a review.

**Absence of evidence fails the gate.** Unsupplied metrics do not pass by
default. This is enforced in code: `evaluateGates` marks unmeasured G2, G4 and
G5 as failures, not as unknowns.

**Position is the first failing gate.** Gates do not compensate. A concept with
outstanding G2 supply and excellent G4 retention is at G2. Strong later-stage
numbers on an unbuilt foundation usually indicate a measurement error, not a
shortcut.

**The rubric is not renegotiated inside a review.** If the weights are wrong,
that is a separate decision made outside any live project, because a weight
changed to save a specific project is no longer a weight.

## Kill decisions

A kill is a successful outcome of the framework, and should be described that
way internally. Portfolios that never kill are not disciplined portfolios; they
are portfolios whose failures have not been recognised yet.

Kill when:

- The concept fails the same gate twice with the same root cause.
- The binding constraint is structural rather than executional — hyperlocal
  double cold start does not yield to better execution.
- The signal's velocity has decayed below the level that justified the score.

On a kill, write a one-page record: what was believed, what was measured, what
the two-sentence lesson is. Return the underlying signal to the scan backlog.
The signal may still be good; this concept was not the way to use it.

## Ethics review — mandatory before G3

Any factory app touching identity, likeness, minors, money, or health passes an
ethics review before shipping. Concept C touches identity, likeness and money.

The review answers five questions in writing:

1. **Who could this harm if it worked exactly as designed?** Not misuse — correct
   use. For an avatar try-on product the honest answer includes body image and
   purchase pressure on young users.
2. **What does the product do by default?** Defaults are the product for the
   vast majority of users. A safe option behind a settings toggle is not a safe
   product.
3. **What is disclosed, and where?** Affiliate relationships, render fidelity,
   and data retention, disclosed at the point of decision rather than in terms.
4. **What is the consent model for likeness?** Explicit, specific, revocable,
   and separate from the general terms of service.
5. **What would a hostile user do with this?** Answer before launch, and encode
   the answer as a guard with a test.

An ethics review that produces no changes to the product was not a review.

## Portfolio cadence

| Activity | Cadence |
| --- | --- |
| Signal intake | Continuous |
| Full re-scan | Quarterly |
| Concept scoring | On demand, minimum two independent scorers |
| Gate reviews | On evidence, not on calendar |
| Portfolio kill review | Quarterly |

## Roles

| Role | Owns |
| --- | --- |
| Research | Signal validity, G0 |
| Product | Scoring integrity, retention, G1 and G4 |
| Growth | Loop measurement and optimisation, G2 |
| Engineering | Instrumentation correctness, G3 |
| Operations | Supply seeding, G2 |
| Finance | Unit economics, G5 |

The scoring integrity owner is deliberately not the person whose headcount
depends on the concept advancing.
