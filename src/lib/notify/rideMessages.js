// Urdu copy for every ride notification, in one place, so push bodies and
// WhatsApp template parameters cannot drift apart.

export const TEMPLATES = {
  newRideDriver: 'nm_ride_new_driver',
  bidReceivedCustomer: 'nm_ride_bid_received',
  assignedCustomer: 'nm_ride_assigned_customer',
  assignedDriver: 'nm_ride_assigned_driver',
  cancelledDriver: 'nm_ride_cancelled',
};

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
  };
}

export function bidReceivedCustomer(ride, count) {
  return {
    title: 'نئی پیشکش',
    body: `آپ کی سواری پر ${count} پیشکشیں آئی ہیں`,
    template: TEMPLATES.bidReceivedCustomer,
    params: [ride.rideCode, String(count)],
    data: { type: 'ride_bid', rideId: ride.id, rideCode: ride.rideCode },
  };
}

export function assignedCustomer(ride, driverName) {
  return {
    title: 'ڈرائیور طے ہو گیا',
    body: `${driverName} — ${money(ride.agreedPrice)}`,
    template: TEMPLATES.assignedCustomer,
    params: [ride.rideCode, driverName, money(ride.agreedPrice)],
    data: { type: 'ride_assigned', rideId: ride.id, rideCode: ride.rideCode },
  };
}

export function assignedDriver(ride) {
  return {
    title: 'آپ کی پیشکش قبول ہو گئی',
    body: `${ride.pickupText} سے ${ride.dropoffText} — ${money(ride.agreedPrice)}`,
    template: TEMPLATES.assignedDriver,
    params: [ride.pickupText, ride.dropoffText, money(ride.agreedPrice)],
    data: { type: 'ride_assigned', rideId: ride.id },
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
  };
}

export function cancelledDriver(ride) {
  return {
    title: 'سفر منسوخ',
    body: `${ride.pickupText} سے ${ride.dropoffText}`,
    template: TEMPLATES.cancelledDriver,
    params: [ride.pickupText, ride.dropoffText],
    data: { type: 'ride_cancelled', rideId: ride.id },
  };
}
