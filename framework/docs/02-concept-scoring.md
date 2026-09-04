# 02 — Concept Scoring

## Purpose

Convert judgement into a comparable number, and make the judgement inspectable
so it can be argued with on the merits.

```bash
node framework/factory/cli.mjs rubric        # anchors in full
node framework/factory/cli.mjs score         # rank the registry
node framework/factory/cli.mjs score --id C --json
```

## Rules of application

**Score against the anchor, not against the feeling.** Each level 0-5 has
published anchor text. A scorer must be able to point at the anchor their level
corresponds to. "It feels like a 4" is not a score.

**Score independently, then reconcile.** At least two scorers, scoring without
seeing each other's numbers. Any dimension differing by two or more levels is
discussed before the index is computed. Consensus reached before scoring is not
consensus, it is anchoring.

**Write the rationale before the level.** The rationale field in
`concepts.json` is not documentation of the score; it is the reasoning that
produces it. Reversing the order produces post-hoc justification.

**Score the concept you would actually build.** Not the ambitious version, not
the defensible-in-a-meeting version. If the MVP will launch in one city with 20
boutiques, liquidity is scored on that, not on the API-integrated future.

## Honest scoring beats high scoring

Concept C in this registry scores 3/5 on retention with the rationale that
fashion novelty decays and return visits depend on partner operations. It would
have been trivial to argue that to a 4 and lift the index from 82 to 86 —
promoting it from `build-mvp` to `fast-track`.

That would have been the more expensive outcome. `fast-track` funds a full MVP
*and* parallel supply seeding; `build-mvp` funds the MVP and forces retention to
be designed deliberately. The rubric only protects the team if the team does not
negotiate with it.

## The binding constraint

Scoring returns the dimension losing the most **weighted** points, not the
lowest raw level. A 2/5 on liquidity (weight 10) loses 6 points; a 3/5 on
shareability (weight 25) loses 10. The cheaper fix is rarely the right one, and
the raw minimum systematically points at the cheap fix.

The binding constraint determines the next action:

| Constraint | Next action |
| --- | --- |
| Velocity | Re-validate the signal. It may already be late. |
| Shareability | Redesign the artefact. Do not proceed on incentives. |
| Retention | Design the return trigger before the build, not after launch. |
| Acquisition | Model the loop (stage 3) before committing to a channel. |
| Liquidity | Treat supply as an operations project with its own gate and owner. |
| Monetization | Identify the payer and the moment, or reshape the concept. |

## Re-scoring

A concept is re-scored when a dimension's underlying evidence changes — not on a
calendar. Re-scoring after a build has begun, in order to justify continuing, is
the failure mode this stage exists to prevent; that decision belongs to the
gates in `07-governance.md`.
