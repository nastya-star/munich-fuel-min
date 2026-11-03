// The article pages must contain the approved texts exactly; only presentation may differ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderArticlePage, INLINE_MATH, LATEX_MATH, DISPLAY_SOURCE, DISPLAY_SOURCE_DE } from '../article.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
// SHA-256 of the author's final approved files ("Pasted markdown(9).md" and
// "Munich_Fuel_How_It_Works_DE_Updated.md"). If the author changes an article intentionally,
// update its value together with the new file.
const ARTICLES = {
  en: {
    md: '../content/how-it-works.md', page: '../docs/how-it-works.html', sha: '5b09e5a75076f9b9204ad8e50a6703c86051de3685f80b5a7028fec44c0b3d83',
    display: DISPLAY_SOURCE, mathRe: /\(((?:[^()]|\([^()]*\))*)\)/g, table: INLINE_MATH, inline: 19,
    start: 'How does it work? A transparent fuel-price comparison system for Munich', end: 'Yours, admiringly, Anastasiia P.S. Made with love.',
    title: 'How does it work? · Munich Fuel Minimum', canonical: 'https://nastya-star.github.io/munich-fuel-min/how-it-works.html',
    nav: [['https://nastya-star.github.io/anastasiia-stepanenko/', '← Back to my website'], ['https://nastya-star.github.io/munich-fuel-min/', '← Back to fuel minimisation']],
  },
  de: {
    md: '../content/how-it-works.de.md', page: '../docs/de/how-it-works.html', sha: '2457901ace660bb8c094aa928a17f00ef6715e4f405c194112a21a79c93f9e28',
    display: DISPLAY_SOURCE_DE, mathRe: /\\\((.+?)\\\)/g, table: LATEX_MATH, inline: 19,
    start: 'Wie funktioniert es? 01 Einleitung Hallo, wir kennen uns ja schon.', end: 'Mit bewundernden Grüßen, Anastasiia P.S. Mit Liebe gemacht.',
    title: 'Wie funktioniert es? · Munich Fuel Minimum', canonical: 'https://nastya-star.github.io/munich-fuel-min/de/how-it-works.html',
    nav: [['https://nastya-star.github.io/anastasiia-stepanenko/de/', '← Zurück zur Hauptwebsite'], ['https://nastya-star.github.io/munich-fuel-min/de/', '← Zurück zu Munich Fuel Minimum']],
  },
};

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const words = (s) => s.replace(/\s+/g, ' ').trim();

/** Markdown -> plain text: syntax removed, math replaced by stable tokens. */
function mdText(md, a) {
  const tokens = [];
  const hold = (t) => ` \u0000${tokens.push(t) - 1}\u0000 `;
  let s = md.replace(a.display, hold('⟦DISPLAY⟧'));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1');
  s = s.replace(a.mathRe, (_, tex) => hold(`⟦${tex}⟧`));
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

for (const [lang, a] of Object.entries(ARTICLES)) {
  const MD = read(a.md);
  const HTML = renderArticlePage(MD, lang);

  test(`${lang}: the stored article is the approved file, byte for byte`, () => {
    assert.equal(createHash('sha256').update(readFileSync(new URL(a.md, import.meta.url))).digest('hex'), a.sha);
  });

  test(`${lang}: page text equals the article text exactly (title to P.S.)`, () => {
    const expected = mdText(MD, a);
    const actual = htmlText(HTML);
    if (actual !== expected) {
      const x = actual.split(' '), e = expected.split(' ');
      const i = e.findIndex((w, k) => w !== x[k]);
      assert.fail(`first difference at word ${i}: expected "${e.slice(i, i + 8).join(' ')}" got "${x.slice(i, i + 8).join(' ')}"`);
    }
    assert.ok(expected.split(' ').length > 2500, 'whole article compared');
    assert.ok(actual.startsWith(a.start), actual.slice(0, 80));
    assert.ok(actual.endsWith(a.end), actual.slice(-80));
  });

  test(`${lang}: all links keep their targets`, () => {
    const mdLinks = [...MD.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
    const article = HTML.slice(HTML.indexOf('<article>'), HTML.indexOf('</article>'));
    assert.deepEqual([...article.matchAll(/<a href="([^"]+)"/g)].map((m) => decode(m[1])), mdLinks);
    assert.equal(mdLinks.length, 4);
  });

  test(`${lang}: every math expression is MathML; no LaTeX source left in the text`, () => {
    assert.equal([...HTML.matchAll(/<math display="block"/g)].length, 1, 'one display equation');
    assert.equal([...HTML.matchAll(/<math data-tex="/g)].length, a.inline, 'all inline expressions');
    const visible = HTML.replace(/<math[\s\S]*?<\/math>/g, '').replace(/<[^>]+>/g, '');
    assert.doesNotMatch(visible, /\\(min|in|operatorname|widehat|tau|boxed)|\\_|\\\*|\\\(|\\\[|S_f|p_f|t_i/);
    for (const tex of Object.keys(a.table)) assert.ok(lang === 'en' ? MD.includes(`(${tex})`) : MD.includes(`\\(${tex}\\)`), `table entry used: ${tex}`);
  });

  test(`${lang}: the objective is centred and boxed: p_f^*(x,r,t) = min over S_f(x,r,t) of p_{i,f}(t_i)`, () => {
    const m = /<div class="eq"><span class="box"><math display="block" data-tex="DISPLAY">([\s\S]*?)<\/math><\/span><\/div>/.exec(HTML);
    assert.ok(m);
    assert.match(m[1], /^<msubsup><mi>p<\/mi><mi>f<\/mi><mo>\*<\/mo><\/msubsup>/);
    assert.match(m[1], /<mo>=<\/mo><munder><mo movablelimits="false">min<\/mo><mrow><mi>i<\/mi><mo>∈<\/mo>/);
  });

  test(`${lang}: back navigation top and bottom, title, canonical, language`, () => {
    const navs = [...HTML.matchAll(/<nav class="nav[^"]*"[^>]*>([\s\S]*?)<\/nav>/g)].map((m) => m[1]);
    assert.equal(navs.length, 2);
    for (const n of navs) for (const [href, label] of a.nav) assert.ok(n.includes(`<a href="${href}">${label}</a>`), `${label} -> ${href}`);
    assert.ok(HTML.indexOf('<nav class="nav"') < HTML.indexOf('<article>'));
    assert.ok(HTML.lastIndexOf('<nav class="nav bottom"') > HTML.indexOf('</article>'));
    assert.ok(HTML.includes(`<title>${a.title}</title>`));
    assert.ok(HTML.includes(`<link rel="canonical" href="${a.canonical}">`));
    assert.ok(HTML.includes(`<html lang="${lang}">`));
  });

  test(`${lang}: the built page in docs/ is current`, () => {
    assert.equal(read(a.page).replace(/\r\n/g, '\n'), HTML, 'run node build.mjs');
  });
}

test('both homepages link to the article in their language, after the list and before the footer', () => {
  for (const [file, href, label] of [
    ['../docs/index.html', 'https://nastya-star.github.io/munich-fuel-min/how-it-works.html', 'How does it work?'],
    ['../docs/de/index.html', 'https://nastya-star.github.io/munich-fuel-min/de/how-it-works.html', 'Wie funktioniert es?'],
  ]) {
    const page = read(file);
    assert.ok(page.includes(`<p class="howto"><a class="btn" href="${href}">${label}</a></p>`), file);
    assert.ok(page.indexOf('class="howto"') > page.indexOf('id="more"') && page.indexOf('class="howto"') < page.indexOf('<footer>'), file);
  }
});

test('English description is the article subtitle', () => {
  assert.ok(renderArticlePage(read('../content/how-it-works.md'), 'en').includes('<meta name="description" content="A transparent fuel-price comparison system for Munich, designed for accuracy, privacy and reproducibility.">'));
});
