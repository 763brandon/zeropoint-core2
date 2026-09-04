import { id, shareSlug } from '../lib/ids.mjs';
import { getAvatar } from './avatars.mjs';
import { validateOutfit, createProvider } from './render.mjs';

export class LookError extends Error {}

const MAX_GARMENTS = 4; // one per slot; see render.SLOTS

/**
 * Creating a look is the app's `core_action` — the moment a user produces the
 * shareable artefact. The artefact loop's characteristic risk is quality
 * degrading as volume rises, so composition is capped and validated rather than
 * accepting arbitrary garment sets.
 */
export function createLook(db, track, { userId, avatarId, garmentIds, caption }, { now = Date.now, rand } = {}) {
  const avatar = getAvatar(db, avatarId);
  if (avatar.user_id !== userId) throw new LookError('That avatar belongs to someone else');

  const ids = [...new Set(Array.isArray(garmentIds) ? garmentIds : [])];
  if (ids.length === 0) throw new LookError('A look needs at least one garment');
  if (ids.length > MAX_GARMENTS) throw new LookError(`A look may hold at most ${MAX_GARMENTS} garments`);

  const garments = ids.map((garmentId) => {
    const garment = db.prepare('SELECT * FROM garments WHERE id = ? AND active = 1').get(garmentId);
    if (!garment) throw new LookError(`Garment '${garmentId}' is not available`);
    return garment;
  });

  validateOutfit(garments); // throws on slot conflicts, e.g. a dress with a top

  const lookId = id('lok');
  const slug = uniqueSlug(db, rand);
  const at = typeof now === 'function' ? now() : now;

  db.prepare('INSERT INTO looks (id, slug, user_id, avatar_id, caption, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(lookId, slug, userId, avatarId, String(caption ?? '').trim().slice(0, 140), at);

  const insertItem = db.prepare('INSERT INTO look_items (look_id, garment_id, slot) VALUES (?, ?, ?)');
  for (const garment of garments) insertItem.run(lookId, garment.id, garment.slot);

  track('core_action', { userId, lookId, slug, garmentCount: garments.length });
  return getLookBySlug(db, slug);
}

/**
 * Slug collisions are astronomically unlikely but not impossible, and a
 * collision would silently attach a share to the wrong look. Retrying is
 * cheap; the failure it prevents is not.
 */
function uniqueSlug(db, rand, attempts = 8) {
  for (let i = 0; i < attempts; i += 1) {
    const slug = shareSlug(rand);
    if (!db.prepare('SELECT 1 FROM looks WHERE slug = ?').get(slug)) return slug;
  }
  throw new LookError('Could not allocate a unique share slug');
}

export function getLookBySlug(db, slug) {
  const look = db.prepare('SELECT * FROM looks WHERE slug = ?').get(String(slug));
  if (!look) throw new LookError('No such look');
  return hydrate(db, look);
}

export function getLookById(db, lookId) {
  const look = db.prepare('SELECT * FROM looks WHERE id = ?').get(lookId);
  if (!look) throw new LookError('No such look');
  return hydrate(db, look);
}

function hydrate(db, look) {
  const garments = db.prepare(
    `SELECT g.*, b.name AS boutique_name, b.city AS boutique_city, b.rate_bps, b.sharer_bps
       FROM look_items li
       JOIN garments g ON g.id = li.garment_id
       JOIN boutiques b ON b.id = g.boutique_id
      WHERE li.look_id = ?`
  ).all(look.id);

  const avatar = db.prepare('SELECT * FROM avatars WHERE id = ?').get(look.avatar_id);
  const owner = db.prepare('SELECT id, handle, display_name, referral_code FROM users WHERE id = ?').get(look.user_id);
  return { ...look, avatar, owner, garments };
}

export function listLooks(db, { userId = null, limit = 30 } = {}) {
  const rows = userId
    ? db.prepare('SELECT * FROM looks WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit)
    : db.prepare('SELECT * FROM looks ORDER BY created_at DESC LIMIT ?').all(limit);
  return rows.map((look) => hydrate(db, look));
}

export function renderLook(db, slug, providerName = 'local') {
  const look = getLookBySlug(db, slug);
  return createProvider(providerName).render(look.avatar, look.garments);
}

/**
 * Renders a garment set on an avatar WITHOUT persisting anything.
 *
 * The try-on surface fires on every garment tap. Routing that through
 * createLook would emit a `core_action` per tap, inflating the activation
 * numerator and the K denominator until the growth dashboard is fiction.
 * Previewing is not the core action; saving a look is.
 */
export function previewLook(db, { userId, avatarId, garmentIds }, providerName = 'local') {
  const avatar = getAvatar(db, avatarId);
  if (avatar.user_id !== userId) throw new LookError('That avatar belongs to someone else');

  const ids = [...new Set(Array.isArray(garmentIds) ? garmentIds : [])];
  if (ids.length > MAX_GARMENTS) throw new LookError(`A look may hold at most ${MAX_GARMENTS} garments`);

  const garments = ids.map((garmentId) => {
    const garment = db.prepare('SELECT * FROM garments WHERE id = ? AND active = 1').get(garmentId);
    if (!garment) throw new LookError(`Garment '${garmentId}' is not available`);
    return garment;
  });

  validateOutfit(garments);
  return createProvider(providerName).render(avatar, garments);
}

export function recordShare(db, track, { slug, userId, channel }, now = Date.now) {
  const look = getLookBySlug(db, slug);
  if (look.user_id !== userId) throw new LookError('Only the owner of a look can share it');

  const shareId = id('shr');
  db.prepare('INSERT INTO shares (id, look_id, user_id, channel, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(shareId, look.id, userId, String(channel ?? 'link').slice(0, 24), typeof now === 'function' ? now() : now);

  track('share', { userId, artefactId: look.slug, channel: channel ?? 'link' });
  return { shareId, slug: look.slug, shareUrl: `/l/${look.slug}?ref=${look.owner.referral_code}` };
}

/**
 * Records a view of a shared look.
 *
 * Two rules that matter for the growth numbers being true:
 *  - The sharer's own views never count. Without this, `c` decays every time a
 *    creator re-opens their own link to admire it.
 *  - Repeat views by the same viewer are recorded once. `c` is defined over
 *    unique new viewers; counting repeats inflates the denominator and makes
 *    the loop look worse than it is.
 */
export function recordView(db, track, { slug, viewerKey, viewerUserId = null, referrer = null }, now = Date.now) {
  const look = getLookBySlug(db, slug);
  const isSelf = viewerUserId === look.user_id;
  const at = typeof now === 'function' ? now() : now;

  const existing = db.prepare('SELECT 1 FROM look_views WHERE look_id = ? AND viewer_key = ?').get(look.id, viewerKey);
  const isNewViewer = !existing && !isSelf;

  if (!existing) {
    db.prepare(
      'INSERT INTO look_views (id, look_id, viewer_key, is_self, is_new_viewer, referrer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id('viw'), look.id, viewerKey, isSelf ? 1 : 0, isNewViewer ? 1 : 0, referrer ? String(referrer).slice(0, 200) : null, at);
  }

  if (isNewViewer) {
    track('share_view', { artefactId: look.slug, viewerKey, isNewViewer: true });
  }

  return { counted: isNewViewer, isSelf, repeat: Boolean(existing) };
}
