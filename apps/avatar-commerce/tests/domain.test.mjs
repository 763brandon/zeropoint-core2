import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.mjs';
import { createTracker, LOOP_EVENTS, EventError } from '../src/events.mjs';
import { seedCatalog } from '../seed/seed.mjs';
import { runDemo } from '../seed/demo.mjs';
import { splitCommission, applyBps, formatMinor, exponentFor, MoneyError } from '../src/lib/money.mjs';
import { verifySignature, signPayload, shareSlug, viewerKey } from '../src/lib/ids.mjs';
import { LocalCompositor, validateOutfit, createProvider, RenderError, HAIR_STYLES, SKIN_TONES, escapeXml } from '../src/services/render.mjs';
import { createUser, AccountError } from '../src/services/accounts.mjs';
import { createAvatar, AvatarError } from '../src/services/avatars.mjs';
import { createLook, previewLook, recordShare, recordView, getLookBySlug, LookError } from '../src/services/looks.mjs';
import { recordClick, recordOrder, earningsFor, ATTRIBUTION_WINDOW_MS, AttributionError } from '../src/services/attribution.mjs';
import { loopMetrics, d7Retention, medianCycleTimeHours } from '../src/services/growth.mjs';

const AVATAR = { name: 'Ama', skinTone: 'bronze', hairStyle: 'coils', hairColor: '#2b1d16', heightCm: 168, shoulderW: 88, waistW: 66, hipW: 96 };

let db;
let track;
beforeEach(async () => {
  db = openDatabase(':memory:');
  await seedCatalog(db);
  track = createTracker(db);
});

const makeUser = (handle, opts = {}) => createUser(db, track, { handle, displayName: handle, ...opts });
const makeAvatar = (userId) => createAvatar(db, { ...AVATAR, userId });

function makeLook(userId, garmentIds = ['gar_kente_wrap', 'gar_linen_trouser']) {
  return createLook(db, track, { userId, avatarId: makeAvatar(userId).id, garmentIds, caption: 'test' });
}

// ---------------------------------------------------------------- money

describe('money', () => {
  test('commission split is integer throughout and the remainder goes to the platform', () => {
    // 12% of 24000 = 2880 gross; 60% of that = 1728 to earner, 1152 to platform.
    const split = splitCommission({ amountMinor: 24000, rateBps: 1200, sharerBps: 6000 });
    assert.deepEqual(split, { grossMinor: 2880, earnerMinor: 1728, platformMinor: 1152 });
    assert.equal(split.earnerMinor + split.platformMinor, split.grossMinor);
  });

  test('rounding remainders land on the platform, never inflating the earner', () => {
    // 1% of 101 = 1.01 -> 1 gross; 50% of 1 = 0.5 -> 0 to earner, 1 to platform.
    const split = splitCommission({ amountMinor: 101, rateBps: 100, sharerBps: 5000 });
    assert.equal(split.grossMinor, 1);
    assert.equal(split.earnerMinor, 0);
    assert.equal(split.platformMinor, 1);
  });

  test('shares always reconcile to the gross across a range of inputs', () => {
    for (let amount = 0; amount < 5000; amount += 137) {
      for (const rate of [0, 1, 850, 1200, 10000]) {
        const s = splitCommission({ amountMinor: amount, rateBps: rate, sharerBps: 6500 });
        assert.equal(s.earnerMinor + s.platformMinor, s.grossMinor);
        assert.ok(s.grossMinor <= amount, 'commission exceeded the order');
        assert.ok(Number.isInteger(s.earnerMinor) && Number.isInteger(s.platformMinor));
      }
    }
  });

  test('rejects floats, negatives and out-of-range basis points', () => {
    assert.throws(() => applyBps(10.5, 100), MoneyError);
    assert.throws(() => applyBps(-1, 100), MoneyError);
    assert.throws(() => applyBps(100, 10001), MoneyError);
    assert.throws(() => splitCommission({ amountMinor: 100, rateBps: 100, sharerBps: -5 }), MoneyError);
  });

  test('formatting pads minor units correctly for two-decimal currencies', () => {
    assert.equal(formatMinor(2405, 'GHS'), 'GHS 24.05');
    assert.equal(formatMinor(2400, 'GHS'), 'GHS 24.00');
    assert.equal(formatMinor(5, 'GHS'), 'GHS 0.05');
    assert.equal(formatMinor(0, 'GHS'), 'GHS 0.00');
    assert.equal(formatMinor(123456789, 'GHS'), 'GHS 1,234,567.89');
  });

  test('zero-decimal currencies are not rendered 100x too small', () => {
    assert.equal(exponentFor('VND'), 0);
    assert.equal(exponentFor('COP'), 0);
    assert.equal(formatMinor(1850000, 'VND'), 'VND 1,850,000');
    assert.equal(formatMinor(320000, 'COP'), 'COP 320,000');
  });

  test('an unknown currency falls back to two decimals rather than throwing', () => {
    assert.equal(exponentFor('XYZ'), 2);
    assert.equal(formatMinor(1000, 'XYZ'), 'XYZ 10.00');
  });
});

// ---------------------------------------------------------------- render

describe('try-on compositor', () => {
  const avatar = { name: 'A', skin_tone: 'bronze', hair_style: 'coils', hair_color: '#2b1d16', height_cm: 168, shoulder_w: 88, waist_w: 66, hip_w: 96 };
  const top = { id: 'g1', name: 'Top', slot: 'top', color: '#c94f3d', accent: '#f2c14e', pattern: 'stripe' };
  const bottom = { id: 'g2', name: 'Trouser', slot: 'bottom', color: '#2f4f4f', accent: '#5d8a8a', pattern: 'weave' };

  test('is deterministic — the same input yields byte-identical output', () => {
    const a = LocalCompositor.render(avatar, [top, bottom]).svg;
    const b = LocalCompositor.render(avatar, [bottom, top]).svg; // order must not matter
    assert.equal(a, b);
  });

  test('different measurements produce different output', () => {
    const a = LocalCompositor.render(avatar, [top]).svg;
    const b = LocalCompositor.render({ ...avatar, height_cm: 190 }, [top]).svg;
    assert.notEqual(a, b);
  });

  test('every hair style and skin tone renders valid, balanced SVG', () => {
    for (const hair_style of HAIR_STYLES) {
      for (const skin_tone of Object.keys(SKIN_TONES)) {
        const { svg } = LocalCompositor.render({ ...avatar, hair_style, skin_tone }, [top]);
        assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
        const open = (svg.match(/<(?!\/)[a-zA-Z]/g) ?? []).length;
        const closed = (svg.match(/<\/[a-zA-Z]/g) ?? []).length + (svg.match(/\/>/g) ?? []).length;
        assert.equal(open, closed, `unbalanced tags for ${hair_style}/${skin_tone}`);
      }
    }
  });

  test('renders with no garments — the studio preview must work before shopping', () => {
    assert.ok(LocalCompositor.render(avatar, []).svg.includes('<svg'));
  });

  test('a dress cannot be layered with a top or a bottom', () => {
    const dress = { id: 'g3', name: 'Dress', slot: 'dress', color: '#000000', accent: '#ffffff', pattern: 'solid' };
    assert.throws(() => validateOutfit([dress, top]), RenderError);
    assert.throws(() => validateOutfit([dress, bottom]), RenderError);
    assert.doesNotThrow(() => validateOutfit([dress]));
  });

  test('two garments cannot compete for one slot', () => {
    assert.throws(() => validateOutfit([top, { ...top, id: 'g9' }]), /compete/);
  });

  test('an unconfigured provider fails loudly rather than silently degrading', () => {
    assert.throws(() => createProvider('hosted-diffusion'), RenderError);
    assert.equal(createProvider('local'), LocalCompositor);
  });

  test('garment names are XML-escaped into the accessibility label', () => {
    const { svg } = LocalCompositor.render(avatar, [{ ...top, name: 'Ann & "Co" <script>' }]);
    assert.ok(!svg.includes('<script>'));
    assert.ok(svg.includes('&amp;') && svg.includes('&quot;'));
    assert.equal(escapeXml(`<&>"'`), '&lt;&amp;&gt;&quot;&apos;');
  });
});

// ---------------------------------------------------------------- accounts

describe('accounts and referral', () => {
  test('rejects malformed handles and duplicates', () => {
    makeUser('ama');
    assert.throws(() => makeUser('ama'), /taken/);
    for (const bad of ['ab', 'Has Caps', 'way_too_long_a_handle_here', 'sp ace', '']) {
      assert.throws(() => makeUser(bad), AccountError, `accepted '${bad}'`);
    }
  });

  test('a valid referral code attributes the signup and emits referred_signup', () => {
    const referrer = makeUser('ama');
    const joiner = makeUser('kofi', { referralCode: referrer.referral_code, lookSlug: 'amber-hem-abcde' });
    assert.equal(joiner.referred_by, referrer.id);
    const events = db.prepare("SELECT name FROM events WHERE user_id = ? ORDER BY created_at").all(joiner.id).map((e) => e.name);
    assert.deepEqual(events, ['signup', 'referred_signup']);
  });

  test('an unresolvable referral code is ignored, not rejected — links outlive accounts', () => {
    const joiner = makeUser('kofi', { referralCode: 'deleted-user-code' });
    assert.equal(joiner.referred_by, null);
    const names = db.prepare('SELECT name FROM events WHERE user_id = ?').all(joiner.id).map((e) => e.name);
    assert.deepEqual(names, ['signup']);
  });
});

// ---------------------------------------------------------------- avatars

describe('avatars', () => {
  test('measurements outside published bounds are refused', () => {
    const user = makeUser('ama');
    for (const override of [{ heightCm: 139 }, { heightCm: 211 }, { shoulderW: 10 }, { hipW: 500 }, { waistW: 'wide' }]) {
      assert.throws(() => createAvatar(db, { ...AVATAR, ...override, userId: user.id }), AvatarError, JSON.stringify(override));
    }
  });

  test('unknown skin tones and hair styles are refused with the valid set named', () => {
    const user = makeUser('ama');
    assert.throws(() => createAvatar(db, { ...AVATAR, skinTone: 'neon', userId: user.id }), /Choose one of/);
    assert.throws(() => createAvatar(db, { ...AVATAR, hairStyle: 'mohawk', userId: user.id }), /Choose one of/);
    assert.throws(() => createAvatar(db, { ...AVATAR, hairColor: 'brown', userId: user.id }), /hex/);
  });
});

// ---------------------------------------------------------------- looks

describe('looks', () => {
  test('creating a look emits core_action and yields a legible slug', () => {
    const user = makeUser('ama');
    const look = makeLook(user.id);
    assert.match(look.slug, /^[a-z]+-[a-z]+-[0-9a-f]{5}$/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE name = 'core_action'").get().n, 1);
  });

  test('slug allocation retries past a collision instead of overwriting', () => {
    const user = makeUser('ama');
    // Force the first four random draws to collide with an existing slug.
    const first = makeLook(user.id);
    const fixed = Buffer.from([
      ADJ_INDEX(first.slug), NOUN_INDEX(first.slug), ...hexBytes(first.slug)
    ]);
    let calls = 0;
    const rand = (n) => { calls += 1; return calls <= 3 ? fixed.subarray(0, n) : Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + calls) % 256)); };
    const second = createLook(db, track, { userId: user.id, avatarId: makeAvatar(user.id).id, garmentIds: ['gar_adinkra_tee'] }, { rand });
    assert.notEqual(second.slug, first.slug);
    assert.ok(calls > 3, 'expected retries after collisions');
  });

  test('a look needs at least one garment and at most four', () => {
    const user = makeUser('ama');
    const avatarId = makeAvatar(user.id).id;
    assert.throws(() => createLook(db, track, { userId: user.id, avatarId, garmentIds: [] }), /at least one/);
    assert.throws(
      () => createLook(db, track, { userId: user.id, avatarId, garmentIds: ['gar_kente_wrap', 'gar_adinkra_tee', 'gar_linen_trouser', 'gar_batik_skirt', 'gar_wool_coat'] }),
      /at most/
    );
  });

  test('a look cannot borrow someone else\'s avatar', () => {
    const owner = makeUser('ama');
    const other = makeUser('kofi');
    const avatarId = makeAvatar(owner.id).id;
    assert.throws(() => createLook(db, track, { userId: other.id, avatarId, garmentIds: ['gar_kente_wrap'] }), /belongs to someone else/);
  });

  test('an inactive or unknown garment is refused', () => {
    const user = makeUser('ama');
    const avatarId = makeAvatar(user.id).id;
    db.prepare('UPDATE garments SET active = 0 WHERE id = ?').run('gar_kente_wrap');
    assert.throws(() => createLook(db, track, { userId: user.id, avatarId, garmentIds: ['gar_kente_wrap'] }), /not available/);
    assert.throws(() => createLook(db, track, { userId: user.id, avatarId, garmentIds: ['nope'] }), /not available/);
  });

  test('only the owner may share a look', () => {
    const owner = makeUser('ama');
    const other = makeUser('kofi');
    const look = makeLook(owner.id);
    assert.throws(() => recordShare(db, track, { slug: look.slug, userId: other.id }), /Only the owner/);
    const share = recordShare(db, track, { slug: look.slug, userId: owner.id, channel: 'whatsapp' });
    assert.match(share.shareUrl, /^\/l\/.+\?ref=/);
  });
});

describe('preview', () => {
  test('previewing renders but persists nothing and emits no event', () => {
    const user = makeUser('ama');
    const avatarId = makeAvatar(user.id).id;
    const before = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;

    const out = previewLook(db, { userId: user.id, avatarId, garmentIds: ['gar_kente_wrap', 'gar_linen_trouser'] });
    assert.ok(out.svg.startsWith('<svg'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM looks').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, before);
  });

  test('preview enforces the same ownership and slot rules as saving', () => {
    const owner = makeUser('ama');
    const other = makeUser('kofi');
    const avatarId = makeAvatar(owner.id).id;
    assert.throws(() => previewLook(db, { userId: other.id, avatarId, garmentIds: ['gar_kente_wrap'] }), /belongs to someone else/);
    assert.throws(() => previewLook(db, { userId: owner.id, avatarId, garmentIds: ['gar_kaba_dress', 'gar_kente_wrap'] }), /cannot be layered/);
  });

  test('previewing an empty outfit is allowed — the studio needs a bare figure', () => {
    const user = makeUser('ama');
    const avatarId = makeAvatar(user.id).id;
    assert.ok(previewLook(db, { userId: user.id, avatarId, garmentIds: [] }).svg.includes('<svg'));
  });
});

// ------------------------------------------------------- view accounting

describe('view accounting', () => {
  test('the sharer viewing their own look never counts as reach', () => {
    const owner = makeUser('ama');
    const look = makeLook(owner.id);
    const result = recordView(db, track, { slug: look.slug, viewerKey: 'vk-owner', viewerUserId: owner.id });
    assert.equal(result.counted, false);
    assert.equal(result.isSelf, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE name = 'share_view'").get().n, 0);
  });

  test('a repeat view by the same viewer is recorded once', () => {
    const owner = makeUser('ama');
    const look = makeLook(owner.id);
    assert.equal(recordView(db, track, { slug: look.slug, viewerKey: 'vk-1' }).counted, true);
    const second = recordView(db, track, { slug: look.slug, viewerKey: 'vk-1' });
    assert.equal(second.counted, false);
    assert.equal(second.repeat, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE name = 'share_view'").get().n, 1);
  });

  test('distinct viewers each count once', () => {
    const owner = makeUser('ama');
    const look = makeLook(owner.id);
    for (const key of ['a', 'b', 'c']) recordView(db, track, { slug: look.slug, viewerKey: key });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE name = 'share_view'").get().n, 3);
  });

  test('viewer keys are salted hashes, not raw addresses', () => {
    const hashed = viewerKey('203.0.113.9', 'salt');
    assert.ok(!hashed.includes('203.0.113.9'));
    assert.equal(hashed.length, 32);
    assert.notEqual(hashed, viewerKey('203.0.113.9', 'other-salt'));
  });
});

// ---------------------------------------------------------- attribution

describe('attribution and commissions', () => {
  function setup() {
    const sharer = makeUser('ama');
    const look = makeLook(sharer.id, ['gar_kente_wrap']);
    return { sharer, look };
  }

  test('an attributed order pays the sharer at the boutique rate', () => {
    const { sharer, look } = setup();
    const click = recordClick(db, { slug: look.slug, garmentId: 'gar_kente_wrap', viewerKey: 'buyer' });
    const result = recordOrder(db, track, {
      externalId: 'ord-1', garmentId: 'gar_kente_wrap', attributionToken: click.token,
      buyerKey: 'buyer', amountMinor: 24000, currency: 'GHS'
    });
    assert.equal(result.attributed, true);
    assert.equal(result.commission.earnerId, sharer.id);
    assert.deepEqual(
      { g: result.commission.grossMinor, e: result.commission.earnerMinor, p: result.commission.platformMinor },
      { g: 2880, e: 1728, p: 1152 }
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE name = 'revenue'").get().n, 1);
  });

  test('a token past the attribution window pays nothing', () => {
    const { look } = setup();
    const t0 = Date.now();
    const click = recordClick(db, { slug: look.slug, garmentId: 'gar_kente_wrap', viewerKey: 'buyer' }, () => t0);
    const result = recordOrder(db, track, {
      externalId: 'ord-late', garmentId: 'gar_kente_wrap', attributionToken: click.token,
      buyerKey: 'buyer', amountMinor: 24000, currency: 'GHS'
    }, () => t0 + ATTRIBUTION_WINDOW_MS + 1);
    assert.equal(result.attributed, false);
    assert.equal(result.reason, 'attribution window expired');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commissions').get().n, 0);
  });

  test('the boundary of the window is exclusive at expiry and inclusive before it', () => {
    const { look } = setup();
    const t0 = Date.now();
    const click = recordClick(db, { slug: look.slug, garmentId: 'gar_kente_wrap', viewerKey: 'b' }, () => t0);
    const order = (id, at) => recordOrder(db, track, {
      externalId: id, garmentId: 'gar_kente_wrap', attributionToken: click.token, buyerKey: 'b', amountMinor: 24000, currency: 'GHS'
    }, () => at);
    assert.equal(order('just-inside', t0 + ATTRIBUTION_WINDOW_MS - 1).attributed, true);
    assert.equal(order('exactly-at', t0 + ATTRIBUTION_WINDOW_MS).attributed, false);
  });

  test('a sharer never earns on their own purchase', () => {
    const { sharer, look } = setup();
    const click = recordClick(db, { slug: look.slug, garmentId: 'gar_kente_wrap', viewerKey: 'self', viewerUserId: sharer.id });
    assert.equal(click.selfReferral, true);
    const result = recordOrder(db, track, {
      externalId: 'ord-self', garmentId: 'gar_kente_wrap', attributionToken: click.token,
      buyerKey: 'self', amountMinor: 24000, currency: 'GHS'
    });
    assert.equal(result.attributed, false);
    assert.equal(result.reason, 'self-referral');
    assert.equal(earningsFor(db, sharer.id).commissions.length, 0);
  });

  test('a retried webhook cannot pay twice', () => {
    const { look } = setup();
    const click = recordClick(db, { slug: look.slug, garmentId: 'gar_kente_wrap', viewerKey: 'buyer' });
    const payload = { externalId: 'ord-dup', garmentId: 'gar_kente_wrap', attributionToken: click.token, buyerKey: 'buyer', amountMinor: 24000, currency: 'GHS' };
    recordOrder(db, track, payload);
    assert.throws(() => recordOrder(db, track, payload), /already been recorded/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commissions').get().n, 1);
  });

  test('a token issued for a different garment does not transfer', () => {
    const { look } = setup();
    const click = recordClick(db, { slug: look.slug, garmentId: 'gar_kente_wrap', viewerKey: 'buyer' });
    const result = recordOrder(db, track, {
      externalId: 'ord-x', garmentId: 'gar_adinkra_tee', attributionToken: click.token,
      buyerKey: 'buyer', amountMinor: 13500, currency: 'GHS'
    });
    assert.equal(result.reason, 'token was issued for a different garment');
  });

  test('a click may only reference a garment actually in the look', () => {
    const { look } = setup();
    assert.throws(() => recordClick(db, { slug: look.slug, garmentId: 'gar_wool_coat', viewerKey: 'b' }), /not part of this look/);
  });

  test('currency mismatches are refused rather than coerced', () => {
    const { look } = setup();
    const click = recordClick(db, { slug: look.slug, garmentId: 'gar_kente_wrap', viewerKey: 'b' });
    assert.throws(() => recordOrder(db, track, {
      externalId: 'ord-cur', garmentId: 'gar_kente_wrap', attributionToken: click.token,
      buyerKey: 'b', amountMinor: 24000, currency: 'USD'
    }), /Currency mismatch/);
  });

  test('an unattributed order is still recorded — the sale happened', () => {
    setup();
    const result = recordOrder(db, track, {
      externalId: 'ord-organic', garmentId: 'gar_kente_wrap', attributionToken: null,
      buyerKey: 'walk-in', amountMinor: 24000, currency: 'GHS'
    });
    assert.equal(result.attributed, false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commissions').get().n, 0);
  });

  test('earnings roll up per currency and stay pending until paid', () => {
    const { sharer, look } = setup();
    const click = recordClick(db, { slug: look.slug, garmentId: 'gar_kente_wrap', viewerKey: 'b' });
    recordOrder(db, track, { externalId: 'o1', garmentId: 'gar_kente_wrap', attributionToken: click.token, buyerKey: 'b', amountMinor: 24000, currency: 'GHS' });
    const { totals } = earningsFor(db, sharer.id);
    assert.equal(totals.GHS.earnedMinor, 1728);
    assert.equal(totals.GHS.pendingMinor, 1728);
    assert.equal(totals.GHS.paidMinor, 0);
  });
});

// ---------------------------------------------------------------- growth

describe('growth metrics', () => {
  test('K is computed from real events as invites-per-user x conversion', () => {
    const sharer = makeUser('ama');
    const look = makeLook(sharer.id);
    recordShare(db, track, { slug: look.slug, userId: sharer.id });
    recordShare(db, track, { slug: look.slug, userId: sharer.id });
    for (const key of ['v1', 'v2', 'v3', 'v4']) recordView(db, track, { slug: look.slug, viewerKey: key });
    makeUser('kofi', { referralCode: sharer.referral_code });

    const m = loopMetrics(db);
    assert.equal(m.counts.activeUsers, 1);
    assert.equal(m.invitesPerUser, 2);          // 2 shares / 1 active user
    assert.equal(m.inviteConversion, 0.25);     // 1 referred signup / 4 new viewers
    assert.equal(m.k, 0.5);
    assert.equal(m.amplification, 2);
    assert.equal(m.reachPerShare, 2);
  });

  test('metrics are safe on an empty database rather than dividing by zero', () => {
    const m = loopMetrics(db);
    assert.equal(m.k, 0);
    assert.equal(m.invitesPerUser, 0);
    assert.equal(m.cycleTimeHours, null);
    assert.equal(d7Retention(db).rate, null);
  });

  test('cycle time is the median hours from signup to first share', () => {
    const t0 = Date.now();
    const a = createUser(db, track, { handle: 'aaa', displayName: 'a' }, () => t0);
    const b = createUser(db, track, { handle: 'bbb', displayName: 'b' }, () => t0);
    const c = createUser(db, track, { handle: 'ccc', displayName: 'c' }, () => t0);
    for (const [user, hours] of [[a, 2], [b, 6], [c, 40]]) {
      const look = makeLook(user.id);
      recordShare(db, track, { slug: look.slug, userId: user.id }, () => t0 + hours * 3_600_000);
    }
    assert.equal(medianCycleTimeHours(db), 6); // median of 2, 6, 40 — not the mean of 16
  });

  test('D7 uses a fixed window, so a day-30 return does not count as retained', () => {
    const t0 = Date.now() - 60 * 24 * 3_600_000;
    const early = createUser(db, track, { handle: 'early', displayName: 'e' }, () => t0);
    const late = createUser(db, track, { handle: 'late', displayName: 'l' }, () => t0);

    const inWindow = createTracker(db, () => t0 + 160 * 3_600_000);
    createLook(db, inWindow, { userId: early.id, avatarId: makeAvatar(early.id).id, garmentIds: ['gar_kente_wrap'] });

    const outOfWindow = createTracker(db, () => t0 + 30 * 24 * 3_600_000);
    createLook(db, outOfWindow, { userId: late.id, avatarId: makeAvatar(late.id).id, garmentIds: ['gar_adinkra_tee'] });

    const d7 = d7Retention(db);
    assert.equal(d7.cohortSize, 2);
    assert.equal(d7.retained, 1, 'the day-30 return must not count toward D7');
    assert.equal(d7.rate, 0.5);
  });

  test('attribution rate reports the share of orders that carried a token', () => {
    const sharer = makeUser('ama');
    const look = makeLook(sharer.id, ['gar_kente_wrap']);
    const click = recordClick(db, { slug: look.slug, garmentId: 'gar_kente_wrap', viewerKey: 'b' });
    recordOrder(db, track, { externalId: 'o1', garmentId: 'gar_kente_wrap', attributionToken: click.token, buyerKey: 'b', amountMinor: 24000, currency: 'GHS' });
    recordOrder(db, track, { externalId: 'o2', garmentId: 'gar_kente_wrap', attributionToken: null, buyerKey: 'w', amountMinor: 24000, currency: 'GHS' });
    assert.equal(loopMetrics(db).revenue.orders.attributionRate, 0.5);
  });
});

// ------------------------------------------------------- instrumentation

describe('loop instrumentation', () => {
  test('the six framework event names are exactly the ones this app emits', () => {
    assert.deepEqual(LOOP_EVENTS, ['signup', 'core_action', 'share', 'share_view', 'referred_signup', 'revenue']);
  });

  test('an unknown event name throws instead of silently creating a seventh', () => {
    assert.throws(() => track('user_engaged'), EventError);
  });

  test('a full loop pass emits every one of the six from real code paths', () => {
    const sharer = makeUser('ama');
    const look = makeLook(sharer.id, ['gar_kente_wrap']);
    recordShare(db, track, { slug: look.slug, userId: sharer.id });
    recordView(db, track, { slug: look.slug, viewerKey: 'visitor' });
    makeUser('kofi', { referralCode: sharer.referral_code, lookSlug: look.slug });
    const click = recordClick(db, { slug: look.slug, garmentId: 'gar_kente_wrap', viewerKey: 'visitor' });
    recordOrder(db, track, { externalId: 'o1', garmentId: 'gar_kente_wrap', attributionToken: click.token, buyerKey: 'visitor', amountMinor: 24000, currency: 'GHS' });

    const emitted = new Set(db.prepare('SELECT DISTINCT name FROM events').all().map((e) => e.name));
    for (const name of LOOP_EVENTS) assert.ok(emitted.has(name), `loop event '${name}' never fired`);
  });
});

// ---------------------------------------------------------------- webhook signing

describe('webhook signatures', () => {
  test('a valid signature over the exact bytes verifies', () => {
    const raw = JSON.stringify({ externalId: 'o1', amountMinor: 24000 });
    assert.equal(verifySignature(raw, signPayload(raw, 'secret'), 'secret'), true);
  });

  test('a tampered body, a wrong secret, and a missing signature all fail', () => {
    const raw = JSON.stringify({ amountMinor: 24000 });
    const sig = signPayload(raw, 'secret');
    assert.equal(verifySignature(JSON.stringify({ amountMinor: 2400000 }), sig, 'secret'), false);
    assert.equal(verifySignature(raw, sig, 'other-secret'), false);
    assert.equal(verifySignature(raw, undefined, 'secret'), false);
    assert.equal(verifySignature(raw, 'short', 'secret'), false, 'a length mismatch must not throw');
  });
});

describe('share slugs', () => {
  test('are legible and carry hex entropy', () => {
    for (let i = 0; i < 50; i += 1) assert.match(shareSlug(), /^[a-z]+-[a-z]+-[0-9a-f]{5}$/);
  });

  test('collide rarely enough to be usable', () => {
    const seen = new Set();
    for (let i = 0; i < 3000; i += 1) seen.add(shareSlug());
    assert.ok(seen.size > 2950, `too many collisions: ${3000 - seen.size}`);
  });
});

// Helpers for the slug-collision test: recover the byte values that produced a slug.
const ADJECTIVES = ['amber', 'linen', 'dusk', 'coral', 'indigo', 'sable', 'ivory', 'jade', 'rust', 'slate', 'plum', 'ochre'];
const NOUNS = ['drape', 'hem', 'cuff', 'weave', 'pleat', 'sash', 'stitch', 'fold', 'thread', 'panel'];
const ADJ_INDEX = (slug) => ADJECTIVES.indexOf(slug.split('-')[0]);
const NOUN_INDEX = (slug) => NOUNS.indexOf(slug.split('-')[1]);
const hexBytes = (slug) => {
  const hex = slug.split('-')[2].padEnd(8, '0');
  return [0, 2, 4, 6].map((i) => parseInt(hex.slice(i, i + 2), 16));
};

// ------------------------------------------------------------------ demo

describe('demo cohort', () => {
  test('produces a coherent loop through the real services, not fabricated rows', async () => {
    const fresh = openDatabase(':memory:');
    const summary = await runDemo(fresh, { seedUsers: 6, viewsPerShare: 4, seed: 7 });

    assert.ok(summary.users > 6, 'referred signups should grow the cohort beyond the seed');
    assert.equal(summary.referred, summary.users - 6);
    assert.ok(summary.shares > 0 && summary.views > 0);

    const m = loopMetrics(fresh);
    assert.equal(m.k, Math.round(m.invitesPerUser * m.inviteConversion * 1000) / 1000);
    assert.ok(m.inviteConversion > 0 && m.inviteConversion <= 1);
    assert.ok(m.cycleTimeHours > 0);

    // Every commission must trace to an order that carried a live token.
    const orphans = fresh.prepare(
      `SELECT COUNT(*) AS n FROM commissions c
         JOIN orders o ON o.id = c.order_id
        WHERE o.attribution_token IS NULL`
    ).get().n;
    assert.equal(orphans, 0, 'a commission was written without an attributed order');
  });

  test('is deterministic for a given seed', async () => {
    const a = await runDemo(openDatabase(':memory:'), { seedUsers: 4, viewsPerShare: 3, seed: 99 });
    const b = await runDemo(openDatabase(':memory:'), { seedUsers: 4, viewsPerShare: 3, seed: 99 });
    assert.deepEqual(a, b);
  });

  test('includes unattributed walk-in orders, so attribution is never a suspicious 100%', async () => {
    const fresh = openDatabase(':memory:');
    await runDemo(fresh, { seedUsers: 4, viewsPerShare: 3, seed: 11 });
    const rate = loopMetrics(fresh).revenue.orders.attributionRate;
    assert.ok(rate > 0 && rate < 1, `attribution rate was ${rate}`);
  });

  test('return visits land inside the D7 window and lift retention off zero', async () => {
    const fresh = openDatabase(':memory:');
    await runDemo(fresh, { seedUsers: 8, viewsPerShare: 3, returnRate: 1, seed: 5 });
    assert.ok(d7Retention(fresh).rate > 0.5, 'a returnRate of 1 should retain most of the cohort');
  });
});
