/**
 * VIRAL-M v1 — the scoring rubric of the Viral App Factory Framework.
 *
 * Six dimensions, each scored 0-5 against explicit anchors, then weighted to a
 * 0-100 index. The anchors matter more than the weights: a rubric whose levels
 * are undefined collapses into whatever the scorer already believed.
 */

export const DIMENSIONS = [
  {
    key: 'velocity',
    label: 'Velocity of signal',
    weight: 15,
    question: 'Is the underlying wave still rising, and does the concept sit on more than one of them?',
    anchors: {
      0: 'Declining behaviour; the wave has passed.',
      1: 'Flat niche with no observable growth.',
      2: 'Growing, but only in a single narrow segment.',
      3: 'One clearly rising wave carries the concept.',
      4: 'A rising cultural wave meets an enabling technology shift.',
      5: 'Two or more independent waves intersect precisely at the concept.'
    }
  },
  {
    key: 'shareability',
    label: 'Inherent shareability',
    weight: 25,
    question: 'Is sharing the product itself, or a feature bolted onto it?',
    anchors: {
      0: 'Nothing is shareable; the experience is private by nature.',
      1: 'Sharing is possible but socially awkward for the user.',
      2: 'Sharing must be bought with incentives.',
      3: 'A meaningful minority of sessions produce something worth sharing.',
      4: 'Sharing is a natural, unprompted end state of the core action.',
      5: 'The shared artefact IS the product; withholding it destroys its value.'
    }
  },
  {
    key: 'retention',
    label: 'Retention hook',
    weight: 20,
    question: 'What returns the user next week without a notification?',
    anchors: {
      0: 'Single-use novelty.',
      1: 'Return depends entirely on push notifications.',
      2: 'Weak habit; return driven by boredom.',
      3: 'Return depends on a supply of new content the operator must produce.',
      4: 'Genuine recurring need or an accumulating personal asset.',
      5: 'Recurring need plus social obligation — others expect the user back.'
    }
  },
  {
    key: 'acquisition',
    label: 'Acquisition economics',
    weight: 15,
    question: 'Can users arrive without paid media, and does each cohort pay for the next?',
    anchors: {
      0: 'Paid acquisition only, with CAC above lifetime value.',
      1: 'Paid only, CAC recoverable over a long horizon.',
      2: 'Mostly paid with weak organic assist.',
      3: 'Organic is credible but depends on channels the product does not control.',
      4: 'Product-embedded loop delivers most new users; paid is an accelerant.',
      5: 'Self-sustaining loop; paid spend is optional.'
    }
  },
  {
    key: 'liquidity',
    label: 'Liquidity and supply readiness',
    weight: 10,
    question: 'Does the other side of the market already exist, and how cheaply can it be seeded?',
    anchors: {
      0: 'Both sides must be invented from nothing.',
      1: 'Hyperlocal double cold start, re-fought per neighbourhood.',
      2: 'Double cold start, re-fought per city.',
      3: 'Supply exists offline and must be onboarded manually per market.',
      4: 'Supply exists and can be onboarded programmatically or via aggregators.',
      5: 'Single-sided, or supply is already aggregated and reachable via API.'
    }
  },
  {
    key: 'monetization',
    label: 'Monetization clarity',
    weight: 15,
    question: 'Is there a defined payer, a defined moment of payment, and a defensible rate?',
    anchors: {
      0: 'No identified payer.',
      1: 'Payer identified but no willingness-to-pay evidence.',
      2: 'Revenue depends on scale the product has not reached — ads at low volume.',
      3: 'Clear model, but the rate is set by a third party or is regulatorily costly.',
      4: 'Clear payer and moment; rate is thin or third-party-set but workable.',
      5: 'Clear payer, clear moment, pricing power held by the product.'
    }
  }
];

export const TOTAL_WEIGHT = DIMENSIONS.reduce((sum, d) => sum + d.weight, 0);
export const MAX_LEVEL = 5;

/**
 * Decision bands. These are deliberately asymmetric: the cost of building the
 * wrong thing exceeds the cost of iterating on a promising one, so the "build"
 * threshold sits well above the midpoint.
 */
export const BANDS = [
  { min: 85, verdict: 'fast-track', action: 'Fast-track. Fund a full MVP and seed supply in parallel.' },
  { min: 70, verdict: 'build-mvp', action: 'Build the MVP against the standard build spec. Instrument the loop from commit one.' },
  { min: 55, verdict: 'iterate', action: 'Do not build. Reshape the weakest dimension and re-score.' },
  { min: 0, verdict: 'kill', action: 'Kill. Return the signal to the scan backlog.' }
];

export function bandFor(index) {
  return BANDS.find((b) => index >= b.min) ?? BANDS[BANDS.length - 1];
}
