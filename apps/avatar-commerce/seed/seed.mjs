#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDatabase } from '../src/db.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Idempotent supply seeding. Re-running must not duplicate a catalogue or
 * reset commission rates that operations have since negotiated, so boutiques
 * and garments are inserted-or-left-alone rather than replaced.
 */
export async function seedCatalog(db, catalogPath = join(HERE, 'catalog.json')) {
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));

  const insertBoutique = db.prepare(
    `INSERT OR IGNORE INTO boutiques (id, name, city, country, currency, rate_bps, sharer_bps, payout_terms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertGarment = db.prepare(
    `INSERT OR IGNORE INTO garments (id, boutique_id, name, slot, price_minor, currency, color, accent, pattern, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  );

  for (const b of catalog.boutiques) {
    insertBoutique.run(b.id, b.name, b.city, b.country, b.currency, b.rate_bps, b.sharer_bps, b.payout_terms);
  }
  for (const g of catalog.garments) {
    const boutique = catalog.boutiques.find((b) => b.id === g.boutique_id);
    if (!boutique) throw new Error(`Garment ${g.id} references unknown boutique ${g.boutique_id}`);
    if (boutique.currency !== g.currency) {
      throw new Error(`Garment ${g.id} is priced in ${g.currency} but ${boutique.name} trades in ${boutique.currency}`);
    }
    insertGarment.run(g.id, g.boutique_id, g.name, g.slot, g.price_minor, g.currency, g.color, g.accent, g.pattern);
  }

  return {
    boutiques: db.prepare('SELECT COUNT(*) AS n FROM boutiques').get().n,
    garments: db.prepare('SELECT COUNT(*) AS n FROM garments').get().n
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // A downstream pipe closing (`| head`) is not a seeding failure.
  process.stdout.on('error', (error) => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  });

  const dbPath = process.env.DB_PATH ?? join(HERE, '..', 'data', 'app.db');
  const db = openDatabase(dbPath);
  const counts = await seedCatalog(db);
  process.stdout.write(`Seeded ${counts.boutiques} boutiques and ${counts.garments} garments into ${dbPath}\n`);
  const target = 20;
  if (counts.boutiques < target) {
    process.stdout.write(`Gate G2 note: supply is ${counts.boutiques}/${target} boutiques. Phase 0 of the launch playbook is not complete.\n`);
  }
}
