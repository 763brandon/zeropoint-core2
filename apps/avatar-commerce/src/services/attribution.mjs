import { id, attributionToken } from '../lib/ids.mjs';
import { splitCommission } from '../lib/money.mjs';
import { getLookBySlug } from './looks.mjs';

export class AttributionError extends Error {}

/** Build spec rule 3: attribution windows are explicit and bounded. */
export const ATTRIBUTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A viewer clicks through from a shared look to a boutique's product.
 *
 * This issues the attribution token that will later carry a commission. The
 * token binds four things — the look, the garment, the sharer, and the viewer —
 * so that a later order can be checked against all of them rather than trusted.
 */
export function recordClick(db, { slug, garmentId, viewerKey, viewerUserId = null }, now = Date.now) {
  const look = getLookBySlug(db, slug);
  const garment = look.garments.find((g) => g.id === garmentId);
  if (!garment) throw new AttributionError('That garment is not part of this look');

  const at = typeof now === 'function' ? now() : now;
  const token = attributionToken();
  // Captured now because the boutique's later webhook has no idea who we are.
  const isSelf = viewerUserId !== null && viewerUserId === look.user_id;

  db.prepare(
    'INSERT INTO clicks (token, look_id, garment_id, sharer_id, viewer_key, is_self, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(token, look.id, garment.id, look.user_id, viewerKey, isSelf ? 1 : 0, at, at + ATTRIBUTION_WINDOW_MS);

  return {
    token,
    expiresAt: at + ATTRIBUTION_WINDOW_MS,
    selfReferral: isSelf,
    garment: { id: garment.id, name: garment.name, priceMinor: garment.price_minor, currency: garment.currency },
    // The boutique's own checkout, carrying the token back to us on conversion.
    checkoutUrl: `/checkout/${garment.id}?atr=${token}`,
    disclosure: 'This link earns the sharer a commission from the boutique.'
  };
}

/**
 * Ingests a boutique's order webhook and writes the commission ledger entry.
 *
 * Every rejection path here is a real financial control, not defensive
 * boilerplate:
 *  - Duplicate external ids are rejected, because webhooks retry and a retried
 *    webhook must not pay a commission twice.
 *  - Expired tokens attribute nothing. An unbounded window is indefensible in a
 *    partner dispute.
 *  - A sharer never earns on their own purchase. A ledger that permits
 *    self-dealing is not an MVP simplification; it is a liability.
 *  - Currency mismatches are rejected rather than coerced.
 */
export function recordOrder(db, track, { externalId, garmentId, attributionToken: token, buyerKey, amountMinor, currency }, now = Date.now) {
  if (!externalId) throw new AttributionError('externalId is required for idempotency');
  if (db.prepare('SELECT 1 FROM orders WHERE external_id = ?').get(String(externalId))) {
    throw new AttributionError(`Order '${externalId}' has already been recorded`);
  }

  const garment = db.prepare('SELECT * FROM garments WHERE id = ?').get(garmentId);
  if (!garment) throw new AttributionError('No such garment');
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new AttributionError('amountMinor must be a non-negative integer of minor units');
  }
  if (String(currency) !== garment.currency) {
    throw new AttributionError(`Currency mismatch: order is ${currency}, garment is priced in ${garment.currency}`);
  }

  const at = typeof now === 'function' ? now() : now;
  const click = token ? db.prepare('SELECT * FROM clicks WHERE token = ?').get(String(token)) : null;

  const rejection = attributionRejection(click, { garmentId, at });
  const attributed = click && !rejection;

  const orderId = id('ord');
  db.prepare(
    `INSERT INTO orders (id, external_id, garment_id, attribution_token, buyer_key, amount_minor, currency, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(orderId, String(externalId), garment.id, attributed ? click.token : null, String(buyerKey ?? ''), amountMinor, String(currency), 'confirmed', at);

  if (!attributed) {
    return { orderId, attributed: false, reason: rejection ?? 'no attribution token supplied', commission: null };
  }

  const boutique = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(garment.boutique_id);
  const split = splitCommission({ amountMinor, rateBps: boutique.rate_bps, sharerBps: boutique.sharer_bps });

  const commissionId = id('cms');
  db.prepare(
    `INSERT INTO commissions (id, order_id, earner_id, boutique_id, gross_minor, earner_minor, platform_minor, currency, rate_bps, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(commissionId, orderId, click.sharer_id, boutique.id, split.grossMinor, split.earnerMinor, split.platformMinor, garment.currency, boutique.rate_bps, 'pending', at);

  track('revenue', {
    userId: click.sharer_id,
    orderId,
    amountMinor: split.grossMinor,
    earnerMinor: split.earnerMinor,
    currency: garment.currency
  });

  return { orderId, attributed: true, reason: null, commission: { id: commissionId, earnerId: click.sharer_id, ...split, currency: garment.currency } };
}

/** Returns the reason attribution must be refused, or null if it may stand. */
function attributionRejection(click, { garmentId, at }) {
  if (!click) return 'unknown attribution token';
  if (click.expires_at <= at) return 'attribution window expired';
  if (click.garment_id !== garmentId) return 'token was issued for a different garment';
  if (click.is_self === 1) return 'self-referral';
  return null;
}

export function earningsFor(db, userId) {
  const rows = db.prepare(
    `SELECT c.*, b.name AS boutique_name, o.amount_minor AS order_amount_minor, o.created_at AS order_at
       FROM commissions c
       JOIN boutiques b ON b.id = c.boutique_id
       JOIN orders o ON o.id = c.order_id
      WHERE c.earner_id = ?
      ORDER BY c.created_at DESC`
  ).all(userId);

  const totals = rows.reduce((acc, row) => {
    const bucket = acc[row.currency] ?? { earnedMinor: 0, pendingMinor: 0, paidMinor: 0, orders: 0 };
    bucket.earnedMinor += row.earner_minor;
    bucket.orders += 1;
    if (row.status === 'paid') bucket.paidMinor += row.earner_minor;
    else bucket.pendingMinor += row.earner_minor;
    acc[row.currency] = bucket;
    return acc;
  }, {});

  return { totals, commissions: rows };
}
