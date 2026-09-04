# 03 — Loop Design

## Purpose

Close the loop arithmetically before closing it in code. A loop that cannot work
on paper will not work in production, and the paper version costs an afternoon.

```bash
node framework/factory/cli.mjs model --invites 3.2 --conv 0.18 --seed 500 --cycles 6 --cac 12
```

## The arithmetic

```
K = i x c
```

where `i` is invitations emitted per active user per cycle and `c` is the fraction
of those invitations that become activated users.

| K | Meaning | Correct interpretation |
| --- | --- | --- |
| K >= 1 | Self-sustaining growth | Rare, usually temporary, and worth defending hard |
| 0.4 <= K < 1 | Sub-unity loop | **A CAC discount, not growth.** Value it honestly. |
| K < 0.4 | Effectively no loop | Paid acquisition wearing a referral badge |

For K < 1, one seeded user ultimately yields `1 / (1 - K)` users in total. At
K = 0.576 that is 2.36x, which turns a $12 paid CAC into an effective $5.09.
This is a real and defensible business outcome. Calling it "viral growth" in a
board deck is not.

## Always report both factors

K alone is not actionable. A team watching K fall from 0.6 to 0.4 cannot tell
whether users stopped sharing (`i` fell — a product-surface problem) or shares
stopped converting (`c` fell — a landing and activation problem). These have
different owners and different fixes, so the framework reports `i`, `c` and K
together, always.

`factory model` names the constraint directly and refuses to recommend the
implausible fix:

> Conversion would have to reach 91% to carry the loop, which is not a realistic
> target. Raise invites per user from 1.1 to ~10 instead — a product-surface problem.

The 40% ceiling on recommended conversion is a heuristic, not a law, but a plan
that requires better-than-40% cold invite conversion is a plan with a hidden
assumption in it.

## Cycle time is the neglected variable

Two products at K = 1.2 are not equivalent if one cycles in 2 days and the other
in 7. Cycle time enters growth as an exponent of elapsed time, so it is usually
the cheapest lever available:

| Cycle time | Days to 10,000 from 100 seeds at K = 1.2 |
| --- | --- |
| 2 days | ~76 |
| 7 days | ~265 |

Shortening the interval between a user's core action and their share is
frequently a larger win than lifting either factor of K.

## Loop patterns

| Pattern | i | c | Cycle time | Typical failure |
| --- | --- | --- | --- | --- |
| **Artefact loop** — the output is shareable and public | High | Medium | Hours | Artefact quality drops as volume rises |
| **Collaboration loop** — the product needs a second person | Low | Very high | Days | Ceiling: only so many collaborators exist |
| **Incentive loop** — both sides paid to refer | Medium | Low-medium | Days | Fraud, and collapse when the incentive stops |
| **Embed loop** — the product appears on someone else's page | Very high | Very low | Minutes | Platform dependency and sudden policy changes |
| **Word-of-mouth** — unmeasurable, unmanageable | — | — | Weeks | Assumed rather than built |

Concept C runs an **artefact loop**: the shared look is the product, it is public
by nature, and it carries a return path to the try-on experience. Its
characteristic risk is the pattern's characteristic risk — artefact quality
degrading as volume rises — which is why the app caps look composition and
renders deterministically rather than accepting arbitrary input.

## What to measure before you build

Model the loop against three scenarios and record all three:

1. **Pessimistic** — half the invite volume you expect, and a third of the
   conversion. If the business is still worth running here, it is robust.
2. **Planned** — your honest expectation, which is the number the G2 gate reads.
3. **Optimistic** — the case you must not plan headcount against.

A team that recorded only the planned case has no way to recognise, six weeks in,
whether it is behind or simply pessimistic.
