# 01 — Signal Scan

## Purpose

Produce a defensible inventory of what is moving, organised so that intersections
become visible. A scan that lists trends without pairing them is a newsletter,
not an input to a build decision.

## The four columns

Every scanned region is recorded against four fields:

| Field | Question | Failure mode if skipped |
| --- | --- | --- |
| **Cultural obsession** | What are people doing far more than last year, without being paid to? | Building for a behaviour that has to be taught |
| **Tech shift** | What became 10x cheaper or newly possible in the last 18 months? | Building something that was already possible and already tried |
| **Friction** | What does the obsessed population still do manually or badly? | A solution with no problem |
| **Money flow** | Where is money already changing hands in this behaviour? | A large audience with no payer |

The framework's `signals.json` currently captures the first two columns as
supplied by the source scan. Friction and money flow are recorded per concept
in `concepts.json` as `wedge` and `monetization`.

## Convergence, not listing

A signal on its own does not justify a build. The unit of output from a scan is
a **convergence**: an explicit thesis stating that a cultural obsession and a
technology shift now intersect at a point where they did not before.

The test of a convergence thesis is that it contains a *because now*. Compare:

> Weak: "People like short videos and AI is improving."
>
> Strong: "Short-video commerce has trained a generation to buy from a person,
> not a page. AI-generated content plus AR filters collapse the cost of producing
> that person to near zero, while local boutiques remain unable to produce it at
> all."

The second states who is left behind by the shift, which is where the wedge is.

## Recording what you do not know

A region with no captured signal is marked `reserved`, not filled with
plausible-sounding content. The scan in this repository carries two reserved
regions for exactly this reason. Inventing a signal to complete a table is the
most common way a scan becomes actively misleading — it produces concepts that
inherit the false confidence of the fabricated row.

## Running a scan

```bash
node framework/factory/cli.mjs scan
```

## Cadence

Quarterly for a full re-scan; continuous for signal intake into the backlog.
A signal older than two quarters must be re-validated before it can carry a
concept through G0 — velocity is a dimension that decays while the document
does not.
