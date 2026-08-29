// Unit tests for the notification module. No database, no network: what is
// under test is the guarantee that a notification failure cannot reach the
// caller, so every external edge is a stub passed in.
//
// Run: node --test src/lib/notify/notify.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDispatch } from './dispatch.js';
import { toWhatsAppNumber } from './channels/whatsapp.js';
import { STATUS_UR, newOrderShop, orderPlacedCustomer, orderStatusCustomer } from './messages.js';

/* ----------------------------------------------------------- phone handling */

test('toWhatsAppNumber normalises the forms a Pakistani number arrives in', () => {
  assert.equal(toWhatsAppNumber('03001234567'), '923001234567');
  assert.equal(toWhatsAppNumber('+92 300 1234567'), '923001234567');
  assert.equal(toWhatsAppNumber('923001234567'), '923001234567');
  assert.equal(toWhatsAppNumber('3001234567'), '923001234567');
  assert.equal(toWhatsAppNumber('0300-123-4567'), '923001234567');
});

test('toWhatsAppNumber rejects anything WhatsApp cannot deliver to', () => {
  // A landline, not a mobile. Shops often have one in `phone`, which is the
  // fallback when `whatsapp` is blank — better skipped here than failed at Meta.
  assert.equal(toWhatsAppNumber('0421234567'), null);
  assert.equal(toWhatsAppNumber('12345'), null);
  assert.equal(toWhatsAppNumber(''), null);
  assert.equal(toWhatsAppNumber(null), null);
  assert.equal(toWhatsAppNumber(undefined), null);
});

/* ----------------------------------------------------------------- messages */

const ORDER = {
  id: 'order_1',
  orderNumber: '12345678',
  customerName: 'اکرم',
  customerPhone: '03001234567',
  total: 1100,
  status: 'processing',
};

test('every order status has Urdu copy', () => {
  for (const status of ['pending', 'processing', 'fulfilled', 'cancelled']) {
    assert.ok(STATUS_UR[status], `missing Urdu for ${status}`);
  }
});

test('messages carry the data a notification needs to deep-link', () => {
  const shop = newOrderShop(ORDER);
  assert.equal(shop.data.type, 'shop_order');
  assert.equal(shop.data.orderId, 'order_1');
  assert.equal(shop.params.length, 3);

  const placed = orderPlacedCustomer(ORDER, 'حفیظ زرعی مرکز');
  assert.equal(placed.data.type, 'customer_order');
  assert.equal(placed.data.orderNumber, '12345678');
  assert.equal(placed.params.length, 3);

  const status = orderStatusCustomer(ORDER, 'حفیظ زرعی مرکز');
  assert.equal(status.data.type, 'customer_order');
  // The Urdu word, not the raw enum — the customer sees this text.
  assert.ok(status.params.includes(STATUS_UR.processing));
});

/* ---------------------------------------------------------------- dispatch */

function channel(name, { configured = true, send } = {}) {
  return {
    name,
    isConfigured: () => configured,
    target: ({ phone }) => phone || '',
    send: send || (async () => ({ status: 'sent' })),
  };
}

function harness(channels) {
  const logged = [];
  const dispatch = createDispatch({
    channels,
    writeLog: async (row) => {
      logged.push(row);
    },
    // Tests must not sit through the real retry backoff.
    delayMs: 0,
  });
  return { dispatch, logged };
}

const JOB = {
  orderId: 'order_1',
  event: 'order_placed',
  audience: 'shop',
  message: newOrderShop(ORDER),
  tokens: ['tok_abcdefgh'],
  phone: '03001234567',
};

test('records one row per channel', async () => {
  const { dispatch, logged } = harness([channel('fcm'), channel('whatsapp')]);
  await dispatch(JOB);

  assert.equal(logged.length, 2);
  assert.deepEqual(
    new Set(logged.map((l) => l.channel)),
    new Set(['fcm', 'whatsapp']),
  );
  assert.ok(logged.every((l) => l.status === 'sent'));
});

test('a channel that throws does not stop the other one', async () => {
  const { dispatch, logged } = harness([
    channel('fcm', {
      send: () => {
        throw new Error('boom');
      },
    }),
    channel('whatsapp'),
  ]);

  await dispatch(JOB);

  const whatsapp = logged.find((l) => l.channel === 'whatsapp');
  assert.ok(whatsapp, 'whatsapp still ran and was recorded');
  assert.equal(whatsapp.status, 'sent');
});

test('unconfigured channels are skipped, not failed', async () => {
  const { dispatch, logged } = harness([
    channel('fcm', { configured: false }),
    channel('whatsapp', { configured: false }),
  ]);

  await dispatch(JOB);

  assert.equal(logged.length, 2);
  assert.ok(logged.every((l) => l.status === 'skipped'));
});

test('a failed send is retried exactly once', async () => {
  let calls = 0;
  const { dispatch, logged } = harness([
    channel('fcm', {
      send: async () => {
        calls += 1;
        return { status: 'failed', error: 'transient' };
      },
    }),
  ]);

  await dispatch(JOB);

  assert.equal(calls, 2, 'one attempt plus one retry');
  assert.equal(logged[0].status, 'failed');
});

test('dispatch resolves even when every channel and the log writer fail', async () => {
  const dispatch = createDispatch({
    channels: [
      channel('fcm', {
        send: () => {
          throw new Error('fcm down');
        },
      }),
      channel('whatsapp', {
        send: () => {
          throw new Error('meta down');
        },
      }),
    ],
    writeLog: async () => {
      throw new Error('database down');
    },
    delayMs: 0,
  });

  // The whole point: a buyer who received an order number keeps it regardless.
  await dispatch(JOB);
});

/* ------------------------------------------------------------- sms gateway */

test('toSmsNumber accepts the same forms as WhatsApp and rejects landlines', async () => {
  const { toSmsNumber } = await import('./channels/sms.js');
  assert.equal(toSmsNumber('03001234567'), '923001234567');
  assert.equal(toSmsNumber('+92 300 1234567'), '923001234567');
  assert.equal(toSmsNumber('923001234567'), '923001234567');
  // A landline is not textable; skipping here beats a failure at the handset.
  assert.equal(toSmsNumber('0421234567'), null);
  assert.equal(toSmsNumber(''), null);
  assert.equal(toSmsNumber(null), null);
});

test('a queued SMS is logged with the outbox id, so a status callback can find it', async () => {
  const logs = [];
  // Stands in for the outbox write: what matters here is that the dispatcher
  // records whatever id the channel returns.
  const dispatch = createDispatch({
    channels: [
      {
        name: 'sms',
        isConfigured: () => true,
        target: ({ phone }) => phone || '',
        send: async () => ({ status: 'sent', messageId: 'outbox_abc123' }),
      },
    ],
    writeLog: async (row) => logs.push(row),
    delayMs: 0,
  });

  await dispatch({
    rideId: 'r1',
    event: 'ride_new',
    audience: 'driver',
    message: { title: 'نئی سواری', body: 'نارنگ سے مریدکے' },
    phone: '03001234567',
  });

  assert.equal(logs.length, 1);
  assert.equal(logs[0].channel, 'sms');
  assert.equal(logs[0].status, 'sent');
  assert.equal(logs[0].providerMessageId, 'outbox_abc123');
});

test('an unconfigured gateway is skipped and never breaks the other channels', async () => {
  const logs = [];
  const dispatch = createDispatch({
    channels: [
      {
        name: 'fcm',
        isConfigured: () => true,
        target: () => '1 device',
        send: async () => ({ status: 'sent' }),
      },
      {
        name: 'sms',
        isConfigured: () => false,
        target: ({ phone }) => phone || '',
        send: async () => {
          throw new Error('must not be called when unconfigured');
        },
      },
    ],
    writeLog: async (row) => logs.push(row),
    delayMs: 0,
  });

  await dispatch({
    rideId: 'r1',
    event: 'ride_new',
    audience: 'driver',
    message: { title: 'نئی سواری', body: 'نارنگ سے مریدکے' },
    phone: '03001234567',
  });

  const bySms = logs.find((l) => l.channel === 'sms');
  const byFcm = logs.find((l) => l.channel === 'fcm');
  assert.equal(bySms.status, 'skipped');
  assert.equal(byFcm.status, 'sent', 'push must still go out when SMS is off');
});
