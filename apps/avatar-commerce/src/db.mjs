import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Schema for AI-Avatar Commerce.
 *
 * Conventions enforced here rather than trusted to callers:
 *  - All money is INTEGER minor units with an explicit currency alongside it.
 *    There are no floats in this schema.
 *  - All rates are INTEGER basis points. 850 means 8.50%.
 *  - All timestamps are INTEGER epoch milliseconds, so ordering and window
 *    arithmetic need no parsing.
 *  - Attribution is bounded: every click token carries an expiry.
 */

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  handle         TEXT NOT NULL UNIQUE,
  display_name   TEXT NOT NULL,
  referral_code  TEXT NOT NULL UNIQUE,
  referred_by    TEXT REFERENCES users(id),
  referred_look  TEXT,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS avatars (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  skin_tone   TEXT NOT NULL,
  hair_style  TEXT NOT NULL,
  hair_color  TEXT NOT NULL,
  height_cm   INTEGER NOT NULL,
  shoulder_w  INTEGER NOT NULL,
  waist_w     INTEGER NOT NULL,
  hip_w       INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS boutiques (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  city           TEXT NOT NULL,
  country        TEXT NOT NULL,
  currency       TEXT NOT NULL,
  -- Commission the boutique pays on an attributed sale, in basis points.
  rate_bps       INTEGER NOT NULL CHECK (rate_bps >= 0 AND rate_bps <= 10000),
  -- Share of that commission passed through to the sharer, in basis points.
  sharer_bps     INTEGER NOT NULL CHECK (sharer_bps >= 0 AND sharer_bps <= 10000),
  payout_terms   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS garments (
  id           TEXT PRIMARY KEY,
  boutique_id  TEXT NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  -- 'top' | 'bottom' | 'dress' | 'outer' — one slot per layer, see services/render.mjs
  slot         TEXT NOT NULL CHECK (slot IN ('top','bottom','dress','outer')),
  price_minor  INTEGER NOT NULL CHECK (price_minor >= 0),
  currency     TEXT NOT NULL,
  color        TEXT NOT NULL,
  accent       TEXT NOT NULL,
  pattern      TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS looks (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  avatar_id   TEXT NOT NULL REFERENCES avatars(id) ON DELETE CASCADE,
  caption     TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS look_items (
  look_id     TEXT NOT NULL REFERENCES looks(id) ON DELETE CASCADE,
  garment_id  TEXT NOT NULL REFERENCES garments(id),
  slot        TEXT NOT NULL,
  PRIMARY KEY (look_id, slot)
);

CREATE TABLE IF NOT EXISTS shares (
  id          TEXT PRIMARY KEY,
  look_id     TEXT NOT NULL REFERENCES looks(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS look_views (
  id            TEXT PRIMARY KEY,
  look_id       TEXT NOT NULL REFERENCES looks(id) ON DELETE CASCADE,
  viewer_key    TEXT NOT NULL,
  is_self       INTEGER NOT NULL,
  is_new_viewer INTEGER NOT NULL,
  referrer      TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_views_look ON look_views(look_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_views_unique_viewer ON look_views(look_id, viewer_key);

CREATE TABLE IF NOT EXISTS clicks (
  token       TEXT PRIMARY KEY,
  look_id     TEXT NOT NULL REFERENCES looks(id) ON DELETE CASCADE,
  garment_id  TEXT NOT NULL REFERENCES garments(id),
  sharer_id   TEXT NOT NULL REFERENCES users(id),
  viewer_key  TEXT NOT NULL,
  -- Resolved at click time: is the clicker the sharer? A boutique's order
  -- webhook cannot tell us this later, so it must be captured here.
  is_self     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clicks_expiry ON clicks(expires_at);

CREATE TABLE IF NOT EXISTS orders (
  id                 TEXT PRIMARY KEY,
  external_id        TEXT NOT NULL UNIQUE,
  garment_id         TEXT NOT NULL REFERENCES garments(id),
  attribution_token  TEXT REFERENCES clicks(token),
  buyer_key          TEXT NOT NULL,
  amount_minor       INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency           TEXT NOT NULL,
  status             TEXT NOT NULL,
  created_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS commissions (
  id             TEXT PRIMARY KEY,
  order_id       TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  earner_id      TEXT NOT NULL REFERENCES users(id),
  boutique_id    TEXT NOT NULL REFERENCES boutiques(id),
  gross_minor    INTEGER NOT NULL,
  earner_minor   INTEGER NOT NULL,
  platform_minor INTEGER NOT NULL,
  currency       TEXT NOT NULL,
  rate_bps       INTEGER NOT NULL,
  status         TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_commissions_earner ON commissions(earner_id);

-- The framework's six loop events. Written from real code paths, never stubs.
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  user_id     TEXT,
  props       TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(name, created_at);
`;

export function openDatabase(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

export { SCHEMA };
