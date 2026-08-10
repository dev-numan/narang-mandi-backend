// The frontend (and the original spec) expect Mongo-style documents with `_id`
// and nested `category`/`author` objects. Prisma returns `id`. These helpers
// keep the REST API response shape stable so the client needs no changes.

function withId(obj) {
  if (!obj) return obj;
  const { id, ...rest } = obj;
  return { _id: id, ...rest };
}

export function serializeCategory(c) {
  return c ? withId(c) : c;
}

export function serializeUser(u) {
  if (!u) return u;
  const { passwordHash, ...safe } = u;
  return withId(safe);
}

export function serializeArticle(a) {
  if (!a) return a;
  const { categoryId, authorId, category, author, ...rest } = a;
  const out = withId(rest);
  if (category !== undefined) out.category = category ? serializeCategory(category) : null;
  if (author !== undefined) out.author = author ? serializeUser(author) : null;
  return out;
}

export function serializeSettings(s) {
  if (!s) return s;
  return { ...withId(s), siteName: 'Narang Mandi' };
}

export function serializePlaceCategory(c) {
  return c ? withId(c) : c;
}

export function serializePlace(p) {
  if (!p) return p;
  const { categoryId, category, ...rest } = p;
  const out = withId(rest);
  if (category !== undefined) out.category = category ? serializePlaceCategory(category) : null;
  return out;
}

export const PLACE_CATEGORY_BRIEF = { select: { id: true, name: true, slug: true, icon: true } };

export function serializeTrain(t) {
  return t ? withId(t) : t;
}

export function serializeClassifiedCategory(c) {
  return c ? withId(c) : c;
}

export function serializeClassified(c, { includeSaleCode = false } = {}) {
  if (!c) return c;
  const { categoryId, category, saleCode, ...rest } = c;
  const out = withId(rest);
  if (includeSaleCode && saleCode) out.saleCode = saleCode;
  if (category !== undefined) out.category = category ? serializeClassifiedCategory(category) : null;
  return out;
}

export const CLASSIFIED_CATEGORY_BRIEF = { select: { id: true, name: true, slug: true, icon: true } };

export function serializeThread(t) {
  if (!t) return t;
  const { _count, ...rest } = t;
  const out = withId(rest);
  if (_count) out.messageCount = _count.messages;
  return out;
}

// Collapses a message's raw reactions into [{ emoji, count, mine }] using the
// requesting browser's anonymous clientId.
export function serializeMessage(m, clientId = '') {
  if (!m) return m;
  const { threadId, replyToId, replyTo, reactions, ...rest } = m;
  const out = withId(rest);
  if (replyTo !== undefined) {
    out.replyTo = replyTo
      ? { _id: replyTo.id, authorName: replyTo.authorName, content: replyTo.content }
      : null;
  }
  if (reactions !== undefined) {
    const groups = {};
    for (const r of reactions) {
      if (!groups[r.emoji]) groups[r.emoji] = { emoji: r.emoji, count: 0, mine: false };
      groups[r.emoji].count += 1;
      if (clientId && r.clientId === clientId) groups[r.emoji].mine = true;
    }
    out.reactions = Object.values(groups);
  }
  return out;
}

// ---------- Dukanen (shops) ----------

export const SHOP_BRIEF = {
  select: { id: true, name: true, slug: true, logo: true, phone: true, whatsapp: true },
};
export const SHOP_CATEGORY_BRIEF = { select: { id: true, name: true, nameEn: true, slug: true } };

export function serializeShop(s) {
  if (!s) return s;
  const { ownerId, owner, categories, products, orders, _count, ...rest } = s;
  const out = withId(rest);
  if (owner !== undefined) out.owner = owner ? serializeUser(owner) : null;
  if (categories !== undefined) out.categories = categories.map(serializeShopCategory);
  if (products !== undefined) out.products = products.map(serializeProduct);
  if (_count) {
    if (_count.products !== undefined) out.productCount = _count.products;
    if (_count.orders !== undefined) out.orderCount = _count.orders;
  }
  return out;
}

export function serializeShopCategory(c) {
  if (!c) return c;
  const { shopId, _count, ...rest } = c;
  const out = withId(rest);
  if (_count && _count.products !== undefined) out.productCount = _count.products;
  return out;
}

export function serializeProduct(p) {
  if (!p) return p;
  const { categoryId, category, shopId, shop, orderItems, ...rest } = p;
  const out = withId(rest);
  if (category !== undefined) out.category = category ? serializeShopCategory(category) : null;
  if (shop !== undefined) out.shop = shop ? serializeShop(shop) : null;
  return out;
}

export function serializeOrder(o) {
  if (!o) return o;
  // deviceToken is a push credential and is never part of a response — order
  // lookup is public (number + phone), so leaking it would hand any caller the
  // ability to be pushed to as that customer.
  const { shopId, shop, items, deviceToken, notifications, ...rest } = o;
  const out = withId(rest);
  if (shop !== undefined) out.shop = shop ? serializeShop(shop) : null;
  if (items !== undefined) {
    out.items = items.map((it) => {
      const { orderId, productId, product, ...irest } = it;
      const io = withId(irest);
      if (product !== undefined) io.product = product ? serializeProduct(product) : null;
      return io;
    });
  }
  return out;
}

// Standard relation selects reused across queries.
export const CATEGORY_BRIEF = { select: { id: true, name: true, slug: true } };
export const AUTHOR_BRIEF = {
  select: { id: true, name: true, avatar: true, phone: true, contactEmail: true },
};

// ---------- Taxi (rides + bids) ----------

/// What a customer may know about the driver who is bidding. Contact details are
/// deliberately absent — they are grafted on only for the winner, once the ride
/// is assigned and the two of them need to speak.
/// Contact details are selected but not exposed: `driverCard` strips them
/// unless the caller asks, which happens only once a ride is assigned. Leaving
/// them out of the query instead would mean the winner's number could never be
/// revealed at all.
export const DRIVER_PUBLIC = {
  select: {
    id: true,
    phone: true,
    whatsapp: true,
    vehicleType: true,
    vehicleNumber: true,
    photo: true,
    isVerified: true,
    completedRides: true,
    user: { select: { name: true } },
  },
};

/// For the manual-contact fallback, where handing over the number is the entire
/// point. Separate from DRIVER_PUBLIC because that one never selects isActive.
export const DRIVER_CONTACT = {
  select: {
    id: true,
    phone: true,
    whatsapp: true,
    vehicleType: true,
    vehicleNumber: true,
    photo: true,
    isVerified: true,
    completedRides: true,
    user: { select: { name: true } },
  },
};

export function serializeDriverContact(d) {
  return driverCard(d, { includeContact: true });
}

function driverCard(d, { includeContact = false } = {}) {
  if (!d) return null;
  const { id, user, phone, whatsapp, ...rest } = d;
  return {
    _id: id,
    name: user?.name || '',
    ...rest,
    ...(includeContact ? { phone, whatsapp } : {}),
  };
}

/**
 * A bid as the customer sees it: price, and enough about the driver to choose
 * between them.
 */
export function serializeBid(b, { includeContact = false } = {}) {
  if (!b) return b;
  const { id, driverId, rideId, driver, ...rest } = b;
  return {
    _id: id,
    ...rest,
    ...(driver !== undefined ? { driver: driverCard(driver, { includeContact }) } : {}),
  };
}

/**
 * The customer's own view of their ride.
 *
 * `deviceToken` is a push credential and `accessToken` names their private
 * socket room; neither may appear in a response body — the same reasoning that
 * strips `Order.deviceToken` in `serializeOrder`. The caller passes
 * `includeAccessToken` only on create and lookup, where the customer needs it
 * to open the socket.
 */
export function serializeRideForCustomer(r, { includeAccessToken = false } = {}) {
  if (!r) return r;
  const { id, deviceToken, accessToken, assignedDriverId, acceptedBidId, ip, driver, bids, events, notifications, ...rest } = r;
  const assigned = r.status === 'assigned' || r.status === 'completed';
  return {
    _id: id,
    ...rest,
    ...(includeAccessToken ? { accessToken } : {}),
    ...(driver !== undefined ? { driver: driverCard(driver, { includeContact: assigned }) } : {}),
    ...(bids !== undefined
      ? { bids: bids.map((b) => serializeBid(b, { includeContact: assigned && b.id === acceptedBidId })) }
      : {}),
  };
}

/**
 * The same ride as a driver sees it — without the customer's identity.
 *
 * A driver is shown who they are collecting only after they have won the ride,
 * so an open request cannot be harvested for phone numbers. Rival bids never
 * appear at all: `bidCount` says how much competition there is, and the
 * driver's own bid is attached separately as `myBid`.
 */
export function serializeRideForDriver(r, { myBid = undefined, isWinner = false } = {}) {
  if (!r) return r;
  const { id, deviceToken, accessToken, ip, customerName, customerPhone, assignedDriverId, acceptedBidId, driver, bids, events, notifications, ...rest } = r;
  return {
    _id: id,
    ...rest,
    ...(isWinner ? { customerName, customerPhone } : {}),
    ...(myBid !== undefined ? { myBid: myBid ? serializeBid(myBid) : null } : {}),
  };
}

export function serializeRideEvent(e) {
  return e ? withId(e) : e;
}

/// Admin sees everything except the two credentials.
export function serializeRideForAdmin(r) {
  if (!r) return r;
  const { id, deviceToken, accessToken, driver, bids, events, ...rest } = r;
  return {
    _id: id,
    ...rest,
    ...(driver !== undefined ? { driver: driverCard(driver, { includeContact: true }) } : {}),
    ...(bids !== undefined ? { bids: bids.map((b) => serializeBid(b, { includeContact: true })) } : {}),
    ...(events !== undefined ? { events: events.map(serializeRideEvent) } : {}),
  };
}

export function serializeDriver(d) {
  if (!d) return d;
  const { id, userId, user, ...rest } = d;
  return {
    _id: id,
    ...rest,
    ...(user !== undefined ? { name: user.name, email: user.email } : {}),
  };
}
