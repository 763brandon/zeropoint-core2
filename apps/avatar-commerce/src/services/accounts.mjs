import { id, referralCode } from '../lib/ids.mjs';

export class AccountError extends Error {}

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

/**
 * Signup, with referral attribution.
 *
 * A referral is only credited when the code resolves to a real user other than
 * the new one. An unresolvable code is ignored rather than rejected: share links
 * outlive the accounts that made them, and a dead code should not block a
 * legitimate signup.
 */
export function createUser(db, track, { handle, displayName, referralCode: code, lookSlug }, now = Date.now) {
  const normalized = String(handle ?? '').trim().toLowerCase();
  if (!HANDLE_RE.test(normalized)) {
    throw new AccountError('Handle must be 3-20 characters of lowercase letters, numbers or underscore');
  }
  if (db.prepare('SELECT 1 FROM users WHERE handle = ?').get(normalized)) {
    throw new AccountError(`Handle '${normalized}' is taken`);
  }

  const referrer = code ? db.prepare('SELECT id FROM users WHERE referral_code = ?').get(String(code)) : null;
  const userId = id('usr');
  const at = typeof now === 'function' ? now() : now;

  db.prepare(
    `INSERT INTO users (id, handle, display_name, referral_code, referred_by, referred_look, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    normalized,
    String(displayName ?? normalized).trim().slice(0, 60) || normalized,
    referralCode(normalized),
    referrer?.id ?? null,
    lookSlug ? String(lookSlug) : null,
    at
  );

  track('signup', { userId, referredBy: referrer?.id ?? null });
  if (referrer) {
    track('referred_signup', { userId, referredBy: referrer.id, artefactId: lookSlug ?? null });
  }

  return getUser(db, userId);
}

export function getUser(db, userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new AccountError('No such user');
  return user;
}

export function findByHandle(db, handle) {
  return db.prepare('SELECT * FROM users WHERE handle = ?').get(String(handle ?? '').toLowerCase()) ?? null;
}
