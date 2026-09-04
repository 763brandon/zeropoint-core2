import { randomUUID, randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';

const ADJECTIVES = ['amber', 'linen', 'dusk', 'coral', 'indigo', 'sable', 'ivory', 'jade', 'rust', 'slate', 'plum', 'ochre'];
const NOUNS = ['drape', 'hem', 'cuff', 'weave', 'pleat', 'sash', 'stitch', 'fold', 'thread', 'panel'];

export function id(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/**
 * Human-legible share slugs. Readability matters here: the slug is pasted into
 * social posts, and an opaque hash converts measurably worse than a phrase.
 * Entropy comes from the 5-hex suffix, not the words.
 */
export function shareSlug(rand = randomBytes) {
  const bytes = rand(8);
  const adjective = ADJECTIVES[bytes[0] % ADJECTIVES.length];
  const noun = NOUNS[bytes[1] % NOUNS.length];
  const suffix = Buffer.from(bytes.subarray(2, 6)).toString('hex').slice(0, 5);
  return `${adjective}-${noun}-${suffix}`;
}

export function referralCode(handle, rand = randomBytes) {
  const base = handle.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8) || 'user';
  return `${base}${Buffer.from(rand(3)).toString('hex')}`;
}

export function attributionToken(rand = randomBytes) {
  return `atr_${Buffer.from(rand(16)).toString('hex')}`;
}

/**
 * Viewers are identified by a salted hash of a client-supplied key, never by a
 * raw address. Deduplicating views needs a stable identifier, not an
 * identifying one.
 */
export function viewerKey(raw, salt) {
  return createHash('sha256').update(`${salt}:${String(raw ?? 'anonymous')}`).digest('hex').slice(0, 32);
}

/** HMAC-SHA256 signature for inbound boutique order webhooks. */
export function signPayload(rawBody, secret) {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Constant-time signature check. Length is compared first because
 * timingSafeEqual throws on a length mismatch, which would itself leak.
 */
export function verifySignature(rawBody, signature, secret) {
  const expected = signPayload(rawBody, secret);
  const given = Buffer.from(String(signature ?? ''), 'utf8');
  const want = Buffer.from(expected, 'utf8');
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}
