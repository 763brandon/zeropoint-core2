#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scoreAll, scoreConcept } from './score.mjs';
import { DIMENSIONS } from './rubric.mjs';
import { viralCoefficient, projectCohort, amplificationFactor, effectiveCac, diagnose } from './loop.mjs';
import { evaluateGates } from './gates.mjs';
import { scaffold } from './scaffold.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data');

const USAGE = `Viral App Factory — factory CLI

  factory scan                       Show the signal scan and where concepts came from
  factory score [--id C] [--json]    Score concepts against VIRAL-M
  factory rubric                     Print the rubric with its level anchors
  factory model --invites N --conv R [--seed N] [--cycles N] [--cac N]
                                     Model the viral loop
  factory gate --id C [--invites N --conv R ...]
                                     Evaluate stage gates for a concept
  factory scaffold --id C [--root apps] [--force]
                                     Emit the standard app skeleton
`;

// Downstream pipes (`| head`) close stdout early; that is not a program error.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

const args = process.argv.slice(2);
const command = args[0];
const flags = parseFlags(args.slice(1));

try {
  await main(command, flags);
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
}

async function main(cmd, f) {
  switch (cmd) {
    case 'scan': return cmdScan();
    case 'score': return cmdScore(f);
    case 'rubric': return cmdRubric();
    case 'model': return cmdModel(f);
    case 'gate': return cmdGate(f);
    case 'scaffold': return cmdScaffold(f);
    case 'help': case '--help': case '-h': case undefined: return out(USAGE);
    default: throw new Error(`Unknown command '${cmd}'. Run 'factory help'.`);
  }
}

async function loadJson(name) {
  return JSON.parse(await readFile(join(DATA, name), 'utf8'));
}

async function cmdScan() {
  const signals = await loadJson('signals.json');
  out(`Signal scan ${signals.scanId} — captured ${signals.capturedAt}\n`);
  for (const region of signals.regions) {
    out(`${region.label}  [${region.status}]`);
    if (region.note) out(`  note: ${region.note}`);
    if (region.culturalObsessions.length) out(`  cultural: ${region.culturalObsessions.join(' | ')}`);
    if (region.techShifts.length) out(`  tech:     ${region.techShifts.join(' | ')}`);
    out(`  concepts: ${region.conceptIds.join(', ') || '—'}\n`);
  }
  out('Convergences (where a cultural wave meets a technology shift):');
  for (const c of signals.convergences) out(`  ${c.id} -> unlocks ${c.unlocks.join(', ')}\n    ${c.thesis}`);
}

async function cmdScore(f) {
  const registry = await loadJson('concepts.json');
  const scored = f.id
    ? [scoreConcept(mustFind(registry, f.id))]
    : scoreAll(registry);

  if (f.json) return out(JSON.stringify(scored, null, 2));

  out(`Rubric ${registry.rubric} — scan ${registry.scanId}\n`);
  for (const s of scored) {
    if (s.status === 'reserved') {
      out(`${s.id}  ${s.name}\n    unscored — premise not captured\n`);
      continue;
    }
    out(`${s.id}  ${s.name}`);
    out(`    index ${s.index} / ${s.maxIndex}   verdict: ${s.verdict}`);
    out(`    ${s.action}`);
    for (const b of s.breakdown) {
      out(`      ${b.label.padEnd(30)} ${b.level}/5  x${String(b.weight).padStart(2)}  = ${b.contribution.toFixed(1).padStart(5)}`);
    }
    out(`    binding constraint: ${s.constraint.label} (${s.constraint.pointsLost} pts lost)`);
    if (s.constraint.rationale) out(`      ${s.constraint.rationale}`);
    out('');
  }
}

function cmdRubric() {
  for (const d of DIMENSIONS) {
    out(`${d.label}  (weight ${d.weight})`);
    out(`  ${d.question}`);
    for (const [level, anchor] of Object.entries(d.anchors)) out(`    ${level}  ${anchor}`);
    out('');
  }
}

function cmdModel(f) {
  const invitesPerUser = num(f, 'invites');
  const inviteConversion = num(f, 'conv');
  const seed = f.seed ? num(f, 'seed') : 1000;
  const cycles = f.cycles ? Math.trunc(num(f, 'cycles')) : 6;

  const k = viralCoefficient({ invitesPerUser, inviteConversion });
  out(`K = ${invitesPerUser} invites/user x ${(inviteConversion * 100).toFixed(1)}% conversion = ${k}\n`);

  const amp = amplificationFactor(k);
  out(`Amplification: ${amp === Infinity ? 'unbounded (K >= 1)' : `${amp}x per seeded user`}`);
  if (f.cac) out(`Effective CAC: ${effectiveCac({ paidCac: num(f, 'cac'), k })} (from paid CAC ${num(f, 'cac')})`);

  out(`\nCohort projection from ${seed} seeded users:`);
  for (const g of projectCohort({ seed, k, cycles })) {
    out(`  cycle ${String(g.cycle).padStart(2)}  new ${String(g.newUsers).padStart(10)}  cumulative ${g.cumulative}`);
  }

  const d = diagnose({ invitesPerUser, inviteConversion });
  out(`\nDiagnosis: ${d.status}${d.constraint ? ` — constraint is ${d.constraint}` : ''}`);
  out(`  ${d.recommendation}`);
}

async function cmdGate(f) {
  const registry = await loadJson('concepts.json');
  const concept = mustFind(registry, required(f, 'id'));
  const ctx = {
    concept,
    loop: f.invites !== undefined
      ? {
          invitesPerUser: num(f, 'invites'),
          inviteConversion: num(f, 'conv'),
          seededSupply: f.supply ? num(f, 'supply') : 0,
          supplyTarget: f['supply-target'] ? num(f, 'supply-target') : 0
        }
      : undefined,
    instrumentation: f.events ? String(f.events).split(',') : undefined,
    retention: f.d7 ? { d7: num(f, 'd7') } : undefined,
    economics: f.contribution ? { contributionPerUser: num(f, 'contribution'), effectiveCac: num(f, 'ecac') } : undefined
  };

  const { results, position, blocker } = evaluateGates(ctx);
  out(`Stage gates — ${concept.name}\n`);
  for (const r of results) out(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.name}\n        owner: ${r.owner}\n        ${r.detail}`);
  out(`\nPipeline position: ${position}`);
  if (blocker) out(`Blocked at ${blocker.id} — ${blocker.name}`);
}

async function cmdScaffold(f) {
  const registry = await loadJson('concepts.json');
  const concept = mustFind(registry, required(f, 'id'));
  const result = await scaffold(concept, { root: f.root ?? 'apps', force: Boolean(f.force) });
  out(`Scaffolded ${concept.name} -> ${result.target}`);
  for (const w of result.written) out(`  ${w}`);
}

function mustFind(registry, id) {
  const concept = registry.concepts.find((c) => c.id.toLowerCase() === String(id).toLowerCase());
  if (!concept) throw new Error(`No concept '${id}'. Known: ${registry.concepts.map((c) => c.id).join(', ')}`);
  return concept;
}

function parseFlags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { f[key] = true; } else { f[key] = next; i += 1; }
  }
  return f;
}

function required(f, key) {
  if (f[key] === undefined) throw new Error(`--${key} is required`);
  return f[key];
}

function num(f, key) {
  const raw = required(f, key);
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`--${key} must be a number, received '${raw}'`);
  return n;
}

function out(line) {
  process.stdout.write(`${line}\n`);
}
