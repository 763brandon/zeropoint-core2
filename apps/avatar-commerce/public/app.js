/**
 * AI-Avatar Commerce client.
 *
 * Two entry paths: the public share view (/l/:slug), which must work with no
 * account, and the application shell. Everything renders from the API — there
 * is no client-side copy of the domain rules.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const store = {
  get userId() { return localStorage.getItem('userId'); },
  set userId(v) { v ? localStorage.setItem('userId', v) : localStorage.removeItem('userId'); },
  get viewerKey() {
    let key = localStorage.getItem('viewerKey');
    if (!key) { key = crypto.randomUUID(); localStorage.setItem('viewerKey', key); }
    return key;
  }
};

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'x-viewer-key': store.viewerKey };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (store.userId) headers['x-user-id'] = store.userId;

  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data = text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

const state = { config: null, avatars: [], avatar: null, garments: [], selection: new Map() };

// ------------------------------------------------------------- share view

async function bootShareView(slug) {
  $('#share-view').hidden = false;
  const [look, config] = await Promise.all([api(`/api/looks/${slug}`), api('/api/config')]);

  $('#share-img').src = `/api/looks/${slug}/render.svg`;
  $('#share-img').alt = `${look.owner.display_name}'s look: ${look.garments.map((g) => g.name).join(', ')}`;
  $('#share-owner').textContent = look.owner.display_name;
  $('#share-caption').textContent = look.caption || 'A look worth stealing';
  $('#share-disclosure').textContent = config.disclosure;

  $('#share-garments').innerHTML = look.garments.map((g) => `
    <li>
      <span>
        <span class="nm">${escapeHtml(g.name)}</span>
        <span class="sub">${escapeHtml(g.boutique_name)} · ${escapeHtml(g.boutique_city)} · ${formatMinor(g.price_minor, g.currency)}</span>
      </span>
      <button class="ghost" data-garment="${g.id}">Shop</button>
    </li>`).join('');

  // Counted server-side: the sharer's own views and repeat views never count.
  api(`/api/looks/${slug}/views`, { method: 'POST', body: { referrer: document.referrer } }).catch(() => {});

  $('#share-garments').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-garment]');
    if (!button) return;
    button.disabled = true;
    try {
      const click = await api(`/api/looks/${slug}/clicks`, { method: 'POST', body: { garmentId: button.dataset.garment } });
      button.textContent = 'Opening…';
      window.location.href = click.checkoutUrl;
    } catch (error) {
      button.disabled = false;
      $('#share-error').textContent = error.message;
    }
  });

  const referralCode = new URLSearchParams(location.search).get('ref') ?? look.owner.referral_code;
  $('#share-signup').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('#share-error').textContent = '';
    const handle = new FormData(event.target).get('handle');
    try {
      const user = await api('/api/users', { method: 'POST', body: { handle, displayName: handle, referralCode, lookSlug: slug } });
      store.userId = user.id;
      location.href = '/';
    } catch (error) {
      $('#share-error').textContent = error.message;
    }
  });
}

// ------------------------------------------------------------------- shell

async function bootApp() {
  $('#app').hidden = false;
  state.config = await api('/api/config');

  $('#signup').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('#signup-error').textContent = '';
    const handle = new FormData(event.target).get('handle');
    try {
      const user = await api('/api/users', { method: 'POST', body: { handle, displayName: handle } });
      store.userId = user.id;
      await enterApp();
    } catch (error) {
      $('#signup-error').textContent = error.message;
    }
  });

  $('#tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (button) showTab(button.dataset.tab);
  });

  if (store.userId) {
    try { await enterApp(); } catch { store.userId = null; }
  }
}

async function enterApp() {
  const me = await api('/api/me');
  $('#gate').hidden = true;
  $('#who').innerHTML = `<strong>@${escapeHtml(me.handle)}</strong> · ref ${escapeHtml(me.referral_code)}`;

  buildStudioControls();
  state.avatars = await api('/api/avatars');
  state.avatar = state.avatars[0] ?? null;
  if (state.avatar) applyAvatarToForm(state.avatar);
  renderAvatarList();
  renderStudio();

  state.garments = await api('/api/garments');
  renderRail();
  showTab('studio');
}

function showTab(name) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  for (const section of ['studio', 'boutique', 'looks', 'earnings', 'growth']) {
    $(`#tab-${section}`).hidden = section !== name || !store.userId;
  }
  if (!store.userId) return;
  if (name === 'boutique') renderTryOn();
  if (name === 'looks') loadLooks();
  if (name === 'earnings') loadEarnings();
  if (name === 'growth') loadGrowth();
}

// ------------------------------------------------------------------ studio

function buildStudioControls() {
  $('#skin-swatches').innerHTML = Object.entries(state.config.skinTones)
    .map(([key, hex]) => `<button type="button" data-skin="${key}" style="background:${hex}" title="${key}" aria-pressed="false" aria-label="${key}"></button>`).join('');
  $('#hair-chips').innerHTML = state.config.hairStyles
    .map((style) => `<button type="button" data-hair="${style}" aria-pressed="false">${style}</button>`).join('');

  const form = $('#avatar-form');
  form.dataset.skinTone = Object.keys(state.config.skinTones)[2];
  form.dataset.hairStyle = state.config.hairStyles[0];
  syncPressed();

  $('#skin-swatches').addEventListener('click', (e) => {
    const b = e.target.closest('[data-skin]');
    if (!b) return;
    form.dataset.skinTone = b.dataset.skin; syncPressed(); renderStudio();
  });
  $('#hair-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hair]');
    if (!b) return;
    form.dataset.hairStyle = b.dataset.hair; syncPressed(); renderStudio();
  });
  form.addEventListener('input', () => { syncRangeLabels(); renderStudio(); });
  form.addEventListener('submit', saveAvatar);
  syncRangeLabels();
}

function syncPressed() {
  const form = $('#avatar-form');
  $$('[data-skin]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.skin === form.dataset.skinTone)));
  $$('[data-hair]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.hair === form.dataset.hairStyle)));
}

function syncRangeLabels() {
  for (const span of $$('.val')) {
    const input = $(`[name="${span.dataset.for}"]`);
    if (input) span.textContent = span.dataset.for === 'heightCm' ? `${input.value} cm` : input.value;
  }
}

function readAvatarForm() {
  const form = $('#avatar-form');
  const data = new FormData(form);
  return {
    name: data.get('name'),
    skinTone: form.dataset.skinTone,
    hairStyle: form.dataset.hairStyle,
    hairColor: data.get('hairColor'),
    heightCm: Number(data.get('heightCm')),
    shoulderW: Number(data.get('shoulderW')),
    waistW: Number(data.get('waistW')),
    hipW: Number(data.get('hipW'))
  };
}

function applyAvatarToForm(avatar) {
  const form = $('#avatar-form');
  form.dataset.skinTone = avatar.skin_tone;
  form.dataset.hairStyle = avatar.hair_style;
  form.elements.name.value = avatar.name;
  form.elements.hairColor.value = avatar.hair_color;
  form.elements.heightCm.value = avatar.height_cm;
  form.elements.shoulderW.value = avatar.shoulder_w;
  form.elements.waistW.value = avatar.waist_w;
  form.elements.hipW.value = avatar.hip_w;
  syncPressed(); syncRangeLabels();
}

/**
 * The studio preview is drawn locally from a saved look when one exists, and
 * otherwise falls back to a silhouette placeholder. Rendering is a server
 * responsibility, so an unsaved avatar has no render endpoint to call — the
 * placeholder makes that state explicit rather than showing a stale figure.
 */
function renderStudio() {
  $('#studio-render').innerHTML = placeholderFigure(readAvatarForm());
}

function placeholderFigure(a) {
  const tone = state.config.skinTones[a.skinTone];
  const scale = a.heightCm / 170;
  return `<svg viewBox="0 0 300 520" width="300" height="520" role="img" aria-label="Avatar preview">
    <rect width="300" height="520" fill="#1c1a24"/>
    <ellipse cx="150" cy="${Math.round(14 + (470 - 14) * scale) + 12}" rx="${Math.round(a.hipW * 0.72)}" ry="9" fill="rgba(0,0,0,.35)"/>
    <circle cx="150" cy="${Math.round(14 + (66 - 14) * scale)}" r="26" fill="${tone}"/>
    <path d="M ${150 - a.shoulderW / 2} ${Math.round(14 + (96 - 14) * scale)}
             L ${150 - a.waistW / 2} ${Math.round(14 + (210 - 14) * scale)}
             L ${150 - a.hipW / 2} ${Math.round(14 + (262 - 14) * scale)}
             L ${150 + a.hipW / 2} ${Math.round(14 + (262 - 14) * scale)}
             L ${150 + a.waistW / 2} ${Math.round(14 + (210 - 14) * scale)}
             L ${150 + a.shoulderW / 2} ${Math.round(14 + (96 - 14) * scale)} Z" fill="${tone}"/>
    <rect x="126" y="${Math.round(14 + (262 - 14) * scale)}" width="20" height="${Math.round((470 - 262) * scale)}" fill="${tone}"/>
    <rect x="154" y="${Math.round(14 + (262 - 14) * scale)}" width="20" height="${Math.round((470 - 262) * scale)}" fill="${tone}"/>
    <text x="150" y="500" text-anchor="middle" fill="#a49fb4" font-size="11" font-family="sans-serif">preview — try garments on in Boutique</text>
  </svg>`;
}

async function saveAvatar(event) {
  event.preventDefault();
  $('#avatar-error').textContent = '';
  try {
    state.avatar = await api('/api/avatars', { method: 'POST', body: readAvatarForm() });
    state.avatars = await api('/api/avatars');
    renderAvatarList();
    showTab('boutique');
  } catch (error) {
    $('#avatar-error').textContent = error.message;
  }
}

function renderAvatarList() {
  $('#avatar-list').innerHTML = state.avatars.length
    ? `<p class="hint">${state.avatars.length} saved. Active: <strong>${escapeHtml(state.avatar?.name ?? '—')}</strong></p>`
    : '';
}

// ---------------------------------------------------------------- boutique

function renderRail() {
  const slots = ['top', 'bottom', 'dress', 'outer'];
  $('#rail').innerHTML = slots.map((slot) => {
    const items = state.garments.filter((g) => g.slot === slot);
    if (!items.length) return '';
    return `<div class="slot-group"><h3>${slot}</h3><div class="garment-grid">${items.map((g) => `
      <button type="button" class="garment" data-garment="${g.id}" data-slot="${slot}" aria-pressed="false">
        <span class="dot" style="background:${g.color}"></span>
        <span class="who-what">
          <span class="nm">${escapeHtml(g.name)}</span>
          <span class="sub">${escapeHtml(g.boutique_name)} · ${escapeHtml(g.priceLabel)}</span>
        </span>
      </button>`).join('')}</div></div>`;
  }).join('');

  $('#rail').addEventListener('click', (e) => {
    const button = e.target.closest('[data-garment]');
    if (!button) return;
    toggleGarment(button.dataset.garment, button.dataset.slot);
  });
  $('#look-form').addEventListener('submit', saveLook);
}

/**
 * Slot rules are mirrored here only to keep the UI honest about what it will
 * accept. The server validates independently and is the authority.
 */
function toggleGarment(garmentId, slot) {
  if (state.selection.get(slot) === garmentId) state.selection.delete(slot);
  else {
    state.selection.set(slot, garmentId);
    if (slot === 'dress') { state.selection.delete('top'); state.selection.delete('bottom'); }
    if (slot === 'top' || slot === 'bottom') state.selection.delete('dress');
  }
  renderTryOn();
}

async function renderTryOn() {
  const chosen = [...state.selection.values()];
  $$('#rail [data-garment]').forEach((b) => b.setAttribute('aria-pressed', String(chosen.includes(b.dataset.garment))));

  const garments = chosen.map((id) => state.garments.find((g) => g.id === id));
  $('#tryon-summary').innerHTML = garments.length
    ? garments.map((g) => `<div><strong>${escapeHtml(g.name)}</strong> — ${escapeHtml(g.boutique_name)}, ${escapeHtml(g.priceLabel)}</div>`).join('')
    : '<div>Pick a garment to try it on.</div>';

  if (!state.avatar) {
    $('#tryon-render').innerHTML = '<p class="empty">Save an avatar in Studio first.</p>';
    return;
  }
  if (!garments.length) {
    $('#tryon-render').innerHTML = placeholderFigure(readAvatarForm());
    return;
  }

  // Preview only. Creating a look here would emit a core_action on every tap
  // and quietly corrupt the activation and K numbers on the Growth tab.
  try {
    const res = await fetch('/api/preview.svg', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': store.userId, 'x-viewer-key': store.viewerKey },
      body: JSON.stringify({ avatarId: state.avatar.id, garmentIds: chosen })
    });
    if (!res.ok) throw new Error((await res.json()).error);
    $('#tryon-render').innerHTML = await res.text();
    $('#look-error').textContent = '';
  } catch (error) {
    $('#look-error').textContent = error.message;
  }
}

async function saveLook(event) {
  event.preventDefault();
  const chosen = [...state.selection.values()];
  if (!chosen.length) { $('#look-error').textContent = 'Try something on first.'; return; }
  if (!state.avatar) { $('#look-error').textContent = 'Save an avatar in Studio first.'; return; }

  const caption = new FormData(event.target).get('caption');
  try {
    // This is the core action: the artefact now exists and is addressable.
    const look = await api('/api/looks', { method: 'POST', body: { avatarId: state.avatar.id, garmentIds: chosen, caption } });
    await api(`/api/looks/${look.slug}/shares`, { method: 'POST', body: { channel: 'link' } });
    event.target.reset();
    showTab('looks');
  } catch (error) {
    $('#look-error').textContent = error.message;
  }
}

// ------------------------------------------------------------------- looks

async function loadLooks() {
  const looks = await api('/api/looks?mine=1');
  $('#looks-grid').innerHTML = looks.length ? looks.map((look) => `
    <article class="look-card">
      <img src="/api/looks/${look.slug}/render.svg" alt="${escapeHtml(look.caption || 'A look')}" loading="lazy">
      <p class="cap">${escapeHtml(look.caption || 'Untitled look')}</p>
      <p class="sub">${look.garments.map((g) => escapeHtml(g.name)).join(' · ')}</p>
      <div class="row"><button class="ghost" data-copy="${look.slug}" data-ref="${look.owner.referral_code}">Copy share link</button></div>
      <code class="share-link">/l/${look.slug}?ref=${look.owner.referral_code}</code>
    </article>`).join('') : '<p class="empty">No looks yet. Try something on in Boutique.</p>';

  $('#looks-grid').onclick = async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const url = `${location.origin}/l/${button.dataset.copy}?ref=${button.dataset.ref}`;
    try {
      await navigator.clipboard.writeText(url);
      await api(`/api/looks/${button.dataset.copy}/shares`, { method: 'POST', body: { channel: 'copy' } });
      button.textContent = 'Copied — share recorded';
    } catch {
      button.textContent = url;
    }
  };
}

// ---------------------------------------------------------------- earnings

async function loadEarnings() {
  const { totals, commissions } = await api('/api/me/earnings');
  const entries = Object.entries(totals);
  $('#earnings-totals').innerHTML = entries.length ? entries.map(([currency, t]) => `
    <div class="stat good"><div class="k">Earned (${currency})</div><div class="v">${t.earnedLabel}</div><div class="n">${t.orders} attributed order${t.orders === 1 ? '' : 's'}</div></div>
    <div class="stat"><div class="k">Pending</div><div class="v">${t.pendingLabel}</div><div class="n">awaiting boutique payout</div></div>`).join('')
    : '<div class="stat"><div class="k">Earned</div><div class="v">—</div><div class="n">no attributed sales yet</div></div>';

  $('#earnings-rows').innerHTML = commissions.length ? commissions.map((c) => `
    <tr>
      <td>${escapeHtml(c.boutique_name)}</td>
      <td>${formatMinor(c.order_amount_minor, c.currency)}</td>
      <td class="num">${formatMinor(c.gross_minor, c.currency)} <span class="sub">(${(c.rate_bps / 100).toFixed(2)}%)</span></td>
      <td class="num">${formatMinor(c.earner_minor, c.currency)}</td>
      <td>${escapeHtml(c.status)}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty">No commissions yet.</td></tr>';
}

// ------------------------------------------------------------------ growth

async function loadGrowth() {
  const m = await api('/api/metrics/viral');
  const band = m.k >= 1 ? 'good' : m.k >= 0.4 ? '' : 'warn';

  $('#growth-stats').innerHTML = `
    <div class="stat ${band}"><div class="k">K</div><div class="v">${m.k}</div><div class="n">${m.k >= 1 ? 'self-sustaining' : m.k >= 0.4 ? 'sub-unity — a CAC discount' : 'no loop yet'}</div></div>
    <div class="stat"><div class="k">Invites / user (i)</div><div class="v">${m.invitesPerUser}</div><div class="n">shares per active user</div></div>
    <div class="stat"><div class="k">Conversion (c)</div><div class="v">${(m.inviteConversion * 100).toFixed(1)}%</div><div class="n">new viewers who sign up</div></div>
    <div class="stat"><div class="k">Amplification</div><div class="v">${m.amplification ?? '∞'}${m.amplification ? '×' : ''}</div><div class="n">users per seeded user</div></div>
    <div class="stat"><div class="k">Cycle time</div><div class="v">${m.cycleTimeHours ?? '—'}</div><div class="n">median hours, signup to first share</div></div>
    <div class="stat"><div class="k">D7 retention</div><div class="v">${m.d7.rate === null ? '—' : `${(m.d7.rate * 100).toFixed(0)}%`}</div><div class="n">fixed window, hours 144–192</div></div>`;

  $('#growth-formula').innerHTML = `
    <code>K = i × c = ${m.invitesPerUser} × ${m.inviteConversion} = ${m.k}</code><br>
    Reach per share: <code>${m.reachPerShare}</code> new viewers ·
    Activation: <code>${(m.activationRate * 100).toFixed(0)}%</code> of signups made a look ·
    Attribution rate: <code>${(m.revenue.orders.attributionRate * 100).toFixed(0)}%</code> of orders carried a token`;

  const c = m.counts;
  $('#growth-counts').innerHTML = Object.entries({
    signups: c.signups, 'active users': c.activeUsers, looks: c.coreActions,
    shares: c.shares, 'new viewers': c.shareViews, 'referred signups': c.referredSignups
  }).map(([k, v]) => `<div><span>${k}</span>${v}</div>`).join('');
}

// ----------------------------------------------------------------- helpers

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function formatMinor(minor, currency) {
  const exponent = state.config?.currencyExponents?.[currency] ?? 2;
  if (exponent === 0) return `${currency} ${minor.toLocaleString('en-US')}`;
  const divisor = 10 ** exponent;
  return `${currency} ${Math.floor(minor / divisor).toLocaleString('en-US')}.${String(minor % divisor).padStart(exponent, '0')}`;
}

const shareMatch = location.pathname.match(/^\/l\/([^/]+)$/);
(shareMatch ? bootShareView(shareMatch[1]) : bootApp()).catch((error) => {
  document.body.insertAdjacentHTML('afterbegin', `<p class="form-error" style="padding:1rem">${escapeHtml(error.message)}</p>`);
});
