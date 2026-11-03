// Renders the approved article content/how-it-works.md into docs/how-it-works.html.
//
// The Markdown file is the author's final text and is stored byte-for-byte (see .gitattributes).
// This renderer changes presentation only: Markdown syntax becomes HTML, and the math (whose
// LaTeX delimiters were lost on export, e.g. "(t_i)" for \(t_i\)) becomes native MathML from the
// explicit table below. An expression missing from the table fails the build instead of
// rendering incorrectly. tests/article.test.mjs checks that the page text equals the source text.

const SITE = 'https://nastya-star.github.io/munich-fuel-min/';
const MAIN_SITE = 'https://nastya-star.github.io/anastasiia-stepanenko/';

// ---- MathML -----------------------------------------------------------------------------------

const mi = (x) => `<mi>${x}</mi>`;
const mo = (x) => `<mo>${x}</mo>`;
const paren = (inner) => `<mo stretchy="false">(</mo>${inner}<mo stretchy="false">)</mo>`;
const sub = (base, s) => `<msub>${base}<mrow>${s}</mrow></msub>`;
const args = (...xs) => xs.map(mi).join(mo(','));
const if_ = `${mi('i')}${mo(',')}${mi('f')}`;
const P_IF = sub(mi('p'), if_); // p_{i,f}
const T_I = sub(mi('t'), mi('i')); // t_i
const S_F = `${sub(mi('S'), mi('f'))}${paren(args('x', 'r', 't'))}`; // S_f(x,r,t)
const P_STAR = `<msubsup>${mi('p')}${mi('f')}<mo>*</mo></msubsup>${paren(args('x', 'r', 't'))}`; // p_f^*(x,r,t)

/** Source expression (as written in the Markdown) -> MathML content. */
export const INLINE_MATH = {
  'i': mi('i'),
  'f': mi('f'),
  'x': mi('x'),
  'r': mi('r'),
  't': mi('t'),
  'n': mi('n'),
  't_i': T_I,
  '\\tau': mi('τ'),
  'p\\_{i,f}(t_i)': `${P_IF}${paren(T_I)}`,
  'S_f(x,r,t)': S_F,
  'p_f^\\*(x,r,t)': P_STAR,
  '\\operatorname\\*{arg,min}': `<mi mathvariant="normal">arg</mi><mspace width="0.1667em"/><mi mathvariant="normal">min</mi>`, // "," = lost "\," (thin space)
  'O(n)': `${mi('O')}${paren(mi('n'))}`,
  '\\widehat p\\_{i,f}(\\tau)': `${sub(`<mover accent="true">${mi('p')}<mo>^</mo></mover>`, if_)}${paren(mi('τ'))}`,
};

// The objective in section 02.2. Its export lost the opening "\[\boxed{p_f^*(x,r,t) =" (only the
// closing "}" and "]" survived); the left-hand side is the quantity the next paragraph defines.
export const DISPLAY_SOURCE = '\\min\\_{i\\in S_f(x,r,t)}\\\np\\_{i,f}(t_i)\\\n}\\\n]';
const DISPLAY_MATH = `${P_STAR}${mo('=')}<munder><mo movablelimits="false">min</mo><mrow>${mi('i')}${mo('∈')}${S_F}</mrow></munder>${P_IF}${paren(T_I)}`;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mathEl = (tex, body, display = false) => `<math${display ? ' display="block"' : ''} data-tex="${esc(tex)}">${body}</math>`;

// ---- inline Markdown ---------------------------------------------------------------------------

function inline(text) {
  const keep = [];
  const hold = (html) => `\u0000${keep.push(html) - 1}\u0000`;
  let s = text;
  // links first, so their (url) is not mistaken for math
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => hold(`<a href="${esc(url)}"${url.startsWith('http') && !url.startsWith(SITE) ? ' rel="noopener"' : ''}>${esc(label)}</a>`));
  s = s.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${esc(code)}</code>`));
  // math: a parenthesised group (one level of nesting) whose content is in the table
  s = s.replace(/\(((?:[^()]|\([^()]*\))*)\)/g, (m, tex) => {
    if (INLINE_MATH[tex] === undefined) throw new Error(`article.mjs: no MathML for "(${tex})" - add it to INLINE_MATH`);
    return hold(mathEl(tex, INLINE_MATH[tex]));
  });
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]);
}

// ---- blocks ----------------------------------------------------------------------------------------

function blocks(md) {
  return md.replace(/\r\n/g, '\n').trim().split(/\n{2,}/).map((b) => b.trim());
}

/** Returns {title, subtitle, sections:[{num, title, html}], closing:html} from the Markdown. */
export function parseArticle(md) {
  let title = '';
  let subtitle = '';
  const sections = [];
  const closing = [];
  let current = null;
  let afterLastRule = false;
  for (const b of blocks(md)) {
    if (b.startsWith('# ')) { title = b.slice(2); continue; }
    if (!sections.length && /^\*[^*].*\*$/.test(b) && !subtitle) { subtitle = inline(b); continue; }
    if (b === '---') { if (current) afterLastRule = true; continue; }
    const h2 = /^## (?:(\d\d) )?(.+)$/.exec(b);
    if (h2) {
      current = { num: h2[1] || '', title: h2[2], html: [] };
      sections.push(current);
      afterLastRule = false;
      continue;
    }
    // Everything after the final rule that follows the last section is the closing note.
    const target = afterLastRule ? closing : current.html;
    const h3 = /^### (\d\d\.\d) (.+)$/.exec(b);
    if (h3) { target.push(`<h3><span>${h3[1]}</span> ${inline(h3[2])}</h3>`); continue; }
    if (b === DISPLAY_SOURCE) { target.push(`<div class="eq"><span class="box">${mathEl('DISPLAY', DISPLAY_MATH, true)}</span></div>`); continue; }
    if (b.includes('\\\n')) { target.push(`<p class="sign">${b.split('\\\n').map(inline).join('<br>')}</p>`); continue; }
    target.push(`<p>${inline(b)}</p>`);
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
.nav{display:flex;flex-wrap:wrap;gap:.2rem 1.4rem}
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
.closing{text-align:center;padding:0 .5rem}
.closing p{margin-bottom:1rem}
.sign{line-height:1.5}
@media(max-width:30rem){.card{padding:1.1rem .95rem}.eq .box{padding:.35em .5em}.eq math{font-size:1.2em}}`;

function nav(where) {
  return `<nav class="nav${where === 'bottom' ? ' bottom' : ''}" aria-label="${where === 'top' ? 'Back navigation' : 'Back navigation (end of article)'}" data-chrome><a href="${MAIN_SITE}">← Back to my website</a><a href="${SITE}">← Back to fuel minimisation</a></nav>`;
}

export function renderArticlePage(md) {
  const a = parseArticle(md);
  const plain = (html) => html.replace(/<[^>]+>/g, '');
  const sec = a.sections
    .map((s, i) => {
      const id = `s${i + 1}`;
      const end = s.num ? '' : ' end';
      return `<section class="card${end}" aria-labelledby="${id}">\n<h2 id="${id}">${s.num ? `<span>${s.num}</span> ` : ''}${inline(s.title)}</h2>\n${s.html.join('\n')}\n</section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(a.title)} · Munich Fuel Minimum</title>
<meta name="description" content="${esc(plain(a.subtitle))}">
<meta name="theme-color" content="#111111">
<meta name="color-scheme" content="dark">
<link rel="canonical" href="${SITE}how-it-works.html">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23111'/%3E%3Cpath d='M10 25V9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M9 25h12M12.5 11h5v4h-5zM20 14h1.5a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 0 3 0V12l-3-3' fill='none' stroke='%23F5F3EE' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<style>
${CSS}
</style>
</head>
<body>
<main>
${nav('top')}
<article>
<header>
<h1>${esc(a.title)}</h1>
<p class="sub">${a.subtitle}</p>
</header>
${sec}
<hr>
<div class="closing">
${a.closing.join('\n')}
</div>
</article>
${nav('bottom')}
</main>
</body>
</html>
`;
}
