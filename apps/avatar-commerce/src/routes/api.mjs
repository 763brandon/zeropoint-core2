import { createRouter, readBody, sendJson, sendText, HttpError } from '../lib/http.mjs';
import { viewerKey as hashViewer, verifySignature } from '../lib/ids.mjs';
import { formatMinor, CURRENCY_EXPONENT } from '../lib/money.mjs';
import { createTracker } from '../events.mjs';
import { createUser, getUser, findByHandle, AccountError } from '../services/accounts.mjs';
import { createAvatar, listAvatars, BOUNDS, AvatarError } from '../services/avatars.mjs';
import { createLook, getLookBySlug, listLooks, renderLook, previewLook, recordShare, recordView, LookError } from '../services/looks.mjs';
import { recordClick, recordOrder, earningsFor, ATTRIBUTION_WINDOW_MS, AttributionError } from '../services/attribution.mjs';
import { loopMetrics, d7Retention } from '../services/growth.mjs';
import { SKIN_TONES, HAIR_STYLES, PATTERNS, RenderError } from '../services/render.mjs';

/**
 * Demo-grade identity: the client sends `x-user-id`. This is deliberately not a
 * session system — swapping it for real auth is a contained change, and
 * pretending otherwise in an MVP invites the pretence to ship.
 */
function actor(db, req) {
  const userId = req.headers['x-user-id'];
  if (!userId) return null;
  try {
    return getUser(db, String(userId));
  } catch {
    return null;
  }
}

function requireActor(db, req) {
  const user = actor(db, req);
  if (!user) throw new HttpError(401, 'Sign in first — send x-user-id');
  return user;
}

export function createApi(db, config) {
  const router = createRouter();
  const track = createTracker(db);
  const viewerFor = (req) =>
    hashViewer(req.headers['x-viewer-key'] ?? req.socket.remoteAddress ?? 'anonymous', config.viewerSalt);

  router.get('/api/config', (req, res) => {
    sendJson(res, 200, {
      skinTones: SKIN_TONES,
      hairStyles: HAIR_STYLES,
      patterns: PATTERNS,
      bounds: BOUNDS,
      currencyExponents: CURRENCY_EXPONENT,
      attributionWindowDays: ATTRIBUTION_WINDOW_MS / 86_400_000,
      disclosure: 'Shared looks earn their creator a commission from the boutique. Renders are illustrative, not photographs of the product.'
    });
  });

  router.post('/api/users', async (req, res) => {
    const { json } = await readBody(req);
    const user = createUser(db, track, json);
    sendJson(res, 201, user);
  });

  router.get('/api/users/:handle', (req, res, { params }) => {
    const user = findByHandle(db, params.handle);
    if (!user) throw new HttpError(404, 'No such user');
    sendJson(res, 200, user);
  });

  router.get('/api/me', (req, res) => sendJson(res, 200, requireActor(db, req)));

  router.get('/api/boutiques', (req, res) => {
    sendJson(res, 200, db.prepare('SELECT * FROM boutiques ORDER BY name').all());
  });

  router.get('/api/garments', (req, res, { url }) => {
    const slot = url.searchParams.get('slot');
    const rows = slot
      ? db.prepare('SELECT g.*, b.name AS boutique_name, b.city FROM garments g JOIN boutiques b ON b.id = g.boutique_id WHERE g.active = 1 AND g.slot = ? ORDER BY g.name').all(slot)
      : db.prepare('SELECT g.*, b.name AS boutique_name, b.city FROM garments g JOIN boutiques b ON b.id = g.boutique_id WHERE g.active = 1 ORDER BY g.slot, g.name').all();
    sendJson(res, 200, rows.map((g) => ({ ...g, priceLabel: formatMinor(g.price_minor, g.currency) })));
  });

  router.get('/api/avatars', (req, res) => sendJson(res, 200, listAvatars(db, requireActor(db, req).id)));

  router.post('/api/avatars', async (req, res) => {
    const user = requireActor(db, req);
    const { json } = await readBody(req);
    sendJson(res, 201, createAvatar(db, { ...json, userId: user.id }));
  });

  router.post('/api/looks', async (req, res) => {
    const user = requireActor(db, req);
    const { json } = await readBody(req);
    sendJson(res, 201, createLook(db, track, { ...json, userId: user.id }));
  });

  // Preview persists nothing and emits no event — see services/looks.mjs.
  router.post('/api/preview.svg', async (req, res) => {
    const user = requireActor(db, req);
    const { json } = await readBody(req);
    const { svg } = previewLook(db, { ...json, userId: user.id }, config.renderProvider);
    sendText(res, 200, svg, 'image/svg+xml');
  });

  router.get('/api/looks', (req, res, { url }) => {
    const mine = url.searchParams.get('mine') === '1';
    const userId = mine ? requireActor(db, req).id : null;
    sendJson(res, 200, listLooks(db, { userId }));
  });

  // Public: a shared look must render without an account. A login wall here
  // caps invite conversion at the wall rather than at the artefact.
  router.get('/api/looks/:slug', (req, res, { params }) => {
    sendJson(res, 200, getLookBySlug(db, params.slug));
  });

  router.get('/api/looks/:slug/render.svg', (req, res, { params }) => {
    const { svg } = renderLook(db, params.slug, config.renderProvider);
    sendText(res, 200, svg, 'image/svg+xml', { 'cache-control': 'public, max-age=300' });
  });

  router.post('/api/looks/:slug/views', async (req, res, { params }) => {
    const { json } = await readBody(req);
    const result = recordView(db, track, {
      slug: params.slug,
      viewerKey: viewerFor(req),
      viewerUserId: actor(db, req)?.id ?? null,
      referrer: json.referrer ?? req.headers.referer ?? null
    });
    sendJson(res, 200, result);
  });

  router.post('/api/looks/:slug/shares', async (req, res, { params }) => {
    const user = requireActor(db, req);
    const { json } = await readBody(req);
    sendJson(res, 201, recordShare(db, track, { slug: params.slug, userId: user.id, channel: json.channel }));
  });

  router.post('/api/looks/:slug/clicks', async (req, res, { params }) => {
    const { json } = await readBody(req);
    sendJson(res, 201, recordClick(db, {
      slug: params.slug,
      garmentId: json.garmentId,
      viewerKey: viewerFor(req),
      viewerUserId: actor(db, req)?.id ?? null
    }));
  });

  /**
   * Boutique order webhook. Signature-verified against the raw bytes, because a
   * money-carrying endpoint that trusts its caller is not an endpoint, it is a
   * payout button on the open internet.
   */
  router.post('/api/webhooks/orders', async (req, res) => {
    const { raw, json } = await readBody(req);
    if (!verifySignature(raw, req.headers['x-signature'], config.webhookSecret)) {
      throw new HttpError(401, 'Invalid webhook signature');
    }
    sendJson(res, 201, recordOrder(db, track, json));
  });

  router.get('/api/me/earnings', (req, res) => {
    const user = requireActor(db, req);
    const { totals, commissions } = earningsFor(db, user.id);
    sendJson(res, 200, {
      totals: Object.fromEntries(Object.entries(totals).map(([currency, t]) => [currency, { ...t, earnedLabel: formatMinor(t.earnedMinor, currency), pendingLabel: formatMinor(t.pendingMinor, currency) }])),
      commissions
    });
  });

  router.get('/api/metrics/viral', (req, res) => {
    sendJson(res, 200, { ...loopMetrics(db), d7: d7Retention(db) });
  });

  return router;
}

/** Maps domain errors to status codes in one place, so handlers stay readable. */
export function statusFor(error) {
  if (error instanceof HttpError) return error.status;
  if (error instanceof AccountError || error instanceof AvatarError || error instanceof RenderError) return 400;
  if (error instanceof AttributionError) return 409;
  if (error instanceof LookError) return error.message === 'No such look' ? 404 : 400;
  return 500;
}
