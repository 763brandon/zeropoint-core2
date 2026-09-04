/**
 * Viral loop arithmetic.
 *
 * K is not a vanity number. It is the product of two things a team can act on
 * independently — how many invitations an active user emits per cycle (i), and
 * what fraction of those become activated users (c). Teams that track only K
 * cannot tell which of the two broke.
 */

export function viralCoefficient({ invitesPerUser, inviteConversion }) {
  assertNonNegative('invitesPerUser', invitesPerUser);
  assertRate('inviteConversion', inviteConversion);
  return round3(invitesPerUser * inviteConversion);
}

/**
 * Cumulative users from a seed cohort after n cycles, ignoring churn.
 * For K < 1 this converges; the limit is the amplification factor below.
 */
export function projectCohort({ seed, k, cycles }) {
  assertPositive('seed', seed);
  assertNonNegative('k', k);
  if (!Number.isInteger(cycles) || cycles < 0) throw new RangeError('cycles must be a non-negative integer');

  const generations = [];
  let current = seed;
  let cumulative = seed;
  generations.push({ cycle: 0, newUsers: seed, cumulative });

  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    current *= k;
    cumulative += current;
    generations.push({ cycle, newUsers: round2(current), cumulative: round2(cumulative) });
  }
  return generations;
}

/**
 * With K < 1, one seeded user ultimately yields 1/(1-K) users in total. This is
 * the honest way to value a sub-unity loop: it is a CAC discount, not growth.
 */
export function amplificationFactor(k) {
  assertNonNegative('k', k);
  if (k >= 1) return Infinity;
  return round3(1 / (1 - k));
}

/** Effective CAC once a sub-unity loop is credited against paid acquisition. */
export function effectiveCac({ paidCac, k }) {
  assertPositive('paidCac', paidCac);
  const amp = amplificationFactor(k);
  if (amp === Infinity) return 0;
  return round2(paidCac / amp);
}

/** Days for a cohort to reach a target, given cycle time. Infinite when K <= 1. */
export function timeToTarget({ seed, k, cycleTimeDays, target }) {
  assertPositive('seed', seed);
  assertPositive('cycleTimeDays', cycleTimeDays);
  assertPositive('target', target);
  if (target <= seed) return 0;
  if (k <= 1) return Infinity;
  const cycles = Math.log(1 + ((target - seed) * (k - 1)) / seed) / Math.log(k);
  return round2(cycles * cycleTimeDays);
}

/** Invite conversion required to hit a target K at a known invite rate. */
export function requiredConversion({ invitesPerUser, targetK }) {
  assertPositive('invitesPerUser', invitesPerUser);
  assertNonNegative('targetK', targetK);
  const c = targetK / invitesPerUser;
  return { conversion: round3(c), attainable: c <= 1 };
}

/**
 * Diagnose which half of the loop is the constraint. Reaching K=1 by lifting
 * conversion above ~40% is rarely realistic, so the model says so rather than
 * quietly recommending it.
 */
export function diagnose({ invitesPerUser, inviteConversion, targetK = 1 }) {
  const k = viralCoefficient({ invitesPerUser, inviteConversion });
  if (k >= targetK) {
    return { k, status: 'at-target', constraint: null, recommendation: 'Loop is at target. Protect cycle time next.' };
  }
  const neededConversion = requiredConversion({ invitesPerUser, targetK });
  const neededInvites = round2(targetK / Math.max(inviteConversion, 1e-9));

  const conversionIsPlausible = neededConversion.attainable && neededConversion.conversion <= 0.4;
  return {
    k,
    status: 'below-target',
    constraint: conversionIsPlausible ? 'conversion' : 'invite-volume',
    neededConversion: neededConversion.conversion,
    neededInvitesPerUser: neededInvites,
    recommendation: conversionIsPlausible
      ? `Lift invite conversion from ${pct(inviteConversion)} to ${pct(neededConversion.conversion)} — landing-page and activation work.`
      : `Conversion would have to reach ${pct(neededConversion.conversion)} to carry the loop, which is not a realistic target. Raise invites per user from ${invitesPerUser} to ~${neededInvites} instead — a product-surface problem.`
  };
}

const pct = (r) => `${round1(r * 100)}%`;
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

function assertNonNegative(name, v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new RangeError(`${name} must be a finite number >= 0`);
}
function assertPositive(name, v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new RangeError(`${name} must be a finite number > 0`);
}
function assertRate(name, v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw new RangeError(`${name} must be a rate between 0 and 1`);
}
