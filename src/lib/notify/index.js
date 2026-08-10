import prisma from '../prisma.js';
import { dispatch } from './dispatch.js';
import { newOrderShop, orderPlacedCustomer, orderStatusCustomer } from './messages.js';

/**
 * Order notifications.
 *
 * Controllers call these two functions and know nothing about FCM or WhatsApp.
 * Both are fire-and-forget: they are invoked *after* the order transaction has
 * committed, and they resolve regardless of what any channel does. A buyer who
 * received an order number keeps it even when every channel is down.
 */

async function shopOwnerTokens(ownerId) {
  if (!ownerId) return [];
  const rows = await prisma.deviceToken.findMany({
    where: { userId: ownerId },
    select: { token: true },
  });
  return rows.map((r) => r.token);
}

/** Shops fill in whichever of the two they have; prefer the WhatsApp number. */
const shopWhatsApp = (shop) => shop?.whatsapp?.trim() || shop?.phone?.trim() || '';

export async function notifyNewOrder(order, shop) {
  try {
    const [tokens] = await Promise.all([shopOwnerTokens(shop?.ownerId)]);

    await Promise.allSettled([
      dispatch({
        orderId: order.id,
        event: 'order_placed',
        audience: 'shop',
        message: newOrderShop(order),
        tokens,
        phone: shopWhatsApp(shop),
      }),
      dispatch({
        orderId: order.id,
        event: 'order_placed',
        audience: 'customer',
        message: orderPlacedCustomer(order, shop?.name || ''),
        tokens: order.deviceToken ? [order.deviceToken] : [],
        phone: order.customerPhone,
      }),
    ]);
  } catch (err) {
    console.error('[notify] notifyNewOrder failed', err.message);
  }
}

export async function notifyOrderStatus(order, shop) {
  try {
    await dispatch({
      orderId: order.id,
      event: 'order_status',
      audience: 'customer',
      message: orderStatusCustomer(order, shop?.name || ''),
      tokens: order.deviceToken ? [order.deviceToken] : [],
      phone: order.customerPhone,
    });
  } catch (err) {
    console.error('[notify] notifyOrderStatus failed', err.message);
  }
}
