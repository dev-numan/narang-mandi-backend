import { ApiError } from './asyncHandler.js';

/**
 * An 8-digit code a customer can read down a phone line and type back.
 *
 * Short enough to dictate, so it is never a credential on its own — every
 * lookup pairs it with the phone the record was created with, and answers
 * "wrong code" and "wrong phone" identically so the space cannot be probed.
 *
 * @param delegate a Prisma model delegate, e.g. `prisma.order`
 * @param field the unique column holding the code, e.g. 'orderNumber'
 */
export async function uniqueNumericCode(delegate, field) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const code = String(Math.floor(10000000 + Math.random() * 90000000));
    const exists = await delegate.findUnique({ where: { [field]: code } });
    if (!exists) return code;
  }
  throw new ApiError(500, `Could not generate a unique ${field}`);
}
