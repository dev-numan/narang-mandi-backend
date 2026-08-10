// Pure text transforms for the article content cleanup.
//
// Background: article bodies were authored by pasting from Word into ReactQuill,
// which left `&nbsp;` between every word (6,204 of them across 30 articles). The
// same paste habit also duplicated the headline as the body's first paragraph and
// the opening paragraph into the `excerpt` field. This module holds the pure
// functions that undo all of that; the scripts around it do the I/O.
//
// Everything here is a pure function of its input so it can be unit-tested with
// fixtures and asserted idempotent (`f(f(x)) === f(x)`) before touching the DB.

// ---------------------------------------------------------------------------
// Character classes
// ---------------------------------------------------------------------------

// Bidi and joiner controls that are SHAPING-SIGNIFICANT in Urdu: LRM, RLM, ALM,
// ZWNJ, ZWJ. A blanket "strip invisible characters" rule would visibly corrupt
// words, so these are preserved everywhere in stored content and dropped only
// when normalising for comparison. Written as \u escapes on purpose - they are
// invisible in a source file and trivially lost to a careless edit.
const BIDI_CONTROLS = /[\u200E\u200F\u061C\u200C\u200D]/g;

// Whitespace that should read as a plain space: NBSP (U+00A0), narrow NBSP
// (U+202F), and the entity spellings Quill/Word leave behind.
const NBSP_FAMILY = /&nbsp;|&#160;|&#xa0;|\u00A0|\u202F/gi;

// Urdu diacritics (harakat, U+064B-U+0652 plus superscript alef U+0670) -
// invisible in most fonts and applied inconsistently, so they are folded away
// when comparing two strings.
const URDU_DIACRITICS = /[\u064B-\u0652\u0670]/g;

// ---------------------------------------------------------------------------
// Layer A — text-node level. Safe unconditionally.
// ---------------------------------------------------------------------------

// Apply `fn` to the text between tags, never to the tags themselves. This is
// what keeps href/src/style attribute values out of reach of the transforms.
function mapTextNodes(html, fn) {
  return String(html)
    .split(/(<[^>]*>)/)
    .map((seg) => (seg.startsWith('<') && seg.endsWith('>') ? seg : fn(seg)))
    .join('');
}

// Turn every flavour of non-breaking space into a real space and collapse runs.
//
// NOTE: this deliberately does NOT decode &amp; / &lt; / &gt;. The similarly
// named decodeEntities() in client/server.js does, and is correct there because
// its output is plain text destined for a text node. Doing it here would turn a
// stored "&lt;script&gt;" into live markup. Do not "unify" the two functions.
export function normalizeNbsp(html) {
  return mapTextNodes(html, (t) => t.replace(NBSP_FAMILY, ' ').replace(/[ \t]{2,}/g, ' '));
}

// ---------------------------------------------------------------------------
// Comparison normaliser — used for matching only, never written back.
// ---------------------------------------------------------------------------

// Fold the Arabic letter forms that Word emits onto their Urdu equivalents.
// Word-pasted bodies routinely carry Arabic yeh/kaf/teh-marbuta while the title
// was typed with Urdu forms, so naive equality misses genuine duplicates.
const ARABIC_FOLD = [
  [/[يیى]/g, 'ی'], // ي / ی / ى  -> ی
  [/[كک]/g, 'ک'], // ك / ک       -> ک
  [/[ةہه]/g, 'ہ'], // ة / ہ / ه   -> ہ
  [/[أإآا]/g, 'ا'], // أ إ آ ا    -> ا
];

// Byline / dateline markers. These appear in the title on some articles and in
// the body on others, so an otherwise identical headline and lede fail to match
// unless they are folded away first. 14 of 30 articles carry one.
const BYLINE_MARKER = /\(\s*(?:SahibMeo|نامہ\s*نگار|سٹاف\s*رپورٹر)\s*\)/gi;

// Aggressive normalisation for equality tests: markup, entities, punctuation,
// diacritics, byline markers and letter-form variation all folded away.
export function normText(input) {
  let t = stripTags(input);
  t = t.replace(BYLINE_MARKER, ' ');
  t = t.replace(NBSP_FAMILY, ' ').replace(BIDI_CONTROLS, '');
  t = t.replace(URDU_DIACRITICS, '');
  for (const [re, to] of ARABIC_FOLD) t = t.replace(re, to);
  t = t.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  t = t.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  // Drop punctuation and symbols (Urdu ، ۔ ؟ included) — presentation only.
  t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return t.normalize('NFC').split(/\s+/).filter(Boolean).join(' ');
}

// Tags out, entities that matter decoded, whitespace collapsed. Mirrors the
// stripTags in client/server.js so both render paths agree on what "the text" is.
export function stripTags(input) {
  return String(input || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(NBSP_FAMILY, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

export const wordCount = (s) => (normText(s) ? normText(s).split(' ').length : 0);

export const escapeHtml = (s) =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------------------
// Layer B — block level. Guarded by a round-trip assertion.
// ---------------------------------------------------------------------------

const BLOCK_RE =
  /<(p|h[1-6]|blockquote|pre|ul|ol|div)\b[^>]*>[\s\S]*?<\/\1>|<(?:img|hr|br|iframe)\b[^>]*\/?>/gi;

// Any block-level tag left stranded outside a matched block means the markup is
// not the flat, well-closed shape Quill emits (e.g. an unclosed <p>).
const STRAY_BLOCK_RE = /<\/?(?:p|h[1-6]|blockquote|pre|ul|ol|li|div)\b/i;

// Purely presentational inline tags. Editors routinely bolded the headline they
// pasted, so these may be stepped over when locating it — anything else (a link,
// an image, a nested block) is a reason to bail rather than guess.
const INLINE_PRESENTATIONAL = /^<\/?(?:strong|b|em|i|u|span)\b[^>]*>$/i;

// Split flat Quill output into top-level blocks plus the whitespace between them.
// Returns null when the pieces do not reassemble byte-for-byte, or when a block
// tag is stranded between blocks — the caller then falls back to Layer A only
// rather than risk mangling unexpected markup.
export function tokenizeBlocks(html) {
  const src = String(html || '');
  const tokens = [];
  let last = 0;
  for (const m of src.matchAll(BLOCK_RE)) {
    if (m.index > last) tokens.push({ type: 'gap', raw: src.slice(last, m.index) });
    tokens.push({ type: 'block', raw: m[0], tag: (m[1] || m[0].match(/<(\w+)/)?.[1] || '').toLowerCase() });
    last = m.index + m[0].length;
  }
  if (last < src.length) tokens.push({ type: 'gap', raw: src.slice(last) });

  if (tokens.map((t) => t.raw).join('') !== src) return null;
  if (tokens.some((t) => t.type === 'gap' && STRAY_BLOCK_RE.test(t.raw))) return null;
  return tokens;
}

// Dice coefficient over word tokens — 1.0 is identical, 0 is disjoint.
function diceSimilarity(a, b) {
  const A = normText(a).split(' ').filter(Boolean);
  const B = normText(b).split(' ').filter(Boolean);
  if (!A.length || !B.length) return 0;
  const pool = [...B];
  let hits = 0;
  for (const w of A) {
    const i = pool.indexOf(w);
    if (i !== -1) {
      hits += 1;
      pool.splice(i, 1);
    }
  }
  return (2 * hits) / (A.length + B.length);
}

/**
 * Decide whether a block is the headline pasted into the body.
 *
 * Buckets 1-3 are mechanically certain and safe to remove. Bucket 4 is genuinely
 * ambiguous — in Urdu local news a legitimate lede often restates the headline
 * almost verbatim, and there is no reliable way to tell that apart from a
 * duplicate. Bucket 4 is therefore reported for a human and never auto-applied.
 *
 * @returns {{bucket: number, auto: boolean, reason: string}}
 */
export function classifyLeadBlock(blockHtml, title) {
  const bt = normText(blockHtml);
  const tt = normText(title);
  if (!bt || !tt) return { bucket: 0, auto: false, reason: 'empty' };

  // Never touch a block carrying media or a link — too much to lose if wrong.
  if (/<(img|iframe|a)\b/i.test(blockHtml)) {
    return { bucket: 4, auto: false, reason: 'contains media or link' };
  }

  if (bt === tt) return { bucket: 1, auto: true, reason: 'exact match' };

  if (bt.startsWith(tt) && !normText(bt.slice(tt.length))) {
    return { bucket: 2, auto: true, reason: 'title prefix, punctuation-only remainder' };
  }

  const tag = (blockHtml.match(/^<(\w+)/) || [])[1]?.toLowerCase() || '';
  const sim = diceSimilarity(bt, tt);
  if (/^h[1-3]$/.test(tag) && sim >= 0.8) {
    return { bucket: 3, auto: true, reason: `heading restating title (${sim.toFixed(2)})` };
  }

  if (sim >= 0.9 && bt.length <= tt.length * 1.3) {
    return { bucket: 4, auto: false, reason: `near-duplicate lede (${sim.toFixed(2)}) — needs a human` };
  }

  return { bucket: 0, auto: false, reason: 'distinct' };
}

/**
 * Strip the headline where it was pasted at the START of the first paragraph
 * rather than as a paragraph of its own — the more common shape here.
 *
 * Only ever cuts inside the block's first text segment, so inline markup is left
 * untouched: if the title text runs across a <strong> or a link, this bails and
 * the article is reported for review instead.
 *
 * Guards: the title must be at least 6 words (a short title could legitimately
 * open a sentence) and at least 20 words must remain.
 *
 * @returns {{html: string|null, note: string}} html is null when nothing was cut.
 */
export function stripTitlePrefixInBlock(blockHtml, title) {
  const tt = normText(title);
  if (!tt || tt.split(' ').length < 6) return { html: null, note: '' };

  const m = blockHtml.match(/^(<[^>]+>)([\s\S]*)(<\/[^>]+>)$/);
  if (!m) return { html: null, note: '' };
  const [, open, inner, close] = m;
  if (!normText(inner).startsWith(tt)) return { html: null, note: '' };

  // Walk the raw inner markup to the offset where the text so far is exactly the
  // title. Editors often bolded the pasted headline, so purely presentational
  // inline tags are stepped over; anything else (a link, an image, a nested
  // block) means bail rather than guess.
  const parts = inner.split(/(<[^>]*>)/).filter(Boolean);
  const openInline = [];
  let consumed = '';
  let rest = null;

  for (let p = 0; p < parts.length && rest === null; p += 1) {
    const part = parts[p];
    if (/^<[^>]*>$/.test(part)) {
      if (!INLINE_PRESENTATIONAL.test(part)) return { html: null, note: '' };
      if (part.startsWith('</')) openInline.pop();
      else openInline.push(part);
      consumed += part;
      continue;
    }
    // Every offset is a candidate, not just word boundaries: some bodies run the
    // headline straight into the next sentence with no space ("…پھیل گیااورملازمین"),
    // so the cut can fall inside what looks like a single token. Safe because the
    // match is exact equality against a title of at least 6 words — a shorter
    // title could plausibly prefix a real word, which is what that guard is for.
    for (let i = 1; i <= part.length; i += 1) {
      if (normText(consumed + part.slice(0, i)) === tt) {
        // Re-open any inline tag still open at the cut, so the remainder stays
        // balanced when the opening tag itself was inside the removed text.
        rest = openInline.join('') + part.slice(i) + parts.slice(p + 1).join('');
        break;
      }
    }
    consumed += part;
  }

  if (rest === null) return { html: null, note: '' };
  if (wordCount(rest) < 20) {
    return { html: null, note: 'REVIEW: stripping the repeated headline would leave under 20 words' };
  }
  return {
    html: `${open}${rest.replace(/^\s+/, '')}${close}`,
    note: 'removed headline repeated at the start of the first paragraph',
  };
}

/**
 * Remove up to two leading blocks that merely restate the title.
 * Refuses if it would leave the body under 40 words.
 */
export function stripLeadingHeadline(html, title) {
  const notes = [];
  const tokens = tokenizeBlocks(html);
  if (!tokens) {
    notes.push('BLOCK-TOKENIZE FAILED — nbsp fix only, headline left for manual review');
    return { html, notes };
  }

  let out = [...tokens];
  for (let pass = 0; pass < 2; pass += 1) {
    const idx = out.findIndex((t) => t.type === 'block' && normText(t.raw));
    if (idx === -1) break;
    const verdict = classifyLeadBlock(out[idx].raw, title);
    if (!verdict.auto) {
      if (verdict.bucket === 4) notes.push(`REVIEW: ${verdict.reason}`);
      break;
    }
    const candidate = out.filter((_, i) => i !== idx);
    if (wordCount(candidate.map((t) => t.raw).join('')) < 40) {
      notes.push('REVIEW: removing the repeated headline would leave under 40 words');
      break;
    }
    notes.push(`removed repeated headline (bucket ${verdict.bucket}: ${verdict.reason})`);
    out = candidate;
  }

  // The headline is more often fused into the opening paragraph than standing as
  // its own block, so try that shape too once the block-level passes are done.
  const idx = out.findIndex((t) => t.type === 'block' && normText(t.raw));
  if (idx !== -1) {
    const { html: trimmed, note } = stripTitlePrefixInBlock(out[idx].raw, title);
    if (trimmed) {
      out = out.map((t, i) => (i === idx ? { ...t, raw: trimmed } : t));
      notes.push(note);
    } else if (note) {
      notes.push(note);
    }
  }

  return { html: out.map((t) => t.raw).join('').trim(), notes };
}

// ---------------------------------------------------------------------------
// Paragraph structure
// ---------------------------------------------------------------------------

// Urdu full stop (U+06D4), question mark (U+061F), plus the ASCII equivalents
// that creep in from Word. A newline is a sentence break too.
const SENTENCE_END = /[۔؟!?]/;

// Benchmarked against real Urdu outlets: Dunya News breaks a 121-word crime
// report into four paragraphs (~30w each), Nawa-i-Waqt runs nearer 60. These
// values sit between the two — split anything past BLOCK_MAX, aim for TARGET,
// and never leave an orphan under MIN.
const PARA_TARGET = 35;
const PARA_MIN = 15;
const BLOCK_MAX = 55;

/**
 * Split an over-long <p> into several at sentence boundaries.
 *
 * Splits only where no inline tag is open, so a <strong> or a link is never cut
 * in half. Adds no words and removes none — this is purely where the line breaks
 * fall. Blocks that are already short enough, or that are lists/headings/quotes,
 * are returned untouched.
 *
 * @returns {string|null} the replacement markup, or null if nothing to do.
 */
export function splitBlockIntoParagraphs(blockHtml) {
  const m = blockHtml.match(/^(<(p|div)\b[^>]*>)([\s\S]*)(<\/\2>)$/i);
  if (!m) return null;
  const [, open, , inner, close] = m;
  if (wordCount(inner) <= BLOCK_MAX) return null;
  if (/<(img|iframe|br)\b/i.test(inner)) return null; // media/line-breaks: leave alone

  const parts = inner.split(/(<[^>]*>)/).filter(Boolean);
  const chunks = [];
  let current = '';
  let depth = 0;

  for (const part of parts) {
    if (/^<[^>]*>$/.test(part)) {
      if (!INLINE_PRESENTATIONAL.test(part) && !/^<\/?a\b/i.test(part)) return null;
      depth += part.startsWith('</') ? -1 : 1;
      current += part;
      continue;
    }
    let buf = '';
    for (let i = 0; i < part.length; i += 1) {
      buf += part[i];
      // Break after a sentence terminator, but only at the top level and only
      // once the paragraph has enough substance to stand on its own.
      if (
        depth === 0 &&
        SENTENCE_END.test(part[i]) &&
        (i + 1 >= part.length || /[\s]/.test(part[i + 1])) &&
        wordCount(current + buf) >= PARA_TARGET
      ) {
        chunks.push(current + buf);
        current = '';
        buf = '';
      }
    }
    current += buf;
  }
  if (current.trim()) chunks.push(current);

  if (chunks.length < 2) return null;

  // Fold a short tail back into the paragraph before it.
  if (chunks.length > 1 && wordCount(chunks[chunks.length - 1]) < PARA_MIN) {
    chunks[chunks.length - 2] += chunks.pop();
  }
  if (chunks.length < 2) return null;

  return chunks.map((c) => `${open}${c.trim()}${close}`).join('');
}

/** Apply splitBlockIntoParagraphs to every block in a body. */
export function splitIntoParagraphs(html) {
  const notes = [];
  const tokens = tokenizeBlocks(html);
  if (!tokens) return { html, notes };

  let added = 0;
  const out = tokens.map((t) => {
    if (t.type !== 'block') return t.raw;
    const split = splitBlockIntoParagraphs(t.raw);
    if (!split) return t.raw;
    added += (split.match(/<p\b/gi) || []).length - 1;
    return split;
  });

  if (added) notes.push(`split the body into ${added + 1} paragraph(s) at sentence boundaries`);
  return { html: out.join(''), notes };
}

// ---------------------------------------------------------------------------
// Reviewed rewrites
// ---------------------------------------------------------------------------

// A rewrite may only restate what the article already published, in the house
// style of the Urdu dailies (full attribution, short sentences, real paragraphs).
// These bounds are the mechanical half of that promise — the editorial half is
// the human review of data/article-rewrites.json before --apply.
const REWRITE_MIN_RATIO = 0.85;
const REWRITE_MAX_RATIO = 1.8;

/**
 * Check a proposed rewrite against the source it claims to restate.
 *
 * Catches the two failure modes a reviewer is most likely to miss: an invented
 * statistic, and a rewrite that has quietly grown far beyond restating the
 * source (which is where padding hides). It cannot prove no fact was invented —
 * only a human reading both can do that — so it is a floor, not a guarantee.
 *
 * @returns {string[]} problems; empty means the rewrite may be applied.
 */
export function checkRewrite(rewriteHtml, sourceHtml, title = '', opts = {}) {
  const problems = [];

  // Every number in the rewrite must already appear in the source or title.
  const digits = (s) => (stripTags(s).match(/[0-9]+(?:[.,][0-9]+)?/g) || []).map((d) => d.replace(/[.,]/g, ''));
  const known = new Set([...digits(sourceHtml), ...digits(title)]);
  for (const n of new Set(digits(rewriteHtml))) {
    if (!known.has(n)) problems.push(`number "${n}" does not appear in the source`);
  }

  const before = wordCount(sourceHtml);
  const after = wordCount(rewriteHtml);
  if (before) {
    const ratio = after / before;
    // allowShrink is an explicit, per-article, documented exception — used where
    // the source carried advertising copy (registration links, phone numbers)
    // that does not belong in a news body at all.
    if (ratio < REWRITE_MIN_RATIO && !opts.allowShrink) {
      problems.push(`rewrite drops content (${before}w -> ${after}w) — set allowShrink with a reason if deliberate`);
    }
    if (ratio > REWRITE_MAX_RATIO) {
      problems.push(`rewrite grew ${ratio.toFixed(2)}x (${before}w -> ${after}w) — restating should not need this many words`);
    }
  }
  if (!after) problems.push('rewrite is empty');

  return problems;
}

/**
 * Render a reviewed rewrite to HTML. Entries beginning "## " become <h2>.
 */
export function renderRewrite(paragraphs = []) {
  return paragraphs
    .map((p) => {
      const t = String(p).trim();
      if (!t) return '';
      return t.startsWith('## ')
        ? `<h2>${escapeHtml(t.slice(3).trim())}</h2>`
        : `<p>${escapeHtml(t)}</p>`;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Excerpt <-> content swap (the three articles filed the wrong way round)
// ---------------------------------------------------------------------------

export const SWAPPED_SLUGS = ['2p36usn8', 'woa49epf', 'qr9y1g2t'];

/**
 * Promote a mis-filed excerpt into the body.
 *
 * The excerpt comes from a plain <textarea>, so it is plain text and must be
 * escaped before being wrapped in markup. The guard doubles as the idempotency
 * check: once swapped, content is long and excerpt is short, so it won't re-fire.
 */
export function swapExcerptIntoContent(article) {
  const notes = [];
  const ew = wordCount(article.excerpt);
  const cw = wordCount(article.content);
  if (!(ew > cw * 3 && cw < 60)) {
    return { excerpt: article.excerpt, content: article.content, notes: ['swap guard not met — skipped'] };
  }

  const raw = String(article.excerpt || '');
  const paras = (raw.split(/\n{2,}/).length > 1 ? raw.split(/\n{2,}/) : raw.split(/\n/))
    .map((p) => p.trim())
    .filter(Boolean);

  if (paras.length === 1) {
    notes.push(`FLAG: whole story is one ${ew}-word paragraph — editor must break it up`);
  }

  let content = paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('');

  // Keep the old stub unless it is already covered by the promoted text.
  const stub = stripTags(article.content);
  if (stub && !normText(content).includes(normText(stub))) {
    content += `<p>${escapeHtml(stub)}</p>`;
    notes.push('appended the old content stub (not covered by the promoted text)');
  } else if (stub) {
    notes.push('dropped the old content stub (already present in the promoted text)');
  }

  notes.push(`swapped excerpt (${ew}w) into content; content stub was ${cw}w`);
  return { excerpt: '', content, notes };
}

// ---------------------------------------------------------------------------
// Excerpts
// ---------------------------------------------------------------------------

/**
 * An excerpt is duplicated when it repeats the body's opening OR the headline.
 *
 * The title case matters as much as the body case: the page renders the title as
 * an <h1> and the excerpt as a standfirst directly beneath it, so an excerpt that
 * restates the title prints the same sentence twice on screen.
 */
export const isExcerptDuplicated = (excerpt, content, title = '') => {
  const e = normText(excerpt);
  if (!e) return false;
  if (normText(content).includes(e)) return true;
  const t = normText(title);
  return Boolean(t) && (t.includes(e) || e.includes(t));
};

export function capExcerpt(s, max = 200) {
  const t = stripTags(s);
  return t.length <= max ? t : `${t.slice(0, max - 3).replace(/\s+\S*$/, '')}…`;
}

// ---------------------------------------------------------------------------
// The full per-article pipeline: swap -> nbsp -> headline -> excerpt
// ---------------------------------------------------------------------------

/**
 * @param {{slug:string,title:string,excerpt:string,content:string}} article
 * @param {{replacementExcerpts?: Record<string,{text:string}>, only?: Set<string>}} opts
 * @returns {{excerpt:string, content:string, notes:string[]}}
 */
export function transformArticle(article, opts = {}) {
  const only = opts.only;
  const on = (phase) => !only || only.has(phase);
  const notes = [];
  let { excerpt = '', content = '' } = article;

  if (on('swap') && SWAPPED_SLUGS.includes(article.slug)) {
    const r = swapExcerptIntoContent({ ...article, excerpt, content });
    excerpt = r.excerpt;
    content = r.content;
    notes.push(...r.notes);
  }

  if (on('nbsp')) {
    const before = content + excerpt;
    content = normalizeNbsp(content);
    excerpt = stripTags(excerpt);
    const removed = (before.match(NBSP_FAMILY) || []).length;
    if (removed) notes.push(`normalised ${removed} non-breaking space(s)`);
  }

  if (on('headline')) {
    const r = stripLeadingHeadline(content, article.title);
    content = r.html;
    notes.push(...r.notes);
  }

  // A reviewed rewrite replaces the body wholesale, so it runs before the
  // structural passes — they then tidy whatever it produced.
  if (on('rewrite') && opts.rewrites?.[article.slug]) {
    const proposed = renderRewrite(opts.rewrites[article.slug].paragraphs);
    const rw = opts.rewrites[article.slug];
    const problems = checkRewrite(proposed, content, article.title, { allowShrink: rw.allowShrink });
    if (rw.allowShrink) notes.push('FLAG: rewrite deliberately drops source text — see its note');
    if (problems.length) {
      notes.push(...problems.map((p) => `REVIEW: rewrite rejected — ${p}`));
    } else if (normText(proposed) !== normText(content)) {
      notes.push(`applied reviewed rewrite (${wordCount(content)}w -> ${wordCount(proposed)}w)`);
      content = proposed;
    }
  }

  if (on('paragraphs')) {
    const r = splitIntoParagraphs(content);
    content = r.html;
    notes.push(...r.notes);
  }

  if (on('excerpt')) {
    const replacement = opts.replacementExcerpts?.[article.slug]?.text;
    if (replacement && !isExcerptDuplicated(replacement, content, article.title)) {
      excerpt = capExcerpt(replacement);
      notes.push('applied reviewed replacement excerpt');
    } else if (replacement) {
      notes.push('SKIPPED replacement excerpt — it appears verbatim in the body');
    } else if (isExcerptDuplicated(excerpt, content, article.title)) {
      notes.push('REVIEW: excerpt still duplicates the body (no replacement supplied)');
    }
  }

  return { excerpt, content, notes };
}
