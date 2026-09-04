import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { openDatabase } from '../src/db.mjs';
import { seedCatalog } from '../seed/seed.mjs';
import { createApp } from '../server.mjs';
import { signPayload } from '../src/lib/ids.mjs';

const CONFIG = { webhookSecret: 'test-secret', viewerSalt: 'test-salt', renderProvider: 'local' };

let server;
let base;
let db;

before(async () => {
  db = openDatabase(':memory:');
  await seedCatalog(db);
  server = createServer(createApp({ db, config: CONFIG }));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

async function call(method, path, { body, userId, viewerKey, signature } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (userId) headers['x-user-id'] = userId;
  if (viewerKey) headers['x-viewer-key'] = viewerKey;
  if (signature) headers['x-signature'] = signature;
  const sendsBody = body !== undefined && method !== 'GET' && method !== 'HEAD';
  const res = await fetch(`${base}${path}`, { method, headers, body: sendsBody ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  return { status: res.status, body: isJson ? JSON.parse(text) : text, headers: res.headers };
}

describe('end-to-end viral loop over HTTP', () => {
  const state = {};

  test('a visitor signs up and builds an avatar', async () => {
    const signup = await call('POST', '/api/users', { body: { handle: 'ama', displayName: 'Ama B.' } });
    assert.equal(signup.status, 201);
    state.sharer = signup.body;
    assert.ok(state.sharer.referral_code);

    const avatar = await call('POST', '/api/avatars', {
      userId: state.sharer.id,
      body: { name: 'Ama', skinTone: 'bronze', hairStyle: 'coils', hairColor: '#2b1d16', heightCm: 168, shoulderW: 88, waistW: 66, hipW: 96 }
    });
    assert.equal(avatar.status, 201);
    state.avatar = avatar.body;
  });

  test('the boutique catalogue is browsable with formatted prices', async () => {
    const garments = await call('GET', '/api/garments?slot=top');
    assert.equal(garments.status, 200);
    assert.ok(garments.body.length > 0);
    // Zero-decimal currencies (VND, COP) correctly have no decimal point.
    assert.ok(garments.body.every((g) => g.slot === 'top'));
    assert.ok(garments.body.every((g) => g.priceLabel.startsWith(`${g.currency} `)));
    const ghs = garments.body.find((g) => g.currency === 'GHS');
    const vnd = garments.body.find((g) => g.currency === 'VND');
    assert.match(ghs.priceLabel, /^GHS [\d,]+\.\d{2}$/);
    assert.match(vnd.priceLabel, /^VND [\d,]+$/);
  });

  test('trying garments on produces a look — the core action', async () => {
    const look = await call('POST', '/api/looks', {
      userId: state.sharer.id,
      body: { avatarId: state.avatar.id, garmentIds: ['gar_kente_wrap', 'gar_linen_trouser'], caption: 'market day' }
    });
    assert.equal(look.status, 201);
    state.look = look.body;
    assert.equal(state.look.garments.length, 2);
  });

  test('a shared look renders publicly, with no account and no login wall', async () => {
    const page = await call('GET', `/api/looks/${state.look.slug}`);
    assert.equal(page.status, 200);
    assert.equal(page.body.owner.handle, 'ama');

    const svg = await call('GET', `/api/looks/${state.look.slug}/render.svg`);
    assert.equal(svg.status, 200);
    assert.equal(svg.headers.get('content-type'), 'image/svg+xml');
    assert.ok(svg.body.startsWith('<svg'));
  });

  test('the owner shares it and receives a referral-carrying link', async () => {
    const share = await call('POST', `/api/looks/${state.look.slug}/shares`, { userId: state.sharer.id, body: { channel: 'whatsapp' } });
    assert.equal(share.status, 201);
    assert.ok(share.body.shareUrl.includes(`ref=${state.sharer.referral_code}`));
  });

  test('a stranger opening the link counts once, however many times they refresh', async () => {
    const first = await call('POST', `/api/looks/${state.look.slug}/views`, { viewerKey: 'visitor-1', body: {} });
    assert.equal(first.body.counted, true);
    const again = await call('POST', `/api/looks/${state.look.slug}/views`, { viewerKey: 'visitor-1', body: {} });
    assert.equal(again.body.counted, false);
  });

  test('the visitor clicks through and receives a bounded, disclosed attribution token', async () => {
    const click = await call('POST', `/api/looks/${state.look.slug}/clicks`, { viewerKey: 'visitor-1', body: { garmentId: 'gar_kente_wrap' } });
    assert.equal(click.status, 201);
    state.token = click.body.token;
    assert.ok(click.body.expiresAt > Date.now());
    assert.match(click.body.disclosure, /commission/i);
  });

  test('the visitor signs up from the share, closing the loop', async () => {
    const joiner = await call('POST', '/api/users', {
      body: { handle: 'kofi', displayName: 'Kofi', referralCode: state.sharer.referral_code, lookSlug: state.look.slug }
    });
    assert.equal(joiner.status, 201);
    assert.equal(joiner.body.referred_by, state.sharer.id);
  });

  test('a signed order webhook pays the sharer a commission', async () => {
    const payload = { externalId: 'boutique-order-1', garmentId: 'gar_kente_wrap', attributionToken: state.token, buyerKey: 'visitor-1', amountMinor: 24000, currency: 'GHS' };
    const raw = JSON.stringify(payload);
    const res = await fetch(`${base}/api/webhooks/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': signPayload(raw, CONFIG.webhookSecret) },
      body: raw
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.attributed, true);
    assert.equal(body.commission.earnerMinor, 1728);
  });

  test('the sharer sees the earnings, labelled and pending', async () => {
    const earnings = await call('GET', '/api/me/earnings', { userId: state.sharer.id });
    assert.equal(earnings.status, 200);
    assert.equal(earnings.body.totals.GHS.earnedLabel, 'GHS 17.28');
    assert.equal(earnings.body.totals.GHS.pendingMinor, 1728);
  });

  test('the growth endpoint reports K and both of its factors', async () => {
    const metrics = await call('GET', '/api/metrics/viral');
    assert.equal(metrics.status, 200);
    const m = metrics.body;
    assert.equal(m.counts.shares, 1);
    assert.equal(m.counts.shareViews, 1);
    assert.equal(m.counts.referredSignups, 1);
    assert.equal(m.inviteConversion, 1);
    assert.equal(m.k, m.invitesPerUser * m.inviteConversion);
    assert.equal(m.revenue.orders.attributionRate, 1);
  });
});

/** Sends a request path verbatim, bypassing the client-side normalization in fetch(). */
function rawGet(path) {
  return new Promise((resolve, reject) => {
    const socket = connect(server.address().port, '127.0.0.1', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('raw request timed out')); });
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

describe('HTTP surface hardening', () => {
  test('an unsigned or wrongly-signed order webhook is rejected', async () => {
    const payload = { externalId: 'forged', garmentId: 'gar_kente_wrap', attributionToken: null, buyerKey: 'x', amountMinor: 999999, currency: 'GHS' };
    const unsigned = await call('POST', '/api/webhooks/orders', { body: payload });
    assert.equal(unsigned.status, 401);

    const wrong = await call('POST', '/api/webhooks/orders', { body: payload, signature: signPayload(JSON.stringify(payload), 'wrong-secret') });
    assert.equal(wrong.status, 401);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE external_id = 'forged'").get().n, 0);
  });

  test('protected routes require an actor', async () => {
    for (const [method, path] of [['GET', '/api/me'], ['GET', '/api/avatars'], ['GET', '/api/me/earnings'], ['POST', '/api/avatars']]) {
      const res = await call(method, path, { body: {} });
      assert.equal(res.status, 401, `${method} ${path} was not protected`);
    }
  });

  test('an unknown user id is treated as anonymous, not as that user', async () => {
    const res = await call('GET', '/api/me', { userId: 'usr_does_not_exist' });
    assert.equal(res.status, 401);
  });

  test('malformed JSON is a 400, not a 500', async () => {
    const res = await fetch(`${base}/api/users`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
    assert.equal(res.status, 400);
  });

  test('an oversized body is refused before it is buffered into memory', async () => {
    const res = await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'x'.repeat(200_000) })
    });
    assert.equal(res.status, 413);
  });

  test('path traversal out of the public directory is refused', async () => {
    // fetch() normalizes `..` out of a path before it reaches the wire, so this
    // has to speak HTTP directly or it would be testing undici, not the server.
    for (const path of ['/../server.mjs', '/../../package.json', '/..%2F..%2Fpackage.json', '/%2e%2e/server.mjs']) {
      const raw = await rawGet(path);
      assert.ok(/^HTTP\/1\.1 (403|404)/.test(raw), `${path} returned: ${raw.split('\r\n')[0]}`);
      assert.ok(!raw.includes('openDatabase'), `${path} leaked source`);
    }
  });

  test('an unknown look is a 404 rather than a 500', async () => {
    assert.equal((await call('GET', '/api/looks/no-such-slug')).status, 404);
    assert.equal((await call('GET', '/api/looks/no-such-slug/render.svg')).status, 404);
  });

  test('a share URL is served by the app shell so the slug renders for strangers', async () => {
    const res = await fetch(`${base}/l/anything`);
    assert.equal(res.status, 200);
    assert.ok((res.headers.get('content-type') ?? '').includes('text/html'));
  });

  test('the config endpoint publishes the disclosure and the attribution window', async () => {
    const res = await call('GET', '/api/config');
    assert.equal(res.body.attributionWindowDays, 7);
    assert.match(res.body.disclosure, /commission/i);
    assert.match(res.body.disclosure, /illustrative/i);
  });
});
