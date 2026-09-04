#!/usr/bin/env node
/**
 * Drives a synthetic cohort through the full loop so the Growth tab shows real
 * arithmetic instead of zeroes.
 *
 * This writes through the same services the app uses — no direct inserts — so
 * the numbers it produces are the numbers the product would produce. A demo
 * that fabricates rows would validate nothing.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDatabase } from '../src/db.mjs';
import { createTracker } from '../src/events.mjs';
import { seedCatalog } from './seed.mjs';
import { createUser } from '../src/services/accounts.mjs';
import { createAvatar } from '../src/services/avatars.mjs';
import { createLook, recordShare, recordView } from '../src/services/looks.mjs';
import { recordClick, recordOrder } from '../src/services/attribution.mjs';
import { SKIN_TONES, HAIR_STYLES } from '../src/services/render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOUR = 3_600_000;

/** Deterministic PRNG so a demo run is reproducible and diffable. */
function rng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const OUTFITS = [
  ['gar_kente_wrap', 'gar_linen_trouser'],
  ['gar_adinkra_tee', 'gar_batik_skirt'],
  ['gar_kaba_dress'],
  ['gar_bogota_blouse', 'gar_kolo_trouser', 'gar_ruana'],
  ['gar_lumen_knit', 'gar_hanoi_trouser', 'gar_wool_coat'],
  ['gar_ao_dai'],
  ['gar_silk_top', 'gar_linen_trouser'],
  ['gar_andes_dress']
];

export async function runDemo(db, { seedUsers = 12, viewsPerShare = 6, conversion = 0.22, purchaseRate = 0.18, returnRate = 0.35, organicOrders = 14, seed = 42 } = {}) {
  await seedCatalog(db);
  const random = rng(seed);
  const track = createTracker(db);
  const t0 = Date.now() - 45 * 24 * HOUR;
  let clock = t0;
  const tick = (hours) => { clock += hours * HOUR; return clock; };

  const cohort = [];
  const summary = { users: 0, looks: 0, shares: 0, views: 0, referred: 0, returns: 0, orders: 0, commissions: 0 };
  const everyone = [];

  function join(handle, referrer = null, lookSlug = null) {
    const at = tick(random() * 3);
    const user = createUser(db, track, {
      handle, displayName: handle,
      referralCode: referrer?.referral_code ?? null,
      lookSlug
    }, () => at);
    summary.users += 1;
    if (referrer) summary.referred += 1;
    const member = { user, joinedAt: at };
    everyone.push(member);
    return member;
  }

  function act({ user, joinedAt }, index) {
    const avatar = createAvatar(db, {
      userId: user.id,
      name: `${user.handle}'s avatar`,
      skinTone: Object.keys(SKIN_TONES)[index % Object.keys(SKIN_TONES).length],
      hairStyle: HAIR_STYLES[index % HAIR_STYLES.length],
      hairColor: ['#2b1d16', '#4a2c1a', '#1a1a1a', '#6b4423'][index % 4],
      heightCm: 155 + Math.floor(random() * 35),
      shoulderW: 70 + Math.floor(random() * 30),
      waistW: 50 + Math.floor(random() * 30),
      hipW: 78 + Math.floor(random() * 30)
    }, () => joinedAt);

    const created = [];
    const lookCount = 1 + Math.floor(random() * 2);
    for (let i = 0; i < lookCount; i += 1) {
      const at = joinedAt + (2 + random() * 30) * HOUR;
      const lookTrack = createTracker(db, () => at);
      const look = createLook(db, lookTrack, {
        userId: user.id, avatarId: avatar.id,
        garmentIds: OUTFITS[Math.floor(random() * OUTFITS.length)],
        caption: ['fit check', 'market day', 'for the wedding', 'work week', 'saturday'][Math.floor(random() * 5)]
      }, { now: () => at });
      summary.looks += 1;

      const shareAt = at + (1 + random() * 8) * HOUR;
      recordShare(db, createTracker(db, () => shareAt), { slug: look.slug, userId: user.id, channel: ['whatsapp', 'instagram', 'copy'][Math.floor(random() * 3)] }, () => shareAt);
      summary.shares += 1;
      created.push({ look, shareAt });
    }
    return created;
  }

  // Generation 0 — the seeded cohort.
  for (let i = 0; i < seedUsers; i += 1) cohort.push({ ...join(`seed_user_${i}`), generation: 0 });

  let queue = cohort.map((member, i) => ({ member, index: i }));
  let nextHandle = 0;

  for (let generation = 0; generation < 3 && queue.length; generation += 1) {
    const next = [];
    for (const { member, index } of queue) {
      for (const { look, shareAt } of act(member, index)) {
        for (let v = 0; v < viewsPerShare; v += 1) {
          const viewAt = shareAt + (0.5 + random() * 40) * HOUR;
          const viewer = `viewer-${generation}-${index}-${v}-${Math.floor(random() * 1e6)}`;
          const counted = recordView(db, createTracker(db, () => viewAt), { slug: look.slug, viewerKey: viewer }, () => viewAt);
          if (!counted.counted) continue;
          summary.views += 1;

          if (random() < conversion && generation < 2) {
            clock = viewAt;
            const joined = join(`gen${generation + 1}_user_${nextHandle += 1}`, member.user, look.slug);
            next.push({ member: joined, index: nextHandle });
          }

          if (random() < purchaseRate) {
            const clickAt = viewAt + random() * 2 * HOUR;
            const garment = look.garments[Math.floor(random() * look.garments.length)];
            const click = recordClick(db, { slug: look.slug, garmentId: garment.id, viewerKey: viewer }, () => clickAt);
            const orderAt = clickAt + random() * 48 * HOUR;
            const result = recordOrder(db, createTracker(db, () => orderAt), {
              externalId: `demo-${generation}-${index}-${v}-${summary.orders}`,
              garmentId: garment.id,
              attributionToken: click.token,
              buyerKey: viewer,
              amountMinor: garment.price_minor,
              currency: garment.currency
            }, () => orderAt);
            summary.orders += 1;
            if (result.attributed) summary.commissions += 1;
          }
        }
      }
    }
    queue = next.map((n) => ({ member: n.member, index: n.index }));
  }

  // A share of users come back in the D7 window (hours 144-192 after signup).
  // Without this the retention metric reads zero and never exercises its own
  // boundary logic — a demo that leaves a metric untested is half a demo.
  const avatarFor = db.prepare('SELECT id FROM avatars WHERE user_id = ? LIMIT 1');
  for (const member of everyone) {
    if (random() >= returnRate) continue;
    const avatar = avatarFor.get(member.user.id);
    if (!avatar) continue;
    const at = member.joinedAt + (146 + random() * 44) * HOUR; // inside 144-192
    createLook(db, createTracker(db, () => at), {
      userId: member.user.id, avatarId: avatar.id,
      garmentIds: OUTFITS[Math.floor(random() * OUTFITS.length)],
      caption: 'back for another'
    }, { now: () => at });
    summary.looks += 1;
    summary.returns += 1;
  }

  // Boutiques also sell to walk-ins. An attribution rate of exactly 100% would
  // mean the ledger had never seen an unattributed sale, which is not a real
  // operating condition.
  const garments = db.prepare('SELECT * FROM garments WHERE active = 1').all();
  for (let i = 0; i < organicOrders; i += 1) {
    const garment = garments[Math.floor(random() * garments.length)];
    const at = t0 + random() * 40 * 24 * HOUR;
    recordOrder(db, createTracker(db, () => at), {
      externalId: `organic-${i}`, garmentId: garment.id, attributionToken: null,
      buyerKey: `walk-in-${i}`, amountMinor: garment.price_minor, currency: garment.currency
    }, () => at);
    summary.orders += 1;
  }

  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.on('error', (error) => { if (error.code === 'EPIPE') process.exit(0); throw error; });
  const dbPath = process.env.DB_PATH ?? join(HERE, '..', 'data', 'app.db');
  const db = openDatabase(dbPath);
  const summary = await runDemo(db);
  const { loopMetrics, d7Retention } = await import('../src/services/growth.mjs');
  const m = loopMetrics(db);

  process.stdout.write(`Demo cohort written to ${dbPath}\n\n`);
  for (const [k, v] of Object.entries(summary)) process.stdout.write(`  ${k.padEnd(12)} ${v}\n`);
  process.stdout.write(`\n  K = i x c = ${m.invitesPerUser} x ${m.inviteConversion} = ${m.k}\n`);
  process.stdout.write(`  amplification  ${m.amplification ?? 'unbounded'}\n`);
  process.stdout.write(`  cycle time     ${m.cycleTimeHours} h (median signup -> first share)\n`);
  process.stdout.write(`  D7 retention   ${d7Retention(db).rate}\n`);
  process.stdout.write(`  attribution    ${(m.revenue.orders.attributionRate * 100).toFixed(0)}% of orders\n`);
}
