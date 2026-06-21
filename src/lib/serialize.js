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
  return s ? withId(s) : s;
}

// Standard relation selects reused across queries.
export const CATEGORY_BRIEF = { select: { id: true, name: true, slug: true } };
export const AUTHOR_BRIEF = {
  select: { id: true, name: true, avatar: true, phone: true, contactEmail: true },
};
