import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scoreConcept, scoreAll, ScoringError } from '../factory/score.mjs';
import { DIMENSIONS, TOTAL_WEIGHT, bandFor } from '../factory/rubric.mjs';
import { viralCoefficient, projectCohort, amplificationFactor, effectiveCac, timeToTarget, requiredConversion, diagnose } from '../factory/loop.mjs';
import { evaluateGates } from '../factory/gates.mjs';
import { slugify, planFiles } from '../factory/scaffold.mjs';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const registry = JSON.parse(await readFile(join(DATA, 'concepts.json'), 'utf8'));
const conceptC = registry.concepts.find((c) => c.id === 'C');

describe('VIRAL-M rubric', () => {
  test('weights sum to 100 so the index is directly readable as a percentage', () => {
    assert.equal(TOTAL_WEIGHT, 100);
  });

  test('every dimension defines an anchor for all six levels', () => {
    for (const d of DIMENSIONS) {
      for (let level = 0; level <= 5; level += 1) {
        assert.equal(typeof d.anchors[level], 'string', `${d.key} missing anchor ${level}`);
      }
    }
  });

  test('bands cover the full range without a gap', () => {
    for (const index of [0, 54.9, 55, 69.9, 70, 84.9, 85, 100]) {
      assert.ok(bandFor(index), `no band for ${index}`);
    }
    assert.equal(bandFor(84.9).verdict, 'build-mvp');
    assert.equal(bandFor(85).verdict, 'fast-track');
    assert.equal(bandFor(54.9).verdict, 'kill');
  });
});

describe('scoring', () => {
  test('scores concept C at the documented index', () => {
    const scored = scoreConcept(conceptC);
    assert.equal(scored.index, 82);
    assert.equal(scored.verdict, 'build-mvp');
  });

  test('a perfect concept scores exactly 100', () => {
    const perfect = { id: 'X', name: 'X', status: 'scored', scores: Object.fromEntries(DIMENSIONS.map((d) => [d.key, 5])) };
    assert.equal(scoreConcept(perfect).index, 100);
  });

  test('reserved concepts are returned unscored rather than defaulting to zero', () => {
    const scored = scoreConcept(registry.concepts.find((c) => c.id === 'A'));
    assert.equal(scored.index, null);
    assert.equal(scored.verdict, 'unscored');
  });

  test('rejects out-of-range and non-integer levels', () => {
    const base = Object.fromEntries(DIMENSIONS.map((d) => [d.key, 3]));
    for (const bad of [6, -1, 3.5, '4', null, undefined]) {
      const concept = { id: 'X', name: 'X', status: 'scored', scores: { ...base, retention: bad } };
      assert.throws(() => scoreConcept(concept), ScoringError, `accepted ${JSON.stringify(bad)}`);
    }
  });

  test('rejects unknown dimensions so rubric drift is caught at the door', () => {
    const scores = { ...Object.fromEntries(DIMENSIONS.map((d) => [d.key, 3])), vibes: 5 };
    assert.throws(() => scoreConcept({ id: 'X', name: 'X', status: 'scored', scores }), ScoringError);
  });

  test('binding constraint is the greatest weighted loss, not the lowest raw level', () => {
    // liquidity 1/5 (weight 10) loses 8 pts; shareability 3/5 (weight 25) loses 10.
    const scores = { velocity: 5, shareability: 3, retention: 5, acquisition: 5, liquidity: 1, monetization: 5 };
    const scored = scoreConcept({ id: 'X', name: 'X', status: 'scored', scores });
    assert.equal(scored.constraint.key, 'shareability');
    assert.equal(scored.constraint.pointsLost, 10);
  });

  test('scoreAll ranks scored concepts above reserved ones', () => {
    const ranked = scoreAll(registry);
    assert.equal(ranked[0].id, 'C');
    assert.equal(ranked[1].id, 'D');
    assert.deepEqual(ranked.slice(2).map((r) => r.verdict), ['unscored', 'unscored']);
  });
});

describe('viral loop model', () => {
  test('K is the product of invite volume and invite conversion', () => {
    assert.equal(viralCoefficient({ invitesPerUser: 3.2, inviteConversion: 0.18 }), 0.576);
  });

  test('rejects a conversion rate outside 0..1', () => {
    assert.throws(() => viralCoefficient({ invitesPerUser: 2, inviteConversion: 1.4 }), RangeError);
    assert.throws(() => viralCoefficient({ invitesPerUser: -1, inviteConversion: 0.2 }), RangeError);
  });

  test('a sub-unity loop converges to the amplification factor', () => {
    assert.equal(amplificationFactor(0.5), 2);
    const generations = projectCohort({ seed: 1000, k: 0.5, cycles: 40 });
    const total = generations.at(-1).cumulative;
    assert.ok(Math.abs(total - 2000) < 1, `expected convergence near 2000, got ${total}`);
  });

  test('K >= 1 has unbounded amplification and zero effective CAC', () => {
    assert.equal(amplificationFactor(1), Infinity);
    assert.equal(amplificationFactor(1.3), Infinity);
    assert.equal(effectiveCac({ paidCac: 20, k: 1.1 }), 0);
  });

  test('effective CAC is paid CAC divided by amplification', () => {
    assert.equal(effectiveCac({ paidCac: 20, k: 0.5 }), 10);
  });

  test('a sub-unity loop never reaches a target above its ceiling', () => {
    assert.equal(timeToTarget({ seed: 100, k: 0.9, cycleTimeDays: 3, target: 10000 }), Infinity);
  });

  test('time to target grows with cycle time at fixed K', () => {
    const fast = timeToTarget({ seed: 100, k: 1.2, cycleTimeDays: 2, target: 10000 });
    const slow = timeToTarget({ seed: 100, k: 1.2, cycleTimeDays: 7, target: 10000 });
    assert.ok(Number.isFinite(fast) && slow > fast);
    assert.equal(Math.round((slow / fast) * 100) / 100, 3.5);
  });

  test('required conversion flags targets that exceed 100%', () => {
    assert.deepEqual(requiredConversion({ invitesPerUser: 0.5, targetK: 1 }), { conversion: 2, attainable: false });
    assert.equal(requiredConversion({ invitesPerUser: 4, targetK: 1 }).attainable, true);
  });

  test('diagnosis blames invite volume when the needed conversion is implausible', () => {
    const d = diagnose({ invitesPerUser: 1.1, inviteConversion: 0.1 });
    assert.equal(d.constraint, 'invite-volume');
    assert.match(d.recommendation, /Raise invites per user/);
  });

  test('diagnosis blames conversion when a modest lift would carry the loop', () => {
    const d = diagnose({ invitesPerUser: 5, inviteConversion: 0.12 });
    assert.equal(d.constraint, 'conversion');
  });
});

describe('stage gates', () => {
  const fullContext = {
    concept: conceptC,
    loop: { invitesPerUser: 3.2, inviteConversion: 0.18, seededSupply: 22, supplyTarget: 20 },
    instrumentation: ['signup', 'core_action', 'share', 'share_view', 'referred_signup', 'revenue'],
    retention: { d7: 0.29 },
    economics: { contributionPerUser: 9.4, effectiveCac: 5.09 }
  };

  test('a fully evidenced concept clears every gate', () => {
    const { blocked, position } = evaluateGates(fullContext);
    assert.equal(blocked, false);
    assert.equal(position, 'cleared');
  });

  test('pipeline position is the FIRST failing gate, not the last', () => {
    const ctx = { ...fullContext, loop: { ...fullContext.loop, inviteConversion: 0.05 }, retention: { d7: 0.01 } };
    assert.equal(evaluateGates(ctx).position, 'G2');
  });

  test('missing loop instrumentation names the absent events', () => {
    const ctx = { ...fullContext, instrumentation: ['signup', 'core_action'] };
    const g3 = evaluateGates(ctx).results.find((r) => r.id === 'G3');
    assert.equal(g3.pass, false);
    assert.match(g3.detail, /share, share_view, referred_signup, revenue/);
  });

  test('unsupplied evidence fails the gate rather than passing it by default', () => {
    const { results } = evaluateGates({ concept: conceptC });
    for (const id of ['G2', 'G4', 'G5']) {
      assert.equal(results.find((r) => r.id === id).pass, false, `${id} passed with no evidence`);
    }
  });

  test('a low-scoring concept is blocked at G1', () => {
    const conceptD = registry.concepts.find((c) => c.id === 'D');
    assert.equal(evaluateGates({ ...fullContext, concept: conceptD }).position, 'G1');
  });

  test('a gate that throws is reported as a failure, not an unhandled crash', () => {
    const broken = { id: 'X', name: 'X', status: 'scored', premise: 'p', wedge: 'w', scores: { velocity: 99 } };
    const { results } = evaluateGates({ ...fullContext, concept: broken });
    const g1 = results.find((r) => r.id === 'G1');
    assert.equal(g1.pass, false);
    assert.match(g1.detail, /Check errored/);
  });
});

describe('scaffold', () => {
  test('slugify produces a clean directory name', () => {
    assert.equal(slugify('AI-Avatar Commerce'), 'ai-avatar-commerce');
    assert.equal(slugify('  Micro-Gig  Social Network!! '), 'micro-gig-social-network');
  });

  test('slugify refuses a name with no usable characters', () => {
    assert.throws(() => slugify('!!!'), /Cannot derive/);
  });

  test('planned files always include the six loop events', () => {
    const { files, slug } = planFiles(conceptC);
    assert.equal(slug, 'ai-avatar-commerce');
    const events = files.find((f) => f.path === 'src/events.mjs').content;
    for (const name of ['signup', 'core_action', 'share', 'share_view', 'referred_signup', 'revenue']) {
      assert.match(events, new RegExp(`"${name}"`));
    }
  });
});
