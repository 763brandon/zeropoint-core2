# AI-Avatar Commerce

Concept **C** from scan `scan-2026-001`, scored **82 / 100 — build-mvp** by the
[Viral App Factory Framework](../../framework). Built against the framework's
[standard build spec](../../framework/docs/04-build-spec.md).

> Users create AI avatars that try on clothes from local boutiques and share
> looks, earning affiliate commissions.

**Wedge:** local boutiques hold real inventory but have no content engine. The
avatar is the content engine.

**Loop:** create avatar → try on garment → **share look** → viewer clicks the
garment → viewer signs up to try it on their own avatar → shares.

**Monetization:** affiliate commission on attributed boutique sales, split
between the sharer and the platform at a rate the boutique sets.

---

## Run it

```bash
npm run seed      # boutique supply (idempotent)
npm start         # http://localhost:3000
```

To see the loop with real numbers rather than zeroes:

```bash
node apps/avatar-commerce/seed/demo.mjs   # synthetic cohort, then npm start
```

The demo drives a cohort through the same services the app uses — no direct
inserts — so its metrics are the metrics the product would produce.

```
npm test          # 79 tests: framework + app
```

Zero runtime dependencies. Node 22.5+ for `node:sqlite` and `node:test`.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | |
| `DB_PATH` | `apps/avatar-commerce/data/app.db` | |
| `WEBHOOK_SECRET` | generated, announced at boot | **Set this in production.** |
| `VIEWER_SALT` | `local-dev-salt` | Salts the viewer-key hash. |
| `RENDER_PROVIDER` | `local` | See *Try-on rendering*. |

---

## Try-on rendering

The core transformation is a **local, deterministic, layered SVG compositor**
(`src/services/render.mjs`). The same avatar and garments always produce
byte-identical output, which is what makes it testable and caching safe.

This is build spec rule 4: the core action works without a paid third-party API.
A hosted generative provider can be substituted through the `TryOnProvider`
interface without touching callers, and it stays optional — a vendor outage must
not become a product outage. `createProvider()` fails loudly for an unconfigured
provider rather than silently degrading.

Garments occupy one of four slots — `top`, `bottom`, `dress`, `outer` — painted
back to front. A dress occupies the torso and legs at once, so it cannot be
layered with a top or a bottom; this is rejected at the API with a clear message
rather than rendered as a broken figure.

**Previewing is not the core action.** The try-on surface fires on every garment
tap, so it calls `POST /api/preview.svg`, which renders without persisting.
Routing previews through look creation would emit a `core_action` per tap and
inflate the activation numerator and the K denominator until the growth
dashboard was fiction.

---

## The money path

Every rejection below is a financial control, not defensive boilerplate. Each
one has a test.

| Control | Behaviour |
| --- | --- |
| **Integer money** | Amounts are minor units; rates are basis points. No floats anywhere in the schema or the ledger. |
| **Currency exponents** | VND and COP are zero-decimal. A formatter assuming two decimals renders a Vietnamese price 100x too small. |
| **Bounded attribution** | Click tokens expire after 7 days. An unbounded window is indefensible in a partner dispute. |
| **Self-referral guard** | A sharer never earns on their own purchase. Captured at click time, because the boutique's later webhook cannot know who we are. |
| **Idempotent webhooks** | Duplicate `externalId` is rejected. Webhooks retry; a retried webhook must not pay twice. |
| **Signed webhooks** | HMAC-SHA256 over the exact raw bytes, compared in constant time. |
| **Currency match** | An order in a currency the garment is not priced in is rejected, never coerced. |
| **Rounding** | Sub-unit remainders go to the platform, not the earner — the side that can reconcile them absorbs them. |

Unattributed orders are still recorded. The sale happened; only the commission
is withheld.

---

## Growth instrumentation

The framework's six events, emitted from real code paths:

`signup` · `core_action` · `share` · `share_view` · `referred_signup` · `revenue`

The tracker throws on an unknown name, so a typo cannot quietly create a seventh
event and make the funnel stop adding up.

Definitions follow [05 — Instrumentation](../../framework/docs/05-instrumentation.md)
exactly. Where common usage is ambiguous, the stricter reading is implemented:

- **`share_view`** fires only for *new, non-self* viewers. The sharer re-opening
  their own link would otherwise decay conversion on every admiring refresh.
- **`i`** divides shares by users who performed the core action, not by
  registrations — dividing by registrations understates it for any product with
  a signup-to-activation gap.
- **D7** uses a *fixed* window (hours 144–192). "Day 7 or later" produces a
  curve that cannot fall, which is why it is so often the one reported.
- **K** is never stored. It is always recomputed from `i` and `c`, so the two
  cannot drift apart, and both are always reported alongside it.

---

## API

Public — no account, because a login wall would cap invite conversion at the
wall rather than at the artefact:

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/config` | Options, bounds, currency exponents, disclosure text |
| `GET` | `/api/looks/:slug` | A shared look |
| `GET` | `/api/looks/:slug/render.svg` | The composited try-on |
| `POST` | `/api/looks/:slug/views` | Records a view (deduplicated, self-filtered) |
| `POST` | `/api/looks/:slug/clicks` | Issues a bounded attribution token |
| `POST` | `/api/users` | Signup, with optional referral |

Authenticated via `x-user-id`:

| Method | Path | |
| --- | --- | --- |
| `GET`/`POST` | `/api/avatars` | |
| `POST` | `/api/preview.svg` | Renders without persisting |
| `GET`/`POST` | `/api/looks` | |
| `POST` | `/api/looks/:slug/shares` | Owner only |
| `GET` | `/api/me`, `/api/me/earnings` | |
| `GET` | `/api/metrics/viral` | K, both factors, retention, attribution |

Signed:

| Method | Path | |
| --- | --- | --- |
| `POST` | `/api/webhooks/orders` | `x-signature`: HMAC-SHA256 of the raw body |

`x-user-id` is **demo-grade identity, not a session system.** Swapping it for
real auth is a contained change in `routes/api.mjs`; pretending otherwise in an
MVP invites the pretence to ship.

---

## Ethics commitments

From the mandatory pre-G3 review in
[07 — Governance](../../framework/docs/07-governance.md). These are implemented,
not aspirational:

- **Avatars are stylised and user-parameterised.** No uploaded-face derivatives.
  A likeness feature would require explicit, specific, revocable consent
  obtained separately from the terms of service.
- **No automatic body idealisation.** Proportions are user-set within published
  bounds that exist to keep the renderer's geometry valid — never to shape
  bodies toward a norm. Nothing is silently adjusted.
- **Renders are labelled illustrative** on every surface that shows one,
  including the public share page.
- **Affiliate disclosure is persistent** on the shared look and returned at the
  point of click, not buried in terms.
- **Viewer keys are salted hashes.** Deduplicating views needs a stable
  identifier, not an identifying one.

---

## Layout

```
server.mjs              Entry point and error mapping
src/db.mjs              Schema — integer money, bounded attribution
src/events.mjs          The six loop events, fixed
src/lib/                money, ids/crypto, http router
src/services/           render, accounts, avatars, looks, attribution, growth
src/routes/api.mjs      HTTP surface
seed/catalog.json       Launch-city boutique supply
seed/seed.mjs           Idempotent seeding
seed/demo.mjs           Synthetic cohort through the real services
public/                 Client (no build step, no framework)
tests/                  Domain and end-to-end
```

## Known gaps

Stated rather than hidden, per the framework's governance rules:

- **Supply is 6 boutiques; gate G2 requires 20.** The seeder says so on every
  run. Phase 0 of the launch playbook is not complete, and no amount of product
  work substitutes for it.
- **Identity is a header.** See above.
- **Commissions have no payout pipeline.** They accrue as `pending`; nothing
  moves money out.
- **The renderer is stylised**, not photoreal. Whether that converts is an open
  question the closed-loop test in phase 1 exists to answer.
