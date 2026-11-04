// Renders the approved articles into static pages:
//   content/how-it-works.md    -> docs/how-it-works.html     (English)
//   content/how-it-works.de.md -> docs/de/how-it-works.html  (German)
//
// The Markdown files are the author's final texts and are stored byte-for-byte (see .gitattributes).
// This renderer changes presentation only: Markdown syntax becomes HTML, and the math becomes native
// MathML from the explicit tables below. The English export lost its LaTeX delimiters ("(t_i)" for
// \(t_i\)); the German file keeps them (\(t_i\)). An expression missing from the tables fails the
// build instead of rendering incorrectly. tests/article.test.mjs checks page text == source text.

const SITE = 'https://nastya-star.github.io/munich-fuel-min/';
const MAIN_SITE = 'https://nastya-star.github.io/anastasiia-stepanenko/';

// ---- MathML -----------------------------------------------------------------------------------

const mi = (x) => `<mi>${x}</mi>`;
const mo = (x) => `<mo>${x}</mo>`;
const paren = (inner) => `<mo stretchy="false">(</mo>${inner}<mo stretchy="false">)</mo>`;
const sub = (base, s) => `<msub>${base}<mrow>${s}</mrow></msub>`;
const if_ = `${mi('i')}${mo(',')}${mi('f')}`;
const T_I = sub(mi('t'), mi('i')); // t_i
const mn = (x) => `<mn>${x}</mn>`;
const P_I = sub(mi('p'), mi('i')); // p_i
const Z_I = sub(mi('z'), mi('i')); // z_i
const I_IN_S = `${mi('i')}${mo('∈')}${mi('S')}`;
const M = {
  i: mi('i'), f: mi('f'), x: mi('x'), r: mi('r'), t: mi('t'), n: mi('n'), tau: mi('τ'), ti: T_I,
  S: mi('S'), pi: P_I,
  zbin: `${Z_I}${mo('∈')}<mo stretchy="false">{</mo>${mn(0)}${mo(',')}${mn(1)}<mo stretchy="false">}</mo>`,
  // inline: limits as a subscript, as LaTeX does in text style
  pick: `<msub><mo>∑</mo><mrow>${I_IN_S}</mrow></msub>${Z_I}${mo('=')}${mn(1)}`,
  z2: `${sub(mi('z'), mn(2))}${mo('=')}${mn(1)}`,
  z3: `${sub(mi('z'), mn(3))}${mo('=')}${mn(1)}`,
  argmin: `<mi mathvariant="normal">arg</mi><mspace width="0.1667em"/><mi mathvariant="normal">min</mi>`,
  on: `${mi('O')}${paren(mi('n'))}`,
  phat: `${sub(`<mover accent="true">${mi('p')}<mo>^</mo></mover>`, if_)}${paren(mi('τ'))}`,
};

/** English source: math written in plain parentheses (delimiters lost on export). */
export const INLINE_MATH = {
  'i': M.i, 'f': M.f, 'x': M.x, 'r': M.r, 't': M.t, 'n': M.n, 't_i': M.ti, '\\tau': M.tau,
  'S': M.S, 'p_i': M.pi, 'z_i\\in\\{0,1\\}': M.zbin, '\\sum_{i\\in S}z_i=1': M.pick, 'z_2=1': M.z2, 'z_3=1': M.z3,
  '\\operatorname\\*{arg,min}': M.argmin, // "," = lost "\," (thin space)
  'O(n)': M.on,
  '\\widehat p\\_{i,f}(\\tau)': M.phat,
};

/** German source: proper \( … \) delimiters. */
export const LATEX_MATH = {
  'i': M.i, 'f': M.f, 'x': M.x, 'r': M.r, 't': M.t, 'n': M.n, 't_i': M.ti, '\\tau': M.tau,
  'S': M.S, 'p_i': M.pi, 'z_i\\in\\{0,1\\}': M.zbin, '\\sum_{i\\in S}z_i=1': M.pick, 'z_2=1': M.z2, 'z_3=1': M.z3,
  '\\operatorname*{arg\\,min}': M.argmin,
  'O(n)': M.on,
  '\\widehat p_{i,f}(\\tau)': M.phat,
};

// The objective in section 02.2, boxed: min sum_{i in S} p_i z_i. Its constraint sum_{i in S} z_i = 1
// is stated inline in the text. Both articles write the block identically.
export const DISPLAY_SOURCE = '\\[\n\\boxed{\\min \\sum_{i\\in S}p_i z_i}\n\\]';
const DISPLAY_MATH = `<mi>min</mi><mspace width="0.1667em"/><munder><mo movablelimits="false">∑</mo><mrow>${I_IN_S}</mrow></munder>${P_I}${Z_I}`;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mathEl = (tex, body, display = false) => `<math${display ? ' display="block"' : ''} data-tex="${esc(tex)}">${body}</math>`;

// ---- inline Markdown ---------------------------------------------------------------------------

/** mode 'parens': math in plain (…) groups (English); mode 'latex': math in \( … \) (German). */
function inline(text, mode) {
  const keep = [];
  const hold = (html) => `\u0000${keep.push(html) - 1}\u0000`;
  let s = text;
  // links first, so their (url) is not mistaken for math
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => hold(`<a href="${esc(url)}"${url.startsWith('http') && !url.startsWith(SITE) ? ' rel="noopener"' : ''}>${esc(label)}</a>`));
  s = s.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${esc(code)}</code>`));
  if (mode === 'latex') {
    s = s.replace(/\\\((.+?)\\\)/g, (_, tex) => {
      if (LATEX_MATH[tex] === undefined) throw new Error(`article.mjs: no MathML for "\\(${tex}\\)" - add it to LATEX_MATH`);
      return hold(mathEl(tex, LATEX_MATH[tex]));
    });
  } else {
    // a parenthesised group (one level of nesting) whose content is in the table
    s = s.replace(/\(((?:[^()]|\([^()]*\))*)\)/g, (_, tex) => {
      if (INLINE_MATH[tex] === undefined) throw new Error(`article.mjs: no MathML for "(${tex})" - add it to INLINE_MATH`);
      return hold(mathEl(tex, INLINE_MATH[tex]));
    });
  }
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]);
}

// ---- blocks ----------------------------------------------------------------------------------------

const HARD_BREAK = /\\\n| {2,}\n/; // Markdown line break: trailing backslash or two spaces

function blocks(md) {
  // A two-space line break sits inside a block, so trimming block ends keeps it.
  return md.replace(/\r\n/g, '\n').trim().split(/\n{2,}/).map((b) => b.trim());
}

/** Returns {title, subtitle, sections:[{num, title, html}], closing:[html]} from the Markdown. */
export function parseArticle(md) {
  const mode = /\\\(/.test(md) ? 'latex' : 'parens';
  let title = '';
  let subtitle = '';
  const sections = [];
  const closing = [];
  let current = null;
  let afterLastRule = false;
  for (const b of blocks(md)) {
    if (b.startsWith('# ')) { title = b.slice(2); continue; }
    if (!sections.length && /^\*[^*].*\*$/.test(b) && !subtitle) { subtitle = inline(b, mode); continue; }
    if (b === '---') { if (current) afterLastRule = true; continue; }
    const h2 = /^## (?:(\d\d) )?(.+)$/.exec(b);
    if (h2) {
      current = { num: h2[1] || '', title: inline(h2[2], mode), html: [] };
      sections.push(current);
      afterLastRule = false;
      continue;
    }
    // Everything after the final rule that follows the last section is the closing note.
    const target = afterLastRule ? closing : current.html;
    const h3 = /^### (\d\d\.\d) (.+)$/.exec(b);
    if (h3) { target.push(`<h3><span>${h3[1]}</span> ${inline(h3[2], mode)}</h3>`); continue; }
    if (b === DISPLAY_SOURCE) { target.push(`<div class="eq"><span class="box">${mathEl('DISPLAY', DISPLAY_MATH, true)}</span></div>`); continue; }
    if (HARD_BREAK.test(b)) { target.push(`<p class="sign">${b.split(HARD_BREAK).map((l) => inline(l, mode)).join('<br>')}</p>`); continue; }
    target.push(`<p>${inline(b, mode)}</p>`);
  }
  if (!title || !sections.length) throw new Error('article.mjs: unexpected article structure');
  return { title, subtitle, sections, closing };
}

const CSS = `:root{--bg:#111111;--fg:#F5F3EE;--mute:#B9B5AC;--line:rgba(245,243,238,.75);--soft:rgba(245,243,238,.35);--faint:rgba(245,243,238,.16);--tile:#181818;--serif:Georgia,"Times New Roman",Times,serif;--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--r:6px}
*{box-sizing:border-box}
html{background:var(--bg);color-scheme:dark;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:400 1rem/1.65 var(--sans);-webkit-font-smoothing:antialiased;overflow-x:hidden}
main{max-width:44rem;margin:0 auto;padding:1rem 1.1rem 3rem}
a{color:inherit;text-decoration-color:var(--soft);text-underline-offset:3px}
a:hover{text-decoration-color:currentColor}
:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:.75rem 1rem}
.top .nav{flex:1 1 auto;min-width:0}
.nav{display:flex;flex-wrap:wrap;gap:.2rem 1.4rem}
/* EN | DE switch, as on the fuel-price pages */
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.lang{display:inline-flex;align-items:stretch;border:1px solid var(--soft);border-radius:var(--r);font-size:.85rem;font-weight:600;letter-spacing:.06em;flex:none}
.lang>a,.lang>span{display:flex;align-items:center;justify-content:center;width:3rem;min-height:2.75rem;color:var(--mute);text-decoration:none}
.lang>:first-child{border-radius:5px 0 0 5px}
.lang>:last-child{border-radius:0 5px 5px 0}
.lang a:hover{color:var(--fg);background:rgba(245,243,238,.08)}
.lang [aria-current]{color:var(--bg);background:var(--fg)}
.lang>.sep{width:1px;min-height:0;background:var(--soft)}
.nav a{display:inline-flex;align-items:center;min-height:2.75rem;color:var(--mute);text-decoration:none;font-size:.92rem}
.nav a:hover{color:var(--fg);text-decoration:underline;text-underline-offset:3px}
.nav.bottom{margin-top:2rem;padding-top:1rem;border-top:1px solid var(--faint)}
header{text-align:center;margin:2rem 0 2.2rem}
h1{margin:0 0 .6rem;font:400 clamp(2rem,7vw,2.75rem)/1.12 var(--serif);letter-spacing:.005em}
.sub{margin:0 auto;max-width:34rem;color:var(--mute)}
.card{border:1px solid var(--faint);border-radius:var(--r);padding:1.35rem 1.25rem;margin-bottom:1rem}
.card.end{background:var(--tile)}
h2{margin:0 0 .9rem;font:400 1.45rem/1.25 var(--serif);display:flex;gap:.65rem;align-items:baseline}
h2 span,h3 span{color:var(--mute);font:600 .85rem var(--sans);font-variant-numeric:tabular-nums;letter-spacing:.06em}
h3{margin:1.5rem 0 .45rem;font:400 1.12rem/1.3 var(--serif)}
h3 span{margin-right:.15rem}
p{margin:0 0 .9rem}
.card p:last-child{margin-bottom:0}
strong{font-weight:600}
code{font-family:ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace;font-size:.9em;padding:.05em .3em;border:1px solid var(--faint);border-radius:4px}
/* maths: native MathML */
math{font-family:"Cambria Math","STIX Two Math","Latin Modern Math",math;font-size:1.06em}
.eq{margin:1.1rem 0 1.2rem;padding:1.1rem .8rem;text-align:center;overflow-x:auto;background:var(--tile);border-radius:var(--r)}
/* The box is drawn on a wrapper: changing the CSS display of <math> itself breaks MathML layout. */
.eq .box{display:inline-block;padding:.4em .8em;border:1px solid var(--line);border-radius:var(--r)}
.eq math{font-size:1.5em}
hr{border:0;border-top:1px solid var(--faint);margin:2rem 0 1.6rem}
.closing p{margin-bottom:1rem}
.sign{line-height:1.5}
@media(max-width:30rem){.top .nav{flex-direction:column;gap:0}.nav a{min-height:2.5rem}.card{padding:1.1rem .95rem}.eq .box{padding:.35em .5em}.eq math{font-size:1.2em}}`;

const PAGES = {
  en: {
    path: 'how-it-works.html',
    nav: [[MAIN_SITE, '← Back to my website'], [SITE, '← Back to fuel minimisation']],
    navLabel: ['Back navigation', 'Back navigation (end of article)'],
  },
  de: {
    path: 'de/how-it-works.html',
    nav: [[`${MAIN_SITE}de/`, '← Zurück zur Hauptwebsite'], [`${SITE}de/`, '← Zurück zu Munich Fuel Minimum']],
    navLabel: ['Zurück-Navigation', 'Zurück-Navigation (Ende des Artikels)'],
  },
};

/** EN | DE switch linking the two article versions; a click stores the preference like the home page does. */
function langSwitch(lang) {
  const sw = (l) =>
    l === lang
      ? `<span aria-current="page" lang="${l}"><span class="sr">${l === 'en' ? 'English' : 'Deutsch'}, </span>${l.toUpperCase()}</span>`
      : `<a href="${SITE}${PAGES[l].path}" hreflang="${l}" lang="${l}" data-lang="${l}"><span class="sr">${l === 'en' ? 'English' : 'Deutsch'}, </span>${l.toUpperCase()}</a>`;
  return `<nav class="lang" aria-label="${lang === 'en' ? 'Language' : 'Sprache'}">${sw('en')}<span class="sep" aria-hidden="true"></span>${sw('de')}</nav>`;
}

function nav(lang, where) {
  const p = PAGES[lang];
  return `<nav class="nav${where === 'bottom' ? ' bottom' : ''}" aria-label="${p.navLabel[where === 'top' ? 0 : 1]}" data-chrome>${p.nav.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}</nav>`;
}

export function renderArticlePage(md, lang = 'en') {
  const a = parseArticle(md);
  const plain = (html) => html.replace(/<[^>]+>/g, '');
  const description = a.subtitle ? plain(a.subtitle) : `${a.title} – Munich Fuel Minimum`;
  const sec = a.sections
    .map((s, i) => {
      const id = `s${i + 1}`;
      const end = s.num ? '' : ' end';
      return `<section class="card${end}" aria-labelledby="${id}">\n<h2 id="${id}">${s.num ? `<span>${s.num}</span> ` : ''}${s.title}</h2>\n${s.html.join('\n')}\n</section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(a.title)} · Munich Fuel Minimum</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#111111">
<meta name="color-scheme" content="dark">
<link rel="canonical" href="${SITE}${PAGES[lang].path}">
<link rel="alternate" hreflang="en" href="${SITE}${PAGES.en.path}">
<link rel="alternate" hreflang="de" href="${SITE}${PAGES.de.path}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23111'/%3E%3Cpath d='M10 25V9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M9 25h12M12.5 11h5v4h-5zM20 14h1.5a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 0 3 0V12l-3-3' fill='none' stroke='%23F5F3EE' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<style>
${CSS}
</style>
</head>
<body>
<main>
<div class="top">${nav(lang, 'top')}${langSwitch(lang)}</div>
<article>
<header>
<h1>${esc(a.title)}</h1>
${a.subtitle ? `<p class="sub">${a.subtitle}</p>\n` : ''}</header>
${sec}
<hr>
<div class="closing">
${a.closing.join('\n')}
</div>
</article>
${nav(lang, 'bottom')}
</main>
<script>document.querySelectorAll("[data-lang]").forEach(function(a){a.addEventListener("click",function(){try{localStorage.setItem("lang",a.getAttribute("data-lang"))}catch(e){}})})</script>
</body>
</html>
`;
}
