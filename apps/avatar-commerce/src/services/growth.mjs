/**
 * Growth metrics computed from the six loop events and nothing else.
 *
 * Definitions follow framework/docs/05-instrumentation.md exactly. Where a
 * definition is ambiguous in common usage, the stricter reading is implemented
 * and the reason is stated at the call site — a dashboard that flatters the
 * product is worse than no dashboard.
 */

export function loopMetrics(db, { since = 0, until = Number.MAX_SAFE_INTEGER } = {}) {
  const count = (name) =>
    db.prepare('SELECT COUNT(*) AS n FROM events WHERE name = ? AND created_at >= ? AND created_at <= ?')
      .get(name, since, until).n;

  const signups = count('signup');
  const coreActions = count('core_action');
  const shares = count('share');
  const shareViews = count('share_view');
  const referredSignups = count('referred_signup');

  // Active users are those who performed the core action, not those who merely
  // registered. Dividing shares by registrations understates `i` for any product
  // with a signup-to-activation gap.
  const activeUsers = db.prepare(
    'SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE name = ? AND created_at >= ? AND created_at <= ?'
  ).get('core_action', since, until).n;

  const invitesPerUser = activeUsers === 0 ? 0 : round3(shares / activeUsers);

  // Denominator is unique NEW viewers. `share_view` is only emitted for new,
  // non-self viewers (see services/looks.mjs), so the event count is already
  // the correct denominator — repeat and self views never reach it.
  const inviteConversion = shareViews === 0 ? 0 : round3(referredSignups / shareViews);

  const k = round3(invitesPerUser * inviteConversion);

  return {
    window: { since, until },
    counts: { signups, coreActions, shares, shareViews, referredSignups, activeUsers },
    activationRate: signups === 0 ? 0 : round3(activeUsers / signups),
    reachPerShare: shares === 0 ? 0 : round2(shareViews / shares),
    invitesPerUser,
    inviteConversion,
    k,
    amplification: k >= 1 ? null : round2(1 / (1 - k)),
    cycleTimeHours: medianCycleTimeHours(db),
    revenue: revenueSummary(db, since, until)
  };
}

/**
 * Median hours from signup to a user's FIRST share. This interval, not the
 * average, is what gates the next generation of the loop — a long tail of users
 * who share months later drags a mean upward without affecting growth.
 */
export function medianCycleTimeHours(db) {
  const rows = db.prepare(
    `SELECT u.created_at AS signed_up, MIN(s.created_at) AS first_share
       FROM users u
       JOIN shares s ON s.user_id = u.id
      GROUP BY u.id`
  ).all();

  const deltas = rows
    .filter((r) => r.first_share >= r.signed_up)
    .map((r) => (r.first_share - r.signed_up) / 3_600_000)
    .sort((a, b) => a - b);

  if (deltas.length === 0) return null;
  const mid = Math.floor(deltas.length / 2);
  const median = deltas.length % 2 === 0 ? (deltas[mid - 1] + deltas[mid]) / 2 : deltas[mid];
  return round2(median);
}

/**
 * D7 retention over a FIXED window — hours 144 to 192 after signup, not
 * "day 7 or later". The cumulative reading produces a curve that cannot fall,
 * which is why it is so often the one reported.
 */
export function d7Retention(db, now = Date.now()) {
  const eligible = db.prepare('SELECT id, created_at FROM users WHERE created_at <= ?').all(now - 192 * 3_600_000);
  if (eligible.length === 0) return { cohortSize: 0, retained: 0, rate: null };

  const acted = db.prepare(
    `SELECT 1 FROM events
      WHERE name = 'core_action' AND user_id = ?
        AND created_at >= ? AND created_at <= ? LIMIT 1`
  );

  let retained = 0;
  for (const user of eligible) {
    const from = user.created_at + 144 * 3_600_000;
    const to = user.created_at + 192 * 3_600_000;
    if (acted.get(user.id, from, to)) retained += 1;
  }

  return { cohortSize: eligible.length, retained, rate: round3(retained / eligible.length) };
}

function revenueSummary(db, since, until) {
  const rows = db.prepare(
    `SELECT currency,
            COUNT(*) AS orders,
            SUM(gross_minor) AS gross_minor,
            SUM(earner_minor) AS earner_minor,
            SUM(platform_minor) AS platform_minor
       FROM commissions
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY currency`
  ).all(since, until);

  const attributed = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE attribution_token IS NOT NULL').get().n;
  const total = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;

  return {
    byCurrency: rows,
    orders: { total, attributed, attributionRate: total === 0 ? 0 : round3(attributed / total) }
  };
}

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
