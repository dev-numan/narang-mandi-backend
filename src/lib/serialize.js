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

// Standard relation selects reused across queries.
export const CATEGORY_BRIEF = { select: { id: true, name: true, slug: true } };
export const AUTHOR_BRIEF = {
  select: { id: true, name: true, avatar: true, phone: true, contactEmail: true },
};
