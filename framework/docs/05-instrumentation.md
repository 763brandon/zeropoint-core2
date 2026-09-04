# 05 — Instrumentation

## The event contract

Six events, fixed across the portfolio. Apps may emit additional events; they may
not rename or omit these.

| Event | Fires when | Required props |
| --- | --- | --- |
| `signup` | An account is created | `userId`, `referredBy` (nullable) |
| `core_action` | The user completes the app's defining action | `userId`, action-specific id |
| `share` | The user emits a shareable artefact reference | `userId`, `artefactId`, `channel` |
| `share_view` | A share is opened, by anyone | `artefactId`, `viewerKey`, `isNewViewer` |
| `referred_signup` | A signup is attributable to a share | `userId`, `referredBy`, `artefactId` |
| `revenue` | Money is recognised | `amountMinor`, `currency`, `userId` (earner or payer) |

## Metric definitions

Ambiguity in these definitions is how two dashboards disagree about the same
business.

**Invites per user (i)** — `share` events divided by active users, over one
cycle. Counts shares emitted, not shares *sent to* a person; the artefact loop
has no addressable recipient.

**Invite conversion (c)** — `referred_signup` divided by unique `share_view`
with `isNewViewer = true`, over the same cycle. Repeat views by the same viewer
are excluded from the denominator or `c` decays as a function of the sharer
re-opening their own link.

**K** — `i x c`. Never stored; always recomputed from its factors so the two
cannot drift apart.

**Cycle time** — median hours from a user's `signup` to their first `share`.
This is the correct measure because it is the interval that actually gates the
next generation.

**D7 retention** — fraction of a signup cohort emitting any `core_action`
between hours 144 and 192. Fixed window, not "day 7 or later", which silently
converts retention into a cumulative measure that only ever rises.

**Contribution per user** — recognised `revenue` attributable to a cohort minus
variable cost to serve it, divided by cohort size. Not gross transaction value.

## Self-referral and fraud guards

Every loop with money in it will be attacked. Minimum guards:

- A user cannot earn commission on their own purchase.
- Attribution tokens expire; the window is stated, bounded, and enforced in code.
- Views by the sharer do not count toward reach.
- Inbound value events are signature-verified against a shared secret using a
  constant-time comparison.

These are not edge cases to be handled later. A commission ledger that permits
self-dealing is not an MVP simplification; it is a defect that produces real
financial liability the moment it meets a real user.

## Reading the numbers honestly

Two failure modes recur:

**Counting shares as reach.** A share emitted is not a share seen. Report `i`
and reach per share separately; a product can look healthy on `i` while its
shares land nowhere.

**Cumulative retention curves.** Presenting "users who returned at any point"
as retention produces a curve that cannot fall. Use fixed windows.
