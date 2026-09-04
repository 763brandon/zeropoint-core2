import { scoreConcept } from './score.mjs';
import { viralCoefficient } from './loop.mjs';

/**
 * Stage gates. Each gate is a falsifiable check with a named owner and a stated
 * consequence of failure. A gate a team can talk its way past is not a gate.
 */
export const GATES = [
  {
    id: 'G0',
    name: 'Signal validated',
    owner: 'Research',
    check: (ctx) => ({
      pass: Boolean(ctx.concept?.premise) && Boolean(ctx.concept?.wedge),
      detail: 'Concept states an explicit premise and a wedge — who is underserved and why now.'
    })
  },
  {
    id: 'G1',
    name: 'Concept scores >= 70 on VIRAL-M',
    owner: 'Product',
    check: (ctx) => {
      const scored = scoreConcept(ctx.concept);
      return {
        pass: (scored.index ?? 0) >= 70,
        detail: `VIRAL-M index ${scored.index ?? 'unscored'} / 100 (${scored.verdict}).`
      };
    }
  },
  {
    id: 'G2',
    name: 'Loop modelled and supply seeded',
    owner: 'Growth + Operations',
    check: (ctx) => {
      const { invitesPerUser, inviteConversion, seededSupply = 0, supplyTarget = 0 } = ctx.loop ?? {};
      if (invitesPerUser === undefined || inviteConversion === undefined) {
        return { pass: false, detail: 'No loop measurement supplied.' };
      }
      const k = viralCoefficient({ invitesPerUser, inviteConversion });
      const supplyOk = supplyTarget === 0 ? true : seededSupply >= supplyTarget;
      return {
        pass: k >= 0.4 && supplyOk,
        detail: `K = ${k} (floor 0.4 with paid assist); supply ${seededSupply}/${supplyTarget} partners.`
      };
    }
  },
  {
    id: 'G3',
    name: 'MVP shipped with the loop instrumented end to end',
    owner: 'Engineering',
    check: (ctx) => {
      const required = ['signup', 'core_action', 'share', 'share_view', 'referred_signup', 'revenue'];
      const present = new Set(ctx.instrumentation ?? []);
      const missing = required.filter((e) => !present.has(e));
      return {
        pass: missing.length === 0,
        detail: missing.length ? `Missing events: ${missing.join(', ')}.` : 'All loop-critical events emitted.'
      };
    }
  },
  {
    id: 'G4',
    name: 'Retention floor met',
    owner: 'Product',
    check: (ctx) => {
      const d7 = ctx.retention?.d7;
      return {
        pass: typeof d7 === 'number' && d7 >= 0.25,
        detail: d7 === undefined ? 'D7 retention not measured.' : `D7 = ${Math.round(d7 * 100)}% (floor 25%).`
      };
    }
  },
  {
    id: 'G5',
    name: 'Unit economics positive',
    owner: 'Finance',
    check: (ctx) => {
      const { contributionPerUser, effectiveCac } = ctx.economics ?? {};
      if (contributionPerUser === undefined || effectiveCac === undefined) {
        return { pass: false, detail: 'Contribution margin or effective CAC not supplied.' };
      }
      return {
        pass: contributionPerUser > effectiveCac,
        detail: `Contribution ${contributionPerUser} vs effective CAC ${effectiveCac}.`
      };
    }
  }
];

/**
 * Evaluates gates in order and stops reporting `pass` after the first failure.
 * Later gates still run so the team can see what else is outstanding, but the
 * pipeline position is the first failing gate — gates do not compensate.
 */
export function evaluateGates(ctx) {
  const results = GATES.map((gate) => {
    let outcome;
    try {
      outcome = gate.check(ctx);
    } catch (error) {
      outcome = { pass: false, detail: `Check errored: ${error.message}` };
    }
    return { id: gate.id, name: gate.name, owner: gate.owner, ...outcome };
  });

  const firstFailure = results.find((r) => !r.pass) ?? null;
  return {
    results,
    position: firstFailure ? firstFailure.id : 'cleared',
    blocked: Boolean(firstFailure),
    blocker: firstFailure
  };
}
