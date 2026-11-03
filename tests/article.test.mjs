// The article page must contain the approved text exactly; only presentation may differ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderArticlePage, INLINE_MATH, DISPLAY_SOURCE } from '../article.mjs';

const MD = readFileSync(new URL('../content/how-it-works.md', import.meta.url), 'utf8');
const HTML = renderArticlePage(MD);
// SHA-256 of the author's final approved file ("Pasted markdown(9).md"). If the author changes the
// article intentionally, update this value together with the new file.
const APPROVED_SHA256 = '5b09e5a75076f9b9204ad8e50a6703c86051de3685f80b5a7028fec44c0b3d83';

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const words = (s) => s.replace(/\s+/g, ' ').trim();

/** Markdown -> plain text: syntax removed, math replaced by stable tokens. */
function mdText(md) {
  const tokens = [];
  const hold = (t) => ` \u0000${tokens.push(t) - 1}\u0000 `;
  let s = md.replace(DISPLAY_SOURCE, hold('⟦DISPLAY⟧'));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1');
  s = s.replace(/\(((?:[^()]|\([^()]*\))*)\)/g, (_, tex) => hold(`⟦${tex}⟧`));
  s = s.replace(/^#{1,3} /gm, '').replace(/^---$/gm, '').replace(/\\$/gm, '');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/`([^`]+)`/g, '$1');
  return words(s.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]));
}

/** HTML -> plain text: article only (navigation removed), math replaced by its source token. */
function htmlText(html) {
  let s = html.slice(html.indexOf('<article>'), html.indexOf('</article>'));
  s = s.replace(/<math[^>]*data-tex="([^"]*)"[^>]*>[\s\S]*?<\/math>/g, (_, tex) => ` ⟦${decode(tex)}⟧ `);
  // block-level tags separate words; inline tags (strong, em, a, code, span) do not
  s = s.replace(/<\/?(p|h1|h2|h3|div|section|header|br|hr)\b[^>]*>/g, ' ').replace(/<[^>]+>/g, '');
  return words(decode(s));
}

test('the stored article is the approved file, byte for byte', () => {
  assert.equal(createHash('sha256').update(readFileSync(new URL('../content/how-it-works.md', import.meta.url))).digest('hex'), APPROVED_SHA256);
});

test('page text equals the article text exactly (from the title to the P.S.)', () => {
  const expected = mdText(MD);
  const actual = htmlText(HTML);
  if (actual !== expected) {
    const a = actual.split(' '), e = expected.split(' ');
    const i = e.findIndex((w, k) => w !== a[k]);
    assert.fail(`first difference at word ${i}: expected "${e.slice(i, i + 8).join(' ')}" got "${a.slice(i, i + 8).join(' ')}"`);
  }
  assert.ok(actual.startsWith('How does it work? A transparent fuel-price comparison system for Munich'));
  assert.ok(actual.endsWith('Yours, admiringly, Anastasiia P.S. Made with love.'));
});

test('all links keep their targets', () => {
  const mdLinks = [...MD.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  const article = HTML.slice(HTML.indexOf('<article>'), HTML.indexOf('</article>'));
  const htmlLinks = [...article.matchAll(/<a href="([^"]+)"/g)].map((m) => decode(m[1]));
  assert.deepEqual(htmlLinks, mdLinks);
  assert.equal(mdLinks.length, 4);
});

test('every math expression is rendered as MathML; no LaTeX source left in the text', () => {
  const inline = [...HTML.matchAll(/<math data-tex="/g)].length;
  const display = [...HTML.matchAll(/<math display="block"/g)].length;
  assert.equal(display, 1, 'one display equation');
  assert.equal(inline, 19, 'all inline expressions');
  const visible = HTML.replace(/<math[\s\S]*?<\/math>/g, '').replace(/<[^>]+>/g, '');
  assert.doesNotMatch(visible, /\\(min|in|operatorname|widehat|tau)|\\_|\\\*|S_f|p_f|t_i/);
  for (const tex of Object.keys(INLINE_MATH)) assert.ok(MD.includes(`(${tex})`), `table entry used: ${tex}`);
});

test('display objective is centred in its own container, with min and its index set', () => {
  const m = /<div class="eq"><span class="box"><math display="block" data-tex="DISPLAY">([\s\S]*?)<\/math><\/span><\/div>/.exec(HTML);
  assert.ok(m);
  assert.match(m[1], /<munder><mo movablelimits="false">min<\/mo><mrow><mi>i<\/mi><mo>∈<\/mo>/);
  assert.match(m[1], /^<msubsup><mi>p<\/mi><mi>f<\/mi><mo>\*<\/mo><\/msubsup>/);
});

test('back navigation at the top and bottom, title, description and canonical', () => {
  const navs = [...HTML.matchAll(/<nav class="nav[^"]*"[^>]*>([\s\S]*?)<\/nav>/g)].map((m) => m[1]);
  assert.equal(navs.length, 2);
  for (const n of navs) {
    assert.match(n, /<a href="https:\/\/nastya-star\.github\.io\/anastasiia-stepanenko\/">← Back to my website<\/a>/);
    assert.match(n, /<a href="https:\/\/nastya-star\.github\.io\/munich-fuel-min\/">← Back to fuel minimisation<\/a>/);
  }
  assert.ok(HTML.indexOf('<nav class="nav"') < HTML.indexOf('<article>'));
  assert.ok(HTML.lastIndexOf('<nav class="nav bottom"') > HTML.indexOf('</article>'));
  assert.match(HTML, /<title>How does it work\? · Munich Fuel Minimum<\/title>/);
  assert.match(HTML, /<link rel="canonical" href="https:\/\/nastya-star\.github\.io\/munich-fuel-min\/how-it-works\.html">/);
  assert.match(HTML, /<meta name="description" content="A transparent fuel-price comparison system for Munich, designed for accuracy, privacy and reproducibility\.">/);
  assert.match(HTML, /<html lang="en">/);
});

test('the built page in docs/ is current, and both homepages link to the article', () => {
  const built = readFileSync(new URL('../docs/how-it-works.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(built, HTML, 'run node build.mjs');
  for (const [file, label] of [['../docs/index.html', 'How does it work?'], ['../docs/de/index.html', 'Wie funktioniert es?']]) {
    const page = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(page.includes(`<a class="btn" href="https://nastya-star.github.io/munich-fuel-min/how-it-works.html" hreflang="en">${label}</a>`), file);
    assert.ok(page.indexOf('class="howto"') > page.indexOf('id="more"') && page.indexOf('class="howto"') < page.indexOf('<footer>'), `${file}: button after the list, before the footer`);
  }
});
