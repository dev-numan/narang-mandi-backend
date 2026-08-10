import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeNbsp,
  normText,
  stripTags,
  tokenizeBlocks,
  classifyLeadBlock,
  stripLeadingHeadline,
  splitIntoParagraphs,
  checkRewrite,
  renderRewrite,
  swapExcerptIntoContent,
  isExcerptDuplicated,
  transformArticle,
  wordCount,
} from './articleText.js';

const NBSP = ' ';
const RLM = '‏';
const ZWNJ = '‌';

const TITLE = 'نارنگ منڈی میں ٹریفک حادثہ، دو افراد زخمی';
const LEDE =
  'ریسکیو 1122 کے مطابق اطلاع ملتے ہی امدادی ٹیمیں موقع پر پہنچیں اور زخمیوں کو ہسپتال منتقل کیا۔';
const BODY_2 = 'پولیس نے واقعے کا مقدمہ درج کر کے تفتیش شروع کر دی ہے۔';
const BODY_3 = 'مقامی افراد نے سڑک پر حفاظتی اقدامات نہ ہونے کی شکایت کی۔';
const BODY_4 = 'ضلعی انتظامیہ نے واقعے کی رپورٹ طلب کر لی ہے۔';

// ---------------------------------------------------------------------------
// normalizeNbsp — the 6,204-occurrence defect
// ---------------------------------------------------------------------------

test('normalizeNbsp turns nbsp entities between Urdu words into real spaces', () => {
  const html = '<p>نارنگ&nbsp;منڈی&nbsp;میں&nbsp;حادثہ</p>';
  assert.equal(normalizeNbsp(html), '<p>نارنگ منڈی میں حادثہ</p>');
});

test('normalizeNbsp handles literal U+00A0 and U+202F as well as entities', () => {
  assert.equal(normalizeNbsp(`<p>ا${NBSP}ب ج</p>`), '<p>ا ب ج</p>');
});

test('normalizeNbsp never touches attribute values', () => {
  const html = '<a href="/x?a=1&nbsp;b" title="a&nbsp;b">متن&nbsp;یہاں</a>';
  assert.equal(normalizeNbsp(html), '<a href="/x?a=1&nbsp;b" title="a&nbsp;b">متن یہاں</a>');
});

test('normalizeNbsp does NOT decode &amp; / &lt; / &gt; — that would create live markup', () => {
  const html = '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; مزید</p>';
  assert.equal(normalizeNbsp(html), html);
});

test('normalizeNbsp preserves RLM and ZWNJ, which are shaping-significant in Urdu', () => {
  const html = `<p>${RLM}کام${ZWNJ}کاج</p>`;
  assert.ok(normalizeNbsp(html).includes(RLM));
  assert.ok(normalizeNbsp(html).includes(ZWNJ));
});

test('normalizeNbsp is idempotent', () => {
  const html = '<p>ا&nbsp;&nbsp;ب</p>';
  assert.equal(normalizeNbsp(normalizeNbsp(html)), normalizeNbsp(html));
});

// ---------------------------------------------------------------------------
// normText — comparison normaliser
// ---------------------------------------------------------------------------

test('normText folds Arabic letter forms so a Word-pasted body matches an Urdu title', () => {
  // Word emits Arabic yeh/kaf; the title was typed with Urdu yeh/kaf.
  assert.equal(normText('كيا يہ ٹھيك ہے'), normText('کیا یہ ٹھیک ہے'));
});

test('normText ignores Urdu punctuation and diacritics', () => {
  assert.equal(normText('حادثہ، دو افراد زخمی۔'), normText('حادثہ دو افراد زخمی'));
});

test('normText strips tags and nbsp so markup differences do not defeat matching', () => {
  assert.equal(normText('<p><strong>نارنگ</strong>&nbsp;منڈی</p>'), 'نارنگ منڈی');
});

test('stripTags decodes entities but collapses to plain text', () => {
  assert.equal(stripTags('<p>a&amp;b&nbsp;&nbsp;c</p>'), 'a&b c');
});

// ---------------------------------------------------------------------------
// tokenizeBlocks — the Layer B safety guard
// ---------------------------------------------------------------------------

test('tokenizeBlocks round-trips typical Quill output byte-for-byte', () => {
  const html = `<h2>عنوان</h2><p>${BODY_2}</p><ul><li>ایک</li><li>دو</li></ul><p><br></p>`;
  const tokens = tokenizeBlocks(html);
  assert.ok(tokens, 'expected the tokenizer to accept flat Quill markup');
  assert.equal(tokens.map((t) => t.raw).join(''), html);
});

test('tokenizeBlocks returns null rather than risk mangling unexpected nesting', () => {
  // A block that never closes cannot be reassembled safely.
  assert.equal(tokenizeBlocks('<p>ا<p>ب'), null);
});

// ---------------------------------------------------------------------------
// classifyLeadBlock — the headline-duplication buckets
// ---------------------------------------------------------------------------

test('bucket 1: a first paragraph identical to the title is auto-removable', () => {
  const v = classifyLeadBlock(`<p>${TITLE}</p>`, TITLE);
  assert.equal(v.bucket, 1);
  assert.equal(v.auto, true);
});

test('bucket 2: title plus trailing punctuation only is auto-removable', () => {
  const v = classifyLeadBlock(`<p>${TITLE} ۔</p>`, TITLE);
  assert.equal(v.auto, true);
});

test('bucket 3: an h2 loosely restating the title is auto-removable', () => {
  // Not identical (that would be bucket 1) — a heading that reworks the title
  // slightly is still never a lede.
  const v = classifyLeadBlock(`<h2>${TITLE} ہو گئے</h2>`, TITLE);
  assert.equal(v.bucket, 3);
  assert.equal(v.auto, true);
});

test('a genuine lede is left alone', () => {
  const v = classifyLeadBlock(`<p>${LEDE}</p>`, TITLE);
  assert.equal(v.bucket, 0);
  assert.equal(v.auto, false);
});

test('a block containing a link is never auto-removed, however similar', () => {
  const v = classifyLeadBlock(`<p><a href="/x">${TITLE}</a></p>`, TITLE);
  assert.equal(v.auto, false);
  assert.match(v.reason, /media or link/);
});

// ---------------------------------------------------------------------------
// stripLeadingHeadline
// ---------------------------------------------------------------------------

test('stripLeadingHeadline removes the duplicated headline and keeps the body', () => {
  const html = `<p>${TITLE}</p><p>${LEDE}</p><p>${BODY_2}</p><p>${BODY_3}</p>`;
  const { html: out, notes } = stripLeadingHeadline(html, TITLE);
  assert.ok(!normText(out).startsWith(normText(TITLE)));
  assert.ok(out.includes(LEDE));
  assert.ok(notes.some((n) => n.includes('removed repeated headline')));
});

test('stripLeadingHeadline does not remove a legitimate lede', () => {
  const html = `<p>${LEDE}</p><p>${BODY_2}</p><p>${BODY_3}</p>`;
  assert.equal(stripLeadingHeadline(html, TITLE).html, html);
});

test('stripLeadingHeadline refuses when it would leave under 40 words', () => {
  const html = `<p>${TITLE}</p><p>مختصر خبر۔</p>`;
  const { html: out, notes } = stripLeadingHeadline(html, TITLE);
  assert.equal(out, html, 'short article must be left intact');
  assert.ok(notes.some((n) => n.startsWith('REVIEW:')));
});

test('stripLeadingHeadline preserves an inline link elsewhere in the body', () => {
  const html = `<p>${TITLE}</p><p>${LEDE}</p><p>${BODY_2} <a href="/y">مزید</a></p><p>${BODY_3}</p>`;
  const out = stripLeadingHeadline(html, TITLE).html;
  assert.ok(out.includes('<a href="/y">مزید</a>'));
});

test('stripLeadingHeadline strips a headline fused into the opening paragraph', () => {
  const html = `<p>${TITLE} ${LEDE} ${BODY_2} ${BODY_3}</p><p>${BODY_4}</p>`;
  const { html: out, notes } = stripLeadingHeadline(html, TITLE);
  assert.ok(!normText(out).startsWith(normText(TITLE)));
  assert.ok(out.startsWith('<p>'), 'must keep the paragraph wrapper');
  assert.ok(out.includes(LEDE) && out.includes(BODY_4));
  assert.ok(notes.some((n) => n.includes('start of the first paragraph')));
});

test('the fused-headline strip refuses when too little would remain', () => {
  const html = `<p>${TITLE} مختصر خبر۔</p>`;
  const { html: out, notes } = stripLeadingHeadline(html, TITLE);
  assert.equal(out, html);
  assert.ok(notes.some((n) => n.startsWith('REVIEW:')));
});

test('the fused-headline strip steps over a bolded headline and stays balanced', () => {
  // The real shape in this database: <p><strong>TITLE …body…</strong></p>
  const html = `<p><strong>${TITLE} ${LEDE} ${BODY_2} ${BODY_3}</strong></p>`;
  const out = stripLeadingHeadline(html, TITLE).html;
  assert.ok(!normText(out).startsWith(normText(TITLE)));
  assert.ok(out.includes(LEDE));
  assert.equal(
    (out.match(/<strong>/g) || []).length,
    (out.match(/<\/strong>/g) || []).length,
    'strong tags must stay balanced after the cut'
  );
});

test('the fused-headline strip bails when the title runs through a link', () => {
  const words = TITLE.split(' ');
  const html = `<p>${words.slice(0, 3).join(' ')} <a href="/x">${words.slice(3).join(' ')}</a> ${LEDE} ${BODY_2} ${BODY_3}</p>`;
  assert.equal(stripLeadingHeadline(html, TITLE).html, html, 'must not cut across a link');
});

test('a short title is never treated as a repeated headline prefix', () => {
  const short = 'حادثہ';
  const html = `<p>${short} کی خبر ${LEDE} ${BODY_2} ${BODY_3}</p>`;
  assert.equal(stripLeadingHeadline(html, short).html, html);
});

test('stripLeadingHeadline falls back safely when the tokenizer bails', () => {
  const html = '<p>ا<p>ب';
  const { html: out, notes } = stripLeadingHeadline(html, TITLE);
  assert.equal(out, html);
  assert.ok(notes.some((n) => n.includes('BLOCK-TOKENIZE FAILED')));
});

// ---------------------------------------------------------------------------
// swapExcerptIntoContent — the three mis-filed articles
// ---------------------------------------------------------------------------

const swapArticle = {
  slug: '2p36usn8',
  title: TITLE,
  excerpt: `${LEDE}\n\n${BODY_2}\n\n${BODY_3}\n\n${BODY_4}`,
  content: 'مختصر۔',
};

test('swapExcerptIntoContent promotes the excerpt into paragraphs', () => {
  const r = swapExcerptIntoContent(swapArticle);
  assert.equal(r.excerpt, '');
  // 4 promoted paragraphs + the old stub, which is not covered by them and so is
  // kept rather than silently discarded.
  assert.equal((r.content.match(/<p>/g) || []).length, 5);
  assert.ok(r.content.includes(LEDE));
  assert.ok(r.notes.some((n) => n.includes('appended the old content stub')));
});

test('swapExcerptIntoContent HTML-escapes the plain-text excerpt', () => {
  const r = swapExcerptIntoContent({ ...swapArticle, excerpt: `<script>x</script> & ${LEDE}` });
  assert.ok(!r.content.includes('<script>'));
  assert.ok(r.content.includes('&lt;script&gt;'));
  assert.ok(r.content.includes('&amp;'));
});

test('swapExcerptIntoContent flags a single-paragraph wall of text', () => {
  const r = swapExcerptIntoContent({ ...swapArticle, excerpt: `${LEDE} ${BODY_2} ${BODY_3}` });
  assert.ok(r.notes.some((n) => n.startsWith('FLAG:')));
});

test('swapExcerptIntoContent is a no-op once already swapped (idempotency guard)', () => {
  const once = swapExcerptIntoContent(swapArticle);
  const twice = swapExcerptIntoContent({ ...swapArticle, ...once });
  assert.equal(twice.content, once.content);
  assert.ok(twice.notes.some((n) => n.includes('guard not met')));
});

// ---------------------------------------------------------------------------
// Paragraph splitting
// ---------------------------------------------------------------------------

const LONG = [LEDE, BODY_2, BODY_3, BODY_4, LEDE, BODY_2, BODY_3, BODY_4, LEDE, BODY_2].join(' ');

test('splitIntoParagraphs breaks a wall of text at sentence boundaries', () => {
  const { html: out, notes } = splitIntoParagraphs(`<p>${LONG}</p>`);
  const paras = out.match(/<p>/g) || [];
  assert.ok(paras.length >= 2, `expected multiple paragraphs, got ${paras.length}`);
  assert.ok(notes.some((n) => n.includes('paragraph')));
});

test('splitting adds and removes no words', () => {
  const before = wordCount(`<p>${LONG}</p>`);
  assert.equal(wordCount(splitIntoParagraphs(`<p>${LONG}</p>`).html), before);
});

test('every paragraph ends on a sentence terminator', () => {
  const out = splitIntoParagraphs(`<p>${LONG}</p>`).html;
  for (const inner of [...out.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1].trim())) {
    assert.match(inner.slice(-1), /[۔؟!?]/, `paragraph does not end on a terminator: …${inner.slice(-30)}`);
  }
});

test('a short article is left as one paragraph', () => {
  const html = `<p>${LEDE} ${BODY_2}</p>`;
  assert.equal(splitIntoParagraphs(html).html, html);
});

test('splitting never cuts inside a link or inline tag', () => {
  const html = `<p>${LEDE} <strong>${BODY_2}</strong> ${BODY_3} <a href="/x">${BODY_4}</a> ${LONG}</p>`;
  const out = splitIntoParagraphs(html).html;
  assert.equal((out.match(/<strong>/g) || []).length, (out.match(/<\/strong>/g) || []).length);
  assert.equal((out.match(/<a /g) || []).length, (out.match(/<\/a>/g) || []).length);
  assert.ok(out.includes('<a href="/x">'));
});

test('blocks carrying media or lists are left alone', () => {
  const withImg = `<p><img src="/a.jpg" /> ${LONG}</p>`;
  assert.equal(splitIntoParagraphs(withImg).html, withImg);
  const list = `<ul><li>${LONG}</li></ul>`;
  assert.equal(splitIntoParagraphs(list).html, list);
});

test('splitIntoParagraphs is idempotent', () => {
  const once = splitIntoParagraphs(`<p>${LONG}</p>`).html;
  assert.equal(splitIntoParagraphs(once).html, once);
});

test('no orphan paragraph shorter than the minimum', () => {
  const out = splitIntoParagraphs(`<p>${LONG} ${BODY_2}</p>`).html;
  const inners = [...out.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => wordCount(m[1]));
  if (inners.length > 1) assert.ok(Math.min(...inners) >= 20, `orphan paragraph: ${inners}`);
});

// ---------------------------------------------------------------------------
// Rewrite guards
// ---------------------------------------------------------------------------

const SOURCE = `<p>${TITLE} ${LEDE} ${BODY_2} ${BODY_3} ${BODY_4}</p>`;

test('checkRewrite accepts an honest restatement', () => {
  const rewrite = `<p>${LEDE}</p><p>${BODY_2}</p><p>${BODY_3}</p><p>${BODY_4}</p>`;
  assert.deepEqual(checkRewrite(rewrite, SOURCE, TITLE), []);
});

test('checkRewrite rejects an invented number', () => {
  // "1122" is in the source; "7" deaths are not.
  const rewrite = `<p>${LEDE}</p><p>حادثے میں 7 افراد جاں بحق ہوئے۔</p><p>${BODY_3}</p><p>${BODY_4}</p>`;
  const problems = checkRewrite(rewrite, SOURCE, TITLE);
  assert.ok(problems.some((p) => p.includes('"7"')), problems.join('; '));
});

test('checkRewrite rejects padding beyond restatement', () => {
  // 153w -> 350w, the inflation actually asked for, is 2.3x. The ceiling is 1.8x,
  // so a rewrite can restate generously but cannot pad its way to a word target.
  const padded = `<p>${Array(4).fill([LEDE, BODY_2, BODY_3, BODY_4].join(' ')).join(' ')}</p>`;
  const problems = checkRewrite(padded, SOURCE, TITLE);
  assert.ok(problems.some((p) => p.includes('grew')), problems.join('; ') || 'no problem reported');
});

test('checkRewrite rejects a rewrite that silently drops content', () => {
  assert.ok(checkRewrite(`<p>${LEDE}</p>`, SOURCE, TITLE).some((p) => p.includes('drops content')));
});

test('checkRewrite rejects an empty rewrite', () => {
  assert.ok(checkRewrite('', SOURCE, TITLE).some((p) => p.includes('empty')));
});

test('a rejected rewrite is reported and never applied', () => {
  const article = { slug: 'zzz', title: TITLE, excerpt: '', content: SOURCE };
  const r = transformArticle(article, {
    rewrites: { zzz: { paragraphs: ['حادثے میں 99 افراد جاں بحق ہوئے۔', LEDE, BODY_2, BODY_3] } },
  });
  assert.ok(r.notes.some((n) => n.startsWith('REVIEW: rewrite rejected')));
  assert.ok(!r.content.includes('99'), 'the rejected rewrite must not reach the content');
});

test('renderRewrite escapes text and supports h2 entries', () => {
  const html = renderRewrite(['## عنوان', 'متن & <b>']);
  assert.ok(html.includes('<h2>عنوان</h2>'));
  assert.ok(html.includes('&amp;') && html.includes('&lt;b&gt;'));
});

// ---------------------------------------------------------------------------
// Excerpt duplication
// ---------------------------------------------------------------------------

test('isExcerptDuplicated sees through markup, nbsp and letter-form differences', () => {
  assert.equal(isExcerptDuplicated(LEDE, `<p>${LEDE.replace(/ /g, '&nbsp;')}</p>`), true);
  assert.equal(isExcerptDuplicated('کوئی اور خلاصہ', `<p>${LEDE}</p>`), false);
});

test('isExcerptDuplicated also catches an excerpt that restates the TITLE', () => {
  // The page prints the title as <h1> and the excerpt as a standfirst directly
  // beneath, so this prints the same sentence twice even though the body differs.
  assert.equal(isExcerptDuplicated(TITLE, `<p>${LEDE}</p>`, TITLE), true);
  assert.equal(isExcerptDuplicated(`${TITLE} ہو گئے`, `<p>${LEDE}</p>`, TITLE), true);
  assert.equal(isExcerptDuplicated('ایک الگ خلاصہ جو مختلف ہے', `<p>${LEDE}</p>`, TITLE), false);
});

test('isExcerptDuplicated stays false when no title is supplied', () => {
  assert.equal(isExcerptDuplicated(TITLE, `<p>${LEDE}</p>`), false);
});

test('the fused-headline strip cuts even with no space before the next word', () => {
  // Real shape in this data: "…خوف و ہراس پھیل گیااورملازمین اپنی نشستیں…"
  const html = `<p>${TITLE}اور ${LEDE} ${BODY_2} ${BODY_3}</p>`;
  const out = stripLeadingHeadline(html, TITLE).html;
  assert.ok(!normText(out).startsWith(normText(TITLE)));
  assert.ok(out.includes(LEDE));
});

// ---------------------------------------------------------------------------
// Whole pipeline
// ---------------------------------------------------------------------------

const fullArticle = {
  slug: 'abc123',
  title: TITLE,
  excerpt: LEDE,
  content: `<p>${TITLE.replace(/ /g, '&nbsp;')}</p><p>${LEDE.replace(/ /g, '&nbsp;')}</p><p>${BODY_2}</p><p>${BODY_3}</p><p>${BODY_4}</p>`,
};

test('transformArticle clears nbsp, removes the headline, and reports the duplicate excerpt', () => {
  const r = transformArticle(fullArticle);
  assert.ok(!r.content.includes('&nbsp;'));
  assert.ok(!normText(r.content).startsWith(normText(TITLE)));
  assert.ok(r.notes.some((n) => n.includes('REVIEW: excerpt still duplicates')));
});

test('transformArticle applies a reviewed replacement excerpt', () => {
  const r = transformArticle(fullArticle, {
    replacementExcerpts: { abc123: { text: 'ٹریفک حادثے میں دو افراد زخمی، ریسکیو ٹیمیں موقع پر پہنچ گئیں۔' } },
  });
  assert.ok(r.notes.some((n) => n.includes('applied reviewed replacement')));
  assert.equal(isExcerptDuplicated(r.excerpt, r.content), false);
});

test('transformArticle refuses a replacement excerpt that is itself a body substring', () => {
  const r = transformArticle(fullArticle, { replacementExcerpts: { abc123: { text: BODY_2 } } });
  assert.ok(r.notes.some((n) => n.includes('SKIPPED replacement')));
});

test('transformArticle reaches a fixed point: f(f(x)) === f(x)', () => {
  for (const a of [fullArticle, swapArticle, { ...fullArticle, content: '<p>ا<p>ب' }]) {
    const once = transformArticle(a);
    const twice = transformArticle({ ...a, ...once });
    assert.equal(twice.content, once.content, `content not stable for ${a.slug}`);
    assert.equal(twice.excerpt, once.excerpt, `excerpt not stable for ${a.slug}`);
  }
});

test('wordCount counts Urdu words, not bytes', () => {
  assert.equal(wordCount('<p>ایک دو تین</p>'), 3);
  assert.equal(wordCount(''), 0);
});
