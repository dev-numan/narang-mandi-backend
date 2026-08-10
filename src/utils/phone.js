/**
 * Compare phones regardless of +92 / 0 prefix formatting.
 *
 * A guest proves ownership of an order, a classified or a ride by pairing a
 * short code with the phone they typed, so every one of those checks has to
 * agree on what "the same number" means. One implementation is a correctness
 * requirement, not tidiness.
 *
 * @returns the last 10 digits, or everything there is when it is shorter.
 */
export function normalizePhone(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}
