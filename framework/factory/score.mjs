import { DIMENSIONS, TOTAL_WEIGHT, MAX_LEVEL, bandFor } from './rubric.mjs';

export class ScoringError extends Error {}

/**
 * Score one concept against VIRAL-M.
 *
 * Concepts marked `reserved` are not scorable: the factory will not manufacture
 * a number for a premise it does not have. This is the point of the guard —
 * an unscored concept stays visibly unscored instead of defaulting to zero and
 * silently ranking last.
 */
export function scoreConcept(concept) {
  if (concept.status === 'reserved') {
    return { id: concept.id, name: concept.name, status: 'reserved', index: null, verdict: 'unscored' };
  }

  const scores = concept.scores;
  if (!scores || typeof scores !== 'object') {
    throw new ScoringError(`Concept ${concept.id} is marked '${concept.status}' but carries no scores.`);
  }

  const breakdown = DIMENSIONS.map((dimension) => {
    const level = scores[dimension.key];
    if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) {
      throw new ScoringError(
        `Concept ${concept.id}: dimension '${dimension.key}' must be an integer 0-${MAX_LEVEL}, received ${JSON.stringify(level)}.`
      );
    }
    return {
      key: dimension.key,
      label: dimension.label,
      level,
      weight: dimension.weight,
      anchor: dimension.anchors[level],
      contribution: (level / MAX_LEVEL) * dimension.weight,
      rationale: concept.rationale?.[dimension.key] ?? null
    };
  });

  const unknown = Object.keys(scores).filter((k) => !DIMENSIONS.some((d) => d.key === k));
  if (unknown.length) {
    throw new ScoringError(`Concept ${concept.id}: unknown dimension(s) ${unknown.join(', ')}.`);
  }

  const index = round1(breakdown.reduce((sum, b) => sum + b.contribution, 0));
  const band = bandFor(index);

  return {
    id: concept.id,
    name: concept.name,
    status: concept.status,
    index,
    maxIndex: TOTAL_WEIGHT,
    verdict: band.verdict,
    action: band.action,
    breakdown,
    constraint: weakestDimension(breakdown),
    risks: concept.risks ?? []
  };
}

/**
 * The binding constraint is the dimension losing the most weighted points —
 * not simply the lowest raw level. A 2/5 on a 10-weight dimension costs less
 * than a 3/5 on a 20-weight one, and the cheaper fix is rarely the right one.
 */
export function weakestDimension(breakdown) {
  const worst = [...breakdown].sort(
    (a, b) => (b.weight - b.contribution) - (a.weight - a.contribution)
  )[0];
  return {
    key: worst.key,
    label: worst.label,
    level: worst.level,
    pointsLost: round1(worst.weight - worst.contribution),
    rationale: worst.rationale
  };
}

export function scoreAll(registry) {
  return registry.concepts
    .map(scoreConcept)
    .sort((a, b) => (b.index ?? -1) - (a.index ?? -1));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
