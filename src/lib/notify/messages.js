// Urdu copy for every notification, in one place, so push bodies and WhatsApp
// template parameters cannot drift apart.

export const STATUS_UR = {
  pending: 'موصول',
  processing: 'تیاری میں',
  fulfilled: 'مکمل',
  cancelled: 'منسوخ',
};

export const TEMPLATES = {
  newOrderShop: 'nm_new_order_shop',
  orderPlacedCustomer: 'nm_order_placed_customer',
  orderStatusCustomer: 'nm_order_status_customer',
};

function money(amount) {
  return `Rs ${Number(amount || 0).toLocaleString('en-US')}`;
}

export function newOrderShop(order) {
  return {
    title: 'نیا آرڈر',
    body: `آرڈر ${order.orderNumber} — ${order.customerName} — ${money(order.total)}`,
    template: TEMPLATES.newOrderShop,
    params: [order.orderNumber, order.customerName, money(order.total)],
    data: { type: 'shop_order', orderId: order.id, orderNumber: order.orderNumber },
  };
}

export function orderPlacedCustomer(order, shopName) {
  return {
    title: 'آرڈر موصول ہو گیا',
    body: `${shopName} — آرڈر ${order.orderNumber} — ${money(order.total)}`,
    template: TEMPLATES.orderPlacedCustomer,
    params: [shopName, order.orderNumber, money(order.total)],
    data: { type: 'customer_order', orderId: order.id, orderNumber: order.orderNumber },
  };
}

export function orderStatusCustomer(order, shopName) {
  const status = STATUS_UR[order.status] || order.status;
  return {
    title: 'آرڈر کی صورتحال',
    body: `آرڈر ${order.orderNumber} — ${status}`,
    template: TEMPLATES.orderStatusCustomer,
    params: [order.orderNumber, status, shopName],
    data: { type: 'customer_order', orderId: order.id, orderNumber: order.orderNumber },
  };
}
