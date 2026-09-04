import { id } from '../lib/ids.mjs';
import { SKIN_TONES, HAIR_STYLES } from './render.mjs';

export class AvatarError extends Error {}

/**
 * Body parameters are user-set within published bounds and are never adjusted
 * toward a norm — see the ethics review in framework/docs/07-governance.md.
 * The bounds exist to keep the renderer's geometry valid, not to shape bodies.
 */
export const BOUNDS = {
  height_cm: [140, 210],
  shoulder_w: [60, 118],
  waist_w: [44, 108],
  hip_w: [62, 122]
};

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function createAvatar(db, { userId, name, skinTone, hairStyle, hairColor, heightCm, shoulderW, waistW, hipW }, now = Date.now) {
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw new AvatarError('No such user');

  const trimmed = String(name ?? '').trim().slice(0, 40);
  if (!trimmed) throw new AvatarError('Avatar name is required');
  if (!Object.hasOwn(SKIN_TONES, skinTone)) {
    throw new AvatarError(`Unknown skin tone. Choose one of: ${Object.keys(SKIN_TONES).join(', ')}`);
  }
  if (!HAIR_STYLES.includes(hairStyle)) {
    throw new AvatarError(`Unknown hair style. Choose one of: ${HAIR_STYLES.join(', ')}`);
  }
  if (!HEX_RE.test(String(hairColor ?? ''))) throw new AvatarError('Hair colour must be a #rrggbb hex value');

  const measurements = {
    height_cm: bounded('heightCm', heightCm, BOUNDS.height_cm),
    shoulder_w: bounded('shoulderW', shoulderW, BOUNDS.shoulder_w),
    waist_w: bounded('waistW', waistW, BOUNDS.waist_w),
    hip_w: bounded('hipW', hipW, BOUNDS.hip_w)
  };

  const avatarId = id('avt');
  db.prepare(
    `INSERT INTO avatars (id, user_id, name, skin_tone, hair_style, hair_color, height_cm, shoulder_w, waist_w, hip_w, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    avatarId, userId, trimmed, skinTone, hairStyle, String(hairColor).toLowerCase(),
    measurements.height_cm, measurements.shoulder_w, measurements.waist_w, measurements.hip_w,
    typeof now === 'function' ? now() : now
  );

  return getAvatar(db, avatarId);
}

export function getAvatar(db, avatarId) {
  const avatar = db.prepare('SELECT * FROM avatars WHERE id = ?').get(avatarId);
  if (!avatar) throw new AvatarError('No such avatar');
  return avatar;
}

export function listAvatars(db, userId) {
  return db.prepare('SELECT * FROM avatars WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

function bounded(name, value, [min, max]) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new AvatarError(`${name} must be a number between ${min} and ${max}`);
  }
  return n;
}
