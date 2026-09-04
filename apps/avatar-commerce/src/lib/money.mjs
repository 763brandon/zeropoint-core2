/**
 * Integer money. Amounts are minor units (cents/pesewas); rates are basis
 * points. Nothing in this module returns a float, and nothing accepts one.
 */

export class MoneyError extends Error {}

export function assertMinor(name, value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MoneyError(`${name} must be a non-negative safe integer of minor units, received ${JSON.stringify(value)}`);
  }
  return value;
}

export function assertBps(name, value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10000) {
    throw new MoneyError(`${name} must be an integer 0-10000 basis points, received ${JSON.stringify(value)}`);
  }
  return value;
}

/** Applies a basis-point rate, rounding down. Never returns more than the base. */
export function applyBps(amountMinor, bps) {
  assertMinor('amountMinor', amountMinor);
  assertBps('bps', bps);
  return Math.floor((amountMinor * bps) / 10000);
}

/**
 * Splits an order into commission and its earner/platform shares.
 *
 * The rounding remainder goes to the platform, not the earner. This is a
 * deliberate choice and it must be the documented one: whichever side absorbs
 * sub-unit remainders should be the side that can reconcile them, and a
 * creator cannot audit a half-cent.
 */
export function splitCommission({ amountMinor, rateBps, sharerBps }) {
  assertMinor('amountMinor', amountMinor);
  assertBps('rateBps', rateBps);
  assertBps('sharerBps', sharerBps);

  const grossMinor = applyBps(amountMinor, rateBps);
  const earnerMinor = applyBps(grossMinor, sharerBps);
  const platformMinor = grossMinor - earnerMinor;

  return { grossMinor, earnerMinor, platformMinor };
}

/**
 * Minor units per currency. Not every currency has two decimal places, and a
 * formatter that assumes it does will render a Vietnamese price 100x too small
 * — in a multi-currency affiliate ledger that is a real financial error, not a
 * cosmetic one.
 */
export const CURRENCY_EXPONENT = { GHS: 2, PLN: 2, USD: 2, EUR: 2, VND: 0, COP: 0, JPY: 0, KRW: 0 };

/** Unknown currencies fall back to 2, the commonest case, rather than throwing. */
export function exponentFor(currency) {
  return CURRENCY_EXPONENT[String(currency).toUpperCase()] ?? 2;
}

/** Display helper. The stored value always stays integral. */
export function formatMinor(amountMinor, currency) {
  assertMinor('amountMinor', amountMinor);
  const exponent = exponentFor(currency);
  if (exponent === 0) return `${currency} ${amountMinor.toLocaleString('en-US')}`;
  const divisor = 10 ** exponent;
  const major = Math.floor(amountMinor / divisor).toLocaleString('en-US');
  const minor = String(amountMinor % divisor).padStart(exponent, '0');
  return `${currency} ${major}.${minor}`;
}
