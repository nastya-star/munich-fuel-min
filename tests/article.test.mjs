// The article pages must contain the approved texts exactly; only presentation may differ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderArticlePage, INLINE_MATH, LATEX_MATH, DISPLAY_SOURCE } from '../article.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
// SHA-256 of the approved article files: the author's texts ("Pasted markdown(9).md",
// "Munich_Fuel_How_It_Works_DE_Updated.md") with the requested 02.2 objective rewrite
// (min sum p_i z_i, sum z_i = 1) and the 5/10/20 km option sentence. If an article changes
// intentionally, update its value together with the new file.
const ARTICLES = {
  en: {
    md: '../content/how-it-works.md', page: '../docs/how-it-works.html', sha: '31871552b0a000704c1016ab7a7540330b1c2167fa4f3f87214918a935f8d368',
    display: DISPLAY_SOURCE, mathRe: /\(((?:[^()]|\([^()]*\))*)\)/g, table: INLINE_MATH, inline: 24,
    other: 'https://nastya-star.github.io/munich-fuel-min/de/how-it-works.html', options: 'select a radius of 5, 10 or 20 kilometers',
    start: 'How does it work? A transparent fuel-price comparison system for Munich', end: 'Yours, admiringly, Anastasiia P.S. Made with love.',
    title: 'How does it work? · Munich Fuel Minimum', canonical: 'https://nastya-star.github.io/munich-fuel-min/how-it-works.html',
    nav: [['https://nastya-star.github.io/anastasiia-stepanenko/', '← Back to my website'], ['https://nastya-star.github.io/munich-fuel-min/', '← Back to fuel minimisation']],
  },
  de: {
    md: '../content/how-it-works.de.md', page: '../docs/de/how-it-works.html', sha: 'fb59b68effb89f6c4636ff31d2d3b093b1e7a712eccf47d1ca177c0d3edf71e5',
    display: DISPLAY_SOURCE, mathRe: /\\\((.+?)\\\)/g, table: LATEX_MATH, inline: 24,
    other: 'https://nastya-star.github.io/munich-fuel-min/how-it-works.html', options: 'einen Radius von 5, 10 oder 20 Kilometern',
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
    assert.doesNotMatch(visible, /\\(min|in|operatorname|widehat|tau|boxed|sum)|\\_|\\\*|\\\(|\\\[|\\\{|S_f|p_f|t_i|p_i|z_i|z_\d/);
    for (const tex of Object.keys(a.table)) assert.ok(lang === 'en' ? MD.includes(`(${tex})`) : MD.includes(`\\(${tex}\\)`), `table entry used: ${tex}`);
  });

  test(`${lang}: the only centred equation is the boxed objective min sum_{i in S} p_i z_i`, () => {
    assert.equal([...HTML.matchAll(/class="eq"/g)].length, 1);
    const m = /<div class="eq"><span class="box"><math display="block" data-tex="DISPLAY">([\s\S]*?)<\/math><\/span><\/div>/.exec(HTML);
    assert.ok(m);
    assert.equal(m[1], '<mi>min</mi><mspace width="0.1667em"/><munder><mo movablelimits="false">∑</mo><mrow><mi>i</mi><mo>∈</mo><mi>S</mi></mrow></munder>'
      + '<msub><mi>p</mi><mrow><mi>i</mi></mrow></msub><msub><mi>z</mi><mrow><mi>i</mi></mrow></msub>');
  });

  test(`${lang}: symbols and the selection constraint sum z_i = 1 are inline, in section 02.2`, () => {
    const s2 = HTML.slice(HTML.indexOf('<span>02.2</span>'), HTML.indexOf('<span>03</span>'));
    for (const tex of ['S', 'p_i', 'z_i\\in\\{0,1\\}', '\\sum_{i\\in S}z_i=1', 'z_2=1', 'z_3=1']) assert.ok(s2.includes(`<math data-tex="${tex}">`), tex);
    assert.match(s2, /<math data-tex="\\sum_\{i\\in S\}z_i=1"><msub><mo>∑<\/mo><mrow><mi>i<\/mi><mo>∈<\/mo><mi>S<\/mi><\/mrow><\/msub><msub><mi>z<\/mi><mrow><mi>i<\/mi><\/mrow><\/msub><mo>=<\/mo><mn>1<\/mn><\/math>/);
    assert.match(s2, /1,729 €|€1\.729/, 'numerical example preserved');
    assert.ok(MD.includes(a.options), '5/10/20 km option sentence');
    assert.doesNotMatch(MD, /5, 10 (or|oder) 17/);
  });

  test(`${lang}: the closing block is left-aligned (no centring)`, () => {
    assert.match(HTML, /<div class="closing">/);
    assert.doesNotMatch(HTML, /\.closing\{[^}]*text-align:center/);
    assert.doesNotMatch(HTML, /\.(closing|sign)[^{]*\{[^}]*(text-align|margin:0 auto)/);
  });

  test(`${lang}: EN | DE switch at the top right links to the other article version`, () => {
    const top = /<div class="top">(<nav class="nav"[\s\S]*?<\/nav>)(<nav class="lang"[\s\S]*?<\/nav>)<\/div>/.exec(HTML);
    assert.ok(top, 'back links first (left), language switch second (right)');
    const other = lang === 'en' ? 'de' : 'en';
    assert.ok(top[2].includes(`<span aria-current="page" lang="${lang}">`), 'active language highlighted');
    assert.ok(top[2].includes(`<a href="${a.other}" hreflang="${other}" lang="${other}" data-lang="${other}">`), 'links the equivalent page');
    assert.match(HTML, /localStorage\.setItem\("lang"/, 'stores the language preference like the home page');
    assert.match(HTML, /\.top\{display:flex;justify-content:space-between/);
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
    assert.ok(page.includes(`<p class="howto"><a class="btn article" href="${href}">${label}</a></p>`), file);
    assert.ok(page.indexOf('class="howto"') > page.indexOf('id="more"') && page.indexOf('class="howto"') < page.indexOf('<footer>'), file);
    assert.match(page, /\.howto \.btn\.article\{display:flex;width:100%;min-height:calc\(3rem \+ 2px\);padding:\.4rem \.9rem;border:1px solid #fff;background:#fff;color:#000;font:400 1\.15rem/);
    assert.match(page, /\.howto \.btn\.article:focus-visible\{outline:/);
  }
});

test('homepage accordion headings are distinct from the article title; radius options 5/10/20, 20 checked', () => {
  for (const [file, title, old] of [
    ['../docs/index.html', 'Price comparison at a glance', 'How it works'],
    ['../docs/de/index.html', 'Preisvergleich kurz erklärt', 'So funktioniert es'],
  ]) {
    const page = read(file);
    assert.ok(page.includes(`<details><summary>${title}</summary>`), file);
    assert.ok(!page.includes(`<summary>${old}</summary>`), file);
    const radii = [...page.matchAll(/<input type="radio" name="radius" value="(\d+)"( checked)?>/g)].map((m) => m[1] + (m[2] ? '*' : ''));
    assert.deepEqual(radii, ['5', '10', '20*'], file);
  }
});

test('English description is the article subtitle', () => {
  assert.ok(renderArticlePage(read('../content/how-it-works.md'), 'en').includes('<meta name="description" content="A transparent fuel-price comparison system for Munich, designed for accuracy, privacy and reproducibility.">'));
});
