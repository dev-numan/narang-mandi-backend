// Urdu copy for every ride notification, in one place, so push bodies and
// WhatsApp template parameters cannot drift apart.

/**
 * The `_v2` names are the utility-category rewrites of three templates Meta
 * reclassified to marketing on its own — `previous_category` on each of the
 * originals still reads UTILITY. A marketing template is throttled under error
 * 131049 ("to maintain healthy ecosystem engagement"), which silently withheld
 * 25 of 31 driver alerts on one ride, and it is billed at roughly twice the
 * utility rate. The rewrites say the same thing without the phrasing that
 * triggered the reclassification — no "available!", no "open the app", no
 * "keep watching for new rides".
 *
 * Parameter counts and order are identical to the originals, so the call sites
 * below did not change.
 */
export const TEMPLATES = {
  newRideDriver: 'nm_ride_new_driver_v2',
  bidReceivedCustomer: 'nm_ride_bid_v2',
  assignedCustomer: 'nm_ride_assigned_customer',
  assignedDriver: 'nm_ride_assigned_driver',
  cancelledDriver: 'nm_ride_cancelled_v2',
};

/**
 * Appended by the SMS channel only.
 *
 * A text message arrives with no app icon and no thread history, so it has to
 * say who sent it and which ride it is about. Push notifications get neither —
 * the icon identifies the sender and the payload already carries `rideCode`.
 */
function smsFooter(rideCode) {
  // A text cannot be tapped through to the app the way a push can, so it has to
  // say what to do next. Measured: this stays within the same two Unicode
  // segments the ride code alone already required, so it costs nothing to send.
  const cta = 'ابھی ایپ کھولیں';
  return rideCode
    ? `${cta}\nسواری نمبر: ${rideCode}\nنارنگ منڈی ڈیجیٹل ہب`
    : `${cta}\nنارنگ منڈی ڈیجیٹل ہب`;
}

function money(amount) {
  return `Rs ${Number(amount || 0).toLocaleString('en-US')}`;
}

/**
 * Broadcast to every active driver. Carries pickup and dropoff so a driver can
 * decide whether to open the app — but never the customer's name or number,
 * because this goes to the whole town.
 */
export function newRideDriver(ride) {
  return {
    title: 'نئی سواری',
    body: `${ride.pickupText} سے ${ride.dropoffText}`,
    template: TEMPLATES.newRideDriver,
    params: [ride.pickupText, ride.dropoffText, ride.whenText || 'ابھی'],
    data: { type: 'ride_new', rideId: ride.id },
    smsFooter: smsFooter(ride.rideCode),
  };
}

export function bidReceivedCustomer(ride, count) {
  return {
    title: 'نئی پیشکش',
    body: `آپ کی سواری پر ${count} پیشکشیں آئی ہیں`,
    template: TEMPLATES.bidReceivedCustomer,
    params: [ride.rideCode, String(count)],
    data: { type: 'ride_bid', rideId: ride.id, rideCode: ride.rideCode },
    smsFooter: smsFooter(ride.rideCode),
  };
}

export function assignedCustomer(ride, driverName) {
  return {
    title: 'ڈرائیور طے ہو گیا',
    body: `${driverName} — ${money(ride.agreedPrice)}`,
    template: TEMPLATES.assignedCustomer,
    params: [ride.rideCode, driverName, money(ride.agreedPrice)],
    data: { type: 'ride_assigned', rideId: ride.id, rideCode: ride.rideCode },
    smsFooter: smsFooter(ride.rideCode),
  };
}

export function assignedDriver(ride) {
  return {
    title: 'آپ کی پیشکش قبول ہو گئی',
    body: `${ride.pickupText} سے ${ride.dropoffText} — ${money(ride.agreedPrice)}`,
    template: TEMPLATES.assignedDriver,
    params: [ride.pickupText, ride.dropoffText, money(ride.agreedPrice)],
    data: { type: 'ride_assigned', rideId: ride.id },
    smsFooter: smsFooter(ride.rideCode),
  };
}

/**
 * Sent to the drivers whose bid lost.
 *
 * No `template`: telling a driver they were not picked does not justify a
 * WhatsApp template submission, and the ride has already left their board by
 * the time this lands. Push only — callers pass phone: '' so the WhatsApp
 * channel skips it.
 */
export function bidRejectedDriver(ride) {
  return {
    title: 'سواری کسی اور کو مل گئی',
    body: `${ride.pickupText} سے ${ride.dropoffText}`,
    params: [ride.pickupText, ride.dropoffText],
    data: { type: 'ride_bid_rejected', rideId: ride.id },
    smsFooter: smsFooter(ride.rideCode),
  };
}

export function cancelledDriver(ride) {
  return {
    title: 'سفر منسوخ',
    body: `${ride.pickupText} سے ${ride.dropoffText}`,
    template: TEMPLATES.cancelledDriver,
    params: [ride.pickupText, ride.dropoffText],
    data: { type: 'ride_cancelled', rideId: ride.id },
    smsFooter: smsFooter(ride.rideCode),
  };
}
