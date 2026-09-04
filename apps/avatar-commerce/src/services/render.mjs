/**
 * The try-on compositor — the core transformation of AI-Avatar Commerce.
 *
 * Build spec rule 4: the core action works without a paid third-party API. This
 * is a local, deterministic, layered SVG renderer. Given the same avatar and the
 * same garments it emits byte-identical output, which is what makes it testable
 * and what makes caching safe.
 *
 * A hosted generative provider can be substituted through `TryOnProvider`
 * without touching callers. It is optional by design: a vendor outage must not
 * become a product outage.
 */

const CANVAS = { width: 300, height: 520 };
const CX = 150;

// Anatomical anchor points at reference height (170cm), before vertical scaling.
const ANCHOR = { crown: 14, chin: 66, shoulder: 96, waist: 210, hip: 262, knee: 372, ankle: 470 };

export const SLOTS = ['bottom', 'dress', 'top', 'outer']; // paint order, back to front
export const PATTERNS = ['solid', 'stripe', 'check', 'dot', 'weave'];

export const SKIN_TONES = {
  porcelain: '#f0d5c0', sand: '#e0b48f', honey: '#c8905f',
  bronze: '#a06a3c', umber: '#7a4a28', ebony: '#4e2f1c'
};

export const HAIR_STYLES = ['crop', 'coils', 'braids', 'wave', 'bun', 'locs'];

export class RenderError extends Error {}

/** Vertical scaling anchored at the crown, so height changes read as height. */
function geometry(avatar) {
  const factor = clamp(avatar.height_cm / 170, 0.82, 1.18);
  const y = (anchor) => round(ANCHOR.crown + (anchor - ANCHOR.crown) * factor);
  return {
    factor,
    shoulderY: y(ANCHOR.shoulder),
    waistY: y(ANCHOR.waist),
    hipY: y(ANCHOR.hip),
    kneeY: y(ANCHOR.knee),
    ankleY: y(ANCHOR.ankle),
    chinY: y(ANCHOR.chin),
    crownY: ANCHOR.crown,
    headR: round(26 * Math.min(factor, 1.06)),
    sw: clamp(avatar.shoulder_w, 60, 118),
    ww: clamp(avatar.waist_w, 44, 108),
    hw: clamp(avatar.hip_w, 62, 122)
  };
}

/**
 * Torso outline, reused by the body and by every garment that follows it.
 *
 * Half-widths are explicit rather than always shoulder/waist/hip, because a
 * garment that stops at the waist must not inherit the hip width as its hem —
 * doing so flares every top into a tent.
 */
function torsoPath(g, { inflate = 0, topY = null, bottomY = null, topW = null, midW = null, bottomW = null } = {}) {
  const sw = topW ?? g.sw / 2 + inflate;
  const ww = midW ?? g.ww / 2 + inflate;
  const hw = bottomW ?? g.hw / 2 + inflate;
  const top = topY ?? g.shoulderY;
  const bottom = bottomY ?? g.hipY;
  const mid = round(top + (bottom - top) * 0.62);

  return [
    `M ${round(CX - sw)} ${top}`,
    `Q ${round(CX - sw - 2)} ${round((top + mid) / 2)} ${round(CX - ww)} ${mid}`,
    `Q ${round(CX - hw - 1)} ${round((mid + bottom) / 2)} ${round(CX - hw)} ${bottom}`,
    `L ${round(CX + hw)} ${bottom}`,
    `Q ${round(CX + hw + 1)} ${round((mid + bottom) / 2)} ${round(CX + ww)} ${mid}`,
    `Q ${round(CX + sw + 2)} ${round((top + mid) / 2)} ${round(CX + sw)} ${top}`,
    'Z'
  ].join(' ');
}

function legPath(g, side, { inflate = 0, endY = null } = {}) {
  const dir = side === 'left' ? -1 : 1;
  const hipOuter = CX + dir * (g.hw / 2 + inflate);
  const hipInner = CX + dir * 5;
  const bottom = endY ?? g.ankleY;
  const outerBottom = CX + dir * (24 + inflate);
  const innerBottom = CX + dir * (9 + inflate);
  const knee = g.kneeY;

  return [
    `M ${round(hipOuter)} ${g.hipY}`,
    `Q ${round(hipOuter + dir * 1)} ${knee} ${round(outerBottom)} ${round(bottom)}`,
    `L ${round(innerBottom)} ${round(bottom)}`,
    `Q ${round(hipInner + dir * 3)} ${knee} ${round(hipInner)} ${round(g.hipY + 16)}`,
    'Z'
  ].join(' ');
}

function armPath(g, side, { endY = null, inflate = 0 } = {}) {
  const dir = side === 'left' ? -1 : 1;
  const shoulderOuter = CX + dir * (g.sw / 2 + inflate);
  const shoulderInner = CX + dir * (g.sw / 2 - 12 - inflate);
  const bottom = endY ?? round(g.waistY + 44);
  const wristOuter = CX + dir * (g.sw / 2 + 12 + inflate);
  const wristInner = CX + dir * (g.sw / 2 + 2 - inflate);

  return [
    `M ${round(shoulderOuter)} ${g.shoulderY}`,
    `Q ${round(shoulderOuter + dir * 8)} ${round((g.shoulderY + bottom) / 2)} ${round(wristOuter)} ${bottom}`,
    `L ${round(wristInner)} ${bottom}`,
    `Q ${round(shoulderInner + dir * 6)} ${round((g.shoulderY + bottom) / 2)} ${round(shoulderInner)} ${round(g.shoulderY + 6)}`,
    'Z'
  ].join(' ');
}

function hair(avatar, g) {
  const { headR, crownY, chinY } = g;
  const cy = round(crownY + headR + 4);
  const color = avatar.hair_color;
  switch (avatar.hair_style) {
    case 'coils':
      return circles(cy, headR, color, 9, 1.0);
    case 'locs': {
      // A cap across the crown plus strands that fall beside the face, never
      // across it — strands over the face read as a cage, not as hair.
      const cap = `<path d="M ${round(CX - headR)} ${round(cy - 2)} Q ${CX} ${round(cy - headR - 14)} ${round(CX + headR)} ${round(cy - 2)} L ${round(CX + headR)} ${round(cy - 10)} Q ${CX} ${round(cy - headR - 4)} ${round(CX - headR)} ${round(cy - 10)} Z" fill="${color}"/>`;
      const strands = [-1, 1].flatMap((dir) =>
        [0, 1, 2].map((i) => {
          const x = round(CX + dir * (headR - 2 - i * 5));
          const drop = round(headR * (1.6 - i * 0.25));
          return `<rect x="${round(x - 3)}" y="${round(cy - headR / 2)}" width="6" height="${drop}" rx="3" fill="${color}"/>`;
        })
      ).join('');
      return `${strands}${cap}`;
    }
    case 'braids':
      return `<path d="M ${round(CX - headR)} ${cy} Q ${CX} ${round(cy - headR - 8)} ${round(CX + headR)} ${cy} L ${round(CX + headR - 4)} ${round(chinY + 40)} L ${round(CX + headR - 12)} ${round(chinY + 40)} L ${round(CX + headR - 10)} ${cy} L ${round(CX - headR + 10)} ${cy} L ${round(CX - headR + 12)} ${round(chinY + 40)} L ${round(CX - headR + 4)} ${round(chinY + 40)} Z" fill="${color}"/>`;
    case 'bun':
      return `<circle cx="${CX}" cy="${round(cy - headR - 6)}" r="11" fill="${color}"/><path d="M ${round(CX - headR)} ${cy} Q ${CX} ${round(cy - headR - 10)} ${round(CX + headR)} ${cy} L ${round(CX + headR)} ${round(cy - 4)} Q ${CX} ${round(cy - headR + 4)} ${round(CX - headR)} ${round(cy - 4)} Z" fill="${color}"/>`;
    case 'wave':
      return `<path d="M ${round(CX - headR - 2)} ${round(cy + 6)} Q ${round(CX - headR)} ${round(cy - headR - 10)} ${CX} ${round(cy - headR - 6)} Q ${round(CX + headR)} ${round(cy - headR - 10)} ${round(CX + headR + 2)} ${round(cy + 10)} Q ${round(CX + headR - 6)} ${round(cy - 6)} ${CX} ${round(cy - 4)} Q ${round(CX - headR + 6)} ${round(cy - 6)} ${round(CX - headR - 2)} ${round(cy + 6)} Z" fill="${color}"/>`;
    default: // crop
      return `<path d="M ${round(CX - headR)} ${round(cy - 2)} Q ${CX} ${round(cy - headR - 12)} ${round(CX + headR)} ${round(cy - 2)} L ${round(CX + headR)} ${round(cy - 8)} Q ${CX} ${round(cy - headR - 2)} ${round(CX - headR)} ${round(cy - 8)} Z" fill="${color}"/>`;
  }
}

function circles(cy, r, color, count, spread) {
  return Array.from({ length: count }, (_, i) => {
    const angle = Math.PI + (Math.PI * i) / (count - 1);
    const x = round(CX + Math.cos(angle) * r * spread);
    const y = round(cy + Math.sin(angle) * r * spread);
    return `<circle cx="${x}" cy="${y}" r="8" fill="${color}"/>`;
  }).join('');
}

/**
 * Pattern fills. Ids are derived from the garment id rather than a counter, so
 * output stays identical regardless of the order garments are composited in.
 */
function patternDef(garment) {
  const pid = `p-${garment.id}`;
  const { color, accent, pattern } = garment;
  switch (pattern) {
    case 'stripe':
      return `<pattern id="${pid}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(12)"><rect width="10" height="10" fill="${color}"/><rect width="4" height="10" fill="${accent}"/></pattern>`;
    case 'check':
      return `<pattern id="${pid}" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="${color}"/><rect width="7" height="7" fill="${accent}"/><rect x="7" y="7" width="7" height="7" fill="${accent}"/></pattern>`;
    case 'dot':
      return `<pattern id="${pid}" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="${color}"/><circle cx="6" cy="6" r="2.6" fill="${accent}"/></pattern>`;
    case 'weave':
      return `<pattern id="${pid}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${color}"/><path d="M0 0 L8 8 M8 0 L0 8" stroke="${accent}" stroke-width="1.4" opacity="0.7"/></pattern>`;
    default:
      return `<pattern id="${pid}" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="${color}"/></pattern>`;
  }
}

function garmentShape(garment, g) {
  const fill = `url(#p-${garment.id})`;

  switch (garment.slot) {
    case 'top': {
      const hem = round(g.waistY + 24);
      return [
        `<path d="${torsoPath(g, { inflate: 4, bottomY: hem, midW: g.ww / 2 + 5, bottomW: g.ww / 2 + 8 })}" fill="${fill}" stroke="rgba(0,0,0,0.18)" stroke-width="1"/>`,
        `<path d="${armPath(g, 'left', { endY: round(g.waistY - 6), inflate: 3 })}" fill="${fill}"/>`,
        `<path d="${armPath(g, 'right', { endY: round(g.waistY - 6), inflate: 3 })}" fill="${fill}"/>`,
        `<path d="M ${round(CX - 15)} ${round(g.shoulderY - 2)} Q ${CX} ${round(g.shoulderY + 16)} ${round(CX + 15)} ${round(g.shoulderY - 2)}" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="1.5"/>`
      ].join('');
    }
    case 'bottom': {
      const hem = round(g.kneeY + (g.ankleY - g.kneeY) * 0.72);
      return [
        `<path d="${legPath(g, 'left', { inflate: 4, endY: hem })}" fill="${fill}" stroke="rgba(0,0,0,0.15)" stroke-width="1"/>`,
        `<path d="${legPath(g, 'right', { inflate: 4, endY: hem })}" fill="${fill}" stroke="rgba(0,0,0,0.15)" stroke-width="1"/>`,
        `<path d="${torsoPath(g, { inflate: 4, topY: round(g.waistY + 4), bottomY: round(g.hipY + 18), topW: g.ww / 2 + 6, midW: g.hw / 2 + 4, bottomW: g.hw / 2 + 2 })}" fill="${fill}"/>`
      ].join('');
    }
    case 'dress': {
      const hem = round(g.kneeY + 26);
      const flare = g.hw / 2 + 34;
      return [
        `<path d="${torsoPath(g, { inflate: 4, bottomY: g.hipY })}" fill="${fill}" stroke="rgba(0,0,0,0.18)" stroke-width="1"/>`,
        `<path d="M ${round(CX - g.hw / 2 - 4)} ${round(g.hipY - 6)} Q ${round(CX - flare)} ${round((g.hipY + hem) / 2)} ${round(CX - flare)} ${hem} L ${round(CX + flare)} ${hem} Q ${round(CX + flare)} ${round((g.hipY + hem) / 2)} ${round(CX + g.hw / 2 + 4)} ${round(g.hipY - 6)} Z" fill="${fill}" stroke="rgba(0,0,0,0.15)" stroke-width="1"/>`,
        `<path d="M ${round(CX - 15)} ${round(g.shoulderY - 2)} Q ${CX} ${round(g.shoulderY + 18)} ${round(CX + 15)} ${round(g.shoulderY - 2)}" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="1.5"/>`
      ].join('');
    }
    case 'outer': {
      const hem = round(g.hipY + 46);
      const panel = (dir) => `M ${round(CX + dir * (g.sw / 2 + 7))} ${round(g.shoulderY - 3)} L ${round(CX + dir * 10)} ${round(g.shoulderY + 6)} L ${round(CX + dir * 16)} ${hem} L ${round(CX + dir * (g.hw / 2 + 10))} ${hem} Z`;
      return [
        `<path d="${panel(-1)}" fill="${fill}" stroke="rgba(0,0,0,0.22)" stroke-width="1"/>`,
        `<path d="${panel(1)}" fill="${fill}" stroke="rgba(0,0,0,0.22)" stroke-width="1"/>`,
        `<path d="${armPath(g, 'left', { endY: round(g.waistY + 34), inflate: 6 })}" fill="${fill}"/>`,
        `<path d="${armPath(g, 'right', { endY: round(g.waistY + 34), inflate: 6 })}" fill="${fill}"/>`
      ].join('');
    }
    default:
      throw new RenderError(`Unknown garment slot '${garment.slot}'`);
  }
}

/**
 * Validates a garment set against the slot rules. A dress occupies the torso and
 * the legs at once, so it cannot coexist with a top or a bottom. Catching this
 * here rather than in the renderer means the API can reject it with a clear
 * message instead of producing a visually broken look.
 */
export function validateOutfit(garments) {
  const bySlot = new Map();
  for (const garment of garments) {
    if (!SLOTS.includes(garment.slot)) throw new RenderError(`Unknown garment slot '${garment.slot}'`);
    if (bySlot.has(garment.slot)) throw new RenderError(`Two garments compete for the '${garment.slot}' slot`);
    bySlot.set(garment.slot, garment);
  }
  if (bySlot.has('dress') && (bySlot.has('top') || bySlot.has('bottom'))) {
    throw new RenderError('A dress cannot be layered with a top or a bottom');
  }
  return bySlot;
}

/** The default provider: local, deterministic, offline. */
export const LocalCompositor = {
  name: 'local-svg-compositor',
  render(avatar, garments = []) {
    if (!avatar) throw new RenderError('An avatar is required');
    const bySlot = validateOutfit(garments);
    const g = geometry(avatar);
    const skin = SKIN_TONES[avatar.skin_tone] ?? SKIN_TONES.sand;
    const ordered = SLOTS.map((slot) => bySlot.get(slot)).filter(Boolean);

    const defs = ordered.map(patternDef).join('');
    const headCy = round(g.crownY + g.headR + 4);

    const body = [
      `<path d="${armPath(g, 'left')}" fill="${skin}"/>`,
      `<path d="${armPath(g, 'right')}" fill="${skin}"/>`,
      `<path d="${legPath(g, 'left')}" fill="${skin}"/>`,
      `<path d="${legPath(g, 'right')}" fill="${skin}"/>`,
      `<path d="${torsoPath(g)}" fill="${skin}"/>`,
      `<rect x="${round(CX - 11)}" y="${round(g.chinY - 8)}" width="22" height="18" rx="8" fill="${skin}"/>`,
      `<circle cx="${CX}" cy="${headCy}" r="${g.headR}" fill="${skin}"/>`,
      hair(avatar, g)
    ].join('');

    const outfit = ordered.map((garment) => garmentShape(garment, g)).join('');

    return {
      mime: 'image/svg+xml',
      provider: LocalCompositor.name,
      svg:
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}" width="${CANVAS.width}" height="${CANVAS.height}" role="img" aria-label="${escapeXml(describe(avatar, ordered))}">` +
        `<defs>${defs}<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1a22"/><stop offset="1" stop-color="#2a2733"/></linearGradient></defs>` +
        `<rect width="${CANVAS.width}" height="${CANVAS.height}" fill="url(#bg)"/>` +
        `<ellipse cx="${CX}" cy="${round(g.ankleY + 12)}" rx="${round(g.hw * 0.72)}" ry="9" fill="rgba(0,0,0,0.35)"/>` +
        `${body}${outfit}` +
        `</svg>`
    };
  }
};

/**
 * Interface for a hosted generative provider. Deliberately not implemented:
 * it exists so that adding one is a configuration change rather than a
 * refactor, and so the local path stays the tested default.
 */
export function createProvider(name = 'local') {
  if (name === 'local') return LocalCompositor;
  throw new RenderError(
    `Provider '${name}' is not configured. Implement { name, render(avatar, garments) } and register it here; the local compositor remains the fallback.`
  );
}

function describe(avatar, garments) {
  const outfit = garments.length ? garments.map((g) => g.name).join(', ') : 'no garments';
  return `Avatar ${avatar.name} wearing ${outfit}`;
}

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function clamp(n, min, max) { return Math.min(max, Math.max(min, Number(n) || min)); }
function round(n) { return Math.round(n * 10) / 10; }
