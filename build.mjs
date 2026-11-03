// Generates the static English and German pages (docs/index.html, docs/de/index.html)
// from one template. Run after editing: node build.mjs. Dynamic text lives in docs/app.js.

import { mkdirSync, writeFileSync } from 'node:fs';

const SITE = 'https://nastya-star.github.io/munich-fuel-min/';
const RADII = [5, 10, 17]; // keep in sync with docs/core.js

const T = {
  en: {
    title: 'Munich Fuel Minimum – cheapest Super E5, E10 and Diesel near you',
    description: 'Find the cheapest Super E5, Super E10 and Diesel near any starting point in Germany, with live MTS-K prices from Tankerkönig.',
    sub: 'Find the cheapest fuel near you',
    langNav: 'Language',
    locLabel: 'Starting point',
    locPlaceholder: 'Address, place or postcode',
    locSearch: 'Search',
    geo: 'Use my location',
    radius: 'Radius',
    openOnly: 'Open stations only',
    refresh: 'Refresh',
    fuelNav: 'Fuel type',
    cardHint: 'lowest price',
    bestTitle: 'Best station',
    moreTitle: 'Compare stations',
    listSearch: 'Search stations',
    listSearchPh: 'Name, brand or town',
    sortLabel: 'Sort',
    sortPrice: 'Price (lowest first)',
    sortDist: 'Distance (nearest first)',
    statusLabel: 'Status',
    statusOpen: 'Open',
    statusAll: 'Open and closed',
    statusClosed: 'Closed',
    fuelLabel: 'Fuel',
    colPrice: 'Price',
    colStation: 'Station',
    colDist: 'Distance',
    colStatus: 'Status',
    showMore: 'Show more',
    noscript: 'This page needs JavaScript to request current prices.',
    howTitle: 'How it works',
    how: [
      'Prices for Super E5, Super E10 and Diesel are retrieved from Tankerkönig when you choose a starting point or click Refresh. For all visitors together, at most one new request is made per minute; in between, recent results are reused and labelled with their retrieval time.',
      'The cheapest price is the lowest price in €/L (to a tenth of a cent) among stations in the chosen radius that report a valid price and – unless you untick the filter – are reported as open. All stations with that price are shown.',
      'Distances are straight-line distances from your starting point, not driving distances. Directions open Google Maps from your starting point to the station.',
      'Your starting point is used in your browser only. The server receives it rounded to about 1 km and does not store your exact location.',
    ],
    attribution: 'Price data: <a href="https://www.tankerkoenig.de/" rel="noopener">Tankerkönig</a> (<a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener">CC BY 4.0</a>), based on reports to the Markttransparenzstelle für Kraftstoffe (MTS-K) of the Bundeskartellamt. Address search: <a href="https://nominatim.openstreetmap.org/" rel="noopener">Nominatim</a>, © <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a> contributors.',
    disclaimer: 'No guarantee that prices are current or correct; the price at the pump applies.',
    source: 'Source code on <a href="https://github.com/nastya-star/munich-fuel-min" rel="noopener">GitHub</a>.',
  },
  de: {
    title: 'Munich Fuel Minimum – günstigstes Super E5, E10 und Diesel in Ihrer Nähe',
    description: 'Das günstigste Super E5, Super E10 und Diesel rund um jeden Startpunkt in Deutschland – mit aktuellen MTS-K-Preisen von Tankerkönig.',
    sub: 'Günstig tanken in Ihrer Nähe',
    langNav: 'Sprache',
    locLabel: 'Startpunkt',
    locPlaceholder: 'Adresse, Ort oder PLZ',
    locSearch: 'Suchen',
    geo: 'Meinen Standort verwenden',
    radius: 'Umkreis',
    openOnly: 'Nur geöffnete Tankstellen',
    refresh: 'Aktualisieren',
    fuelNav: 'Kraftstoffart',
    cardHint: 'niedrigster Preis',
    bestTitle: 'Beste Tankstelle',
    moreTitle: 'Tankstellen vergleichen',
    listSearch: 'Tankstellen durchsuchen',
    listSearchPh: 'Name, Marke oder Ort',
    sortLabel: 'Sortierung',
    sortPrice: 'Preis (günstigste zuerst)',
    sortDist: 'Entfernung (nächste zuerst)',
    statusLabel: 'Status',
    statusOpen: 'Geöffnet',
    statusAll: 'Geöffnet und geschlossen',
    statusClosed: 'Geschlossen',
    fuelLabel: 'Kraftstoff',
    colPrice: 'Preis',
    colStation: 'Tankstelle',
    colDist: 'Entfernung',
    colStatus: 'Status',
    showMore: 'Mehr anzeigen',
    noscript: 'Diese Seite benötigt JavaScript, um aktuelle Preise abzufragen.',
    howTitle: 'So funktioniert es',
    how: [
      'Die Preise für Super E5, Super E10 und Diesel werden bei Tankerkönig abgefragt, wenn Sie einen Startpunkt wählen oder auf Aktualisieren klicken. Für alle Besucher zusammen erfolgt höchstens eine neue Abfrage pro Minute; dazwischen werden aktuelle Ergebnisse wiederverwendet und mit ihrem Abrufzeitpunkt gekennzeichnet.',
      'Der günstigste Preis ist der niedrigste Literpreis (auf den Zehntelcent genau) unter den Tankstellen im gewählten Umkreis, die einen gültigen Preis melden und – sofern der Filter aktiv ist – als geöffnet gemeldet sind. Alle Tankstellen mit diesem Preis werden angezeigt.',
      'Entfernungen sind Luftlinie ab Ihrem Startpunkt, keine Fahrstrecken. „Route planen“ öffnet Google Maps von Ihrem Startpunkt zur Tankstelle.',
      'Ihr Startpunkt wird nur in Ihrem Browser verwendet. Der Server erhält ihn auf etwa 1 km gerundet und speichert Ihren genauen Standort nicht.',
    ],
    attribution: 'Preisdaten: <a href="https://www.tankerkoenig.de/" rel="noopener">Tankerkönig</a> (<a href="https://creativecommons.org/licenses/by/4.0/deed.de" rel="noopener">CC BY 4.0</a>), basierend auf Meldungen an die Markttransparenzstelle für Kraftstoffe (MTS-K) des Bundeskartellamts. Adresssuche: <a href="https://nominatim.openstreetmap.org/" rel="noopener">Nominatim</a>, © <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a>-Mitwirkende.',
    disclaimer: 'Keine Gewähr für Aktualität und Richtigkeit; es gilt der Preis an der Zapfsäule.',
    source: 'Quellcode auf <a href="https://github.com/nastya-star/munich-fuel-min" rel="noopener">GitHub</a>.',
  },
};

const CSS = `:root{--bg:#fff;--fg:#0a0a0a;--mute:#5a5a5a;--line:#0a0a0a;--soft:#d9d9d9;--tint:#f3f3f3;--warn:#6b4300;--warnbg:#fff6e0;--err:#8f1a1a;--errbg:#fdecec;--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
@media(prefers-color-scheme:dark){:root{--bg:#0a0a0a;--fg:#f5f5f5;--mute:#a9a9a9;--line:#f5f5f5;--soft:#343434;--tint:#181818;--warn:#ffd48f;--warnbg:#2a2110;--err:#ffb3b3;--errbg:#2c1414}}
*{box-sizing:border-box}
html{background:var(--bg);color-scheme:light dark;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:400 1rem/1.45 var(--sans);-webkit-font-smoothing:antialiased;overflow-x:hidden}
main{max-width:46rem;margin:0 auto;padding:.9rem 1rem 3rem}
a{color:inherit}
button,input,select{font:inherit;color:inherit}
:focus-visible{outline:3px solid var(--fg);outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
/* header */
.head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:1rem}
h1{margin:0;font-size:clamp(1.45rem,5.5vw,2rem);line-height:1.1;letter-spacing:-.015em}
.sub{margin:.2rem 0 0;color:var(--mute);font-size:.95rem}
.lang{display:flex;flex:none;border:1px solid var(--line);border-radius:6px;overflow:hidden;font-size:.8rem;font-weight:700;letter-spacing:.05em}
.lang a,.lang span{display:flex;align-items:center;justify-content:center;min-width:2.6rem;min-height:2.6rem;padding:0 .55rem;text-decoration:none}
.lang [aria-current]{background:var(--fg);color:var(--bg)}
.lang a:hover{background:var(--tint)}
/* location */
.loc{border:1px solid var(--soft);border-radius:10px;padding:.8rem;display:grid;gap:.7rem}
.loc label.l{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mute)}
.loc-row{display:flex;gap:.5rem}
.loc-row input{flex:1;min-width:0;min-height:3rem;padding:0 .8rem;border:1.5px solid var(--line);border-radius:7px;background:var(--bg)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;min-height:3rem;padding:.5rem 1rem;border:1.5px solid var(--line);border-radius:7px;background:var(--bg);font-weight:700;text-decoration:none;cursor:pointer;white-space:nowrap}
.btn:hover{background:var(--tint)}
.btn:active{transform:translateY(1px)}
.btn:disabled{opacity:.5;cursor:default;transform:none}
.btn.dark{background:var(--fg);color:var(--bg)}
.btn.dark:hover{opacity:.88;background:var(--fg)}
.btn.small{min-height:2.6rem;padding:.35rem .8rem;font-size:.9rem}
.btn svg{width:18px;height:18px;flex:none}
.results{list-style:none;margin:0;padding:0;border:1px solid var(--soft);border-radius:7px;overflow:hidden}
.results li+li{border-top:1px solid var(--soft)}
.results button{display:block;width:100%;min-height:2.9rem;padding:.55rem .8rem;border:0;background:var(--bg);text-align:left;cursor:pointer}
.results button:hover,.results button:focus-visible{background:var(--tint)}
.results .hint{padding:.5rem .8rem;color:var(--mute);font-size:.85rem}
.opts{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem 1rem}
.seg{display:inline-flex;border:1.5px solid var(--line);border-radius:7px;overflow:hidden;margin:0;padding:0}
.seg legend{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.seg label{position:relative}
.seg input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}
.seg span{display:flex;align-items:center;min-height:2.6rem;padding:0 .8rem;font-weight:700;font-size:.9rem;border-left:1.5px solid var(--line)}
.seg label:first-of-type span{border-left:0}
.seg input:checked+span{background:var(--fg);color:var(--bg)}
.seg input:focus-visible+span{outline:3px solid var(--fg);outline-offset:-5px}
.check{display:inline-flex;gap:.5rem;align-items:center;min-height:2.6rem;font-weight:600;cursor:pointer}
.check input{width:1.25rem;height:1.25rem;margin:0;accent-color:var(--fg)}
.msg{margin:0;font-size:.9rem}
.msg:empty{display:none}
.msg.err{color:var(--err)}
/* status */
.status{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin:1rem 0 .75rem;font-size:.92rem;min-height:2.6rem}
.status .txt{display:flex;flex-wrap:wrap;gap:.2rem .6rem;align-items:center}
.pill{display:inline-block;padding:.1rem .55rem;border:1px solid var(--soft);border-radius:999px;font-weight:600}
.pill.warn{background:var(--warnbg);color:var(--warn);border-color:currentColor}
.pill.err{background:var(--errbg);color:var(--err);border-color:currentColor}
.note{margin:.25rem 0 .75rem;padding:.6rem .8rem;border-radius:7px;font-size:.9rem;background:var(--warnbg);color:var(--warn);border:1px solid currentColor}
.note.err{background:var(--errbg);color:var(--err)}
.note:empty{display:none}
/* fuel cards */
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem}
.card{display:grid;gap:.15rem;align-content:start;min-height:5.6rem;padding:.7rem .6rem;border:1.5px solid var(--soft);border-radius:10px;background:var(--bg);text-align:left;cursor:pointer}
.card:hover{border-color:var(--line)}
.card[aria-pressed=true]{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.card .k{font-size:.78rem;font-weight:700;letter-spacing:.03em}
.card .p{font-size:clamp(1.25rem,5.6vw,1.75rem);font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.card .p small{font-size:.7rem;font-weight:600}
.card .h{font-size:.72rem;opacity:.75}
/* best station */
h2{margin:1.5rem 0 .6rem;font-size:.8rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--mute)}
.best{border:2px solid var(--line);border-radius:12px;padding:1rem}
.stns{list-style:none;margin:.4rem 0 0;padding:0}
.stns li{display:grid;gap:.45rem;padding:.85rem 0 .2rem}
.stns li+li{border-top:1px solid var(--soft);margin-top:.6rem}
.best .price{font-size:clamp(2.3rem,11vw,3.2rem);font-weight:800;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.03em}
.best .price small{font-size:1rem;font-weight:600;letter-spacing:0}
.best .name{font-size:1.15rem;font-weight:800;margin:0}
.best .meta,.row .meta{color:var(--mute);font-size:.9rem;margin:0}
.badge{display:inline-block;padding:.05rem .5rem;border-radius:999px;border:1px solid currentColor;font-size:.78rem;font-weight:700;vertical-align:1px}
.badge.closed{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.tie{margin:.2rem 0 0;color:var(--mute);font-size:.9rem}
.empty{margin:0;padding:1rem;border:1px dashed var(--soft);border-radius:10px;color:var(--mute)}
/* comparison */
details.more{margin-top:1.5rem;border:1px solid var(--soft);border-radius:10px}
details.more>summary{display:flex;justify-content:space-between;align-items:center;min-height:3rem;padding:.4rem .9rem;font-weight:800;cursor:pointer;list-style:none}
details.more>summary::-webkit-details-marker{display:none}
details.more>summary::after{content:"+";font-size:1.3rem;font-weight:400}
details.more[open]>summary::after{content:"–"}
.more-body{padding:0 .8rem .9rem;display:grid;gap:.7rem}
.filters{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
.filters label{display:grid;gap:.2rem;font-size:.78rem;font-weight:700;color:var(--mute)}
.filters label.wide{grid-column:1/-1}
.filters input,.filters select{min-height:2.75rem;padding:0 .6rem;border:1.5px solid var(--line);border-radius:7px;background:var(--bg);font-size:.95rem;font-weight:400;color:var(--fg)}
.count{margin:0;color:var(--mute);font-size:.88rem}
.list{list-style:none;margin:0;padding:0}
.row{display:grid;grid-template-columns:auto 1fr auto;gap:.15rem .8rem;align-items:center;padding:.65rem 0;border-top:1px solid var(--soft)}
.row .rp{font-weight:800;font-variant-numeric:tabular-nums;font-size:1.05rem;min-width:3.6rem}
.row .who{min-width:0}
.row .who b{display:block;overflow-wrap:anywhere}
.row .meta{overflow-wrap:anywhere}
footer{margin-top:2.5rem;padding-top:1rem;border-top:1px solid var(--soft);font-size:.82rem;color:var(--mute)}
footer p{margin:.45rem 0}
footer details summary{cursor:pointer;font-weight:700;color:var(--fg);min-height:2.4rem;display:flex;align-items:center}
@media(min-width:40rem){main{padding-top:1.4rem}.loc{grid-template-columns:1fr auto;align-items:end}.loc .full{grid-column:1/-1}.filters{grid-template-columns:2fr 1fr 1fr 1fr}.filters label.wide{grid-column:auto}.card{padding:.9rem}.card .k{font-size:.85rem}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}`;

const PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/></svg>';
const REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';

function page(lang) {
  const t = T[lang];
  const self = lang === 'en' ? '' : 'de/';
  const otherHref = lang === 'en' ? 'de/' : '../';
  const base = lang === 'en' ? '' : '../';
  const pref = `<script>(function(){var p;try{p=localStorage.getItem("lang")}catch(e){}if(!p&&"${lang}"==="en"&&/^de\\b/i.test(navigator.language||""))p="de";if(p&&p!=="${lang}")location.replace("${otherHref}"+location.search+location.hash)})()</script>`;
  const sw = (l) =>
    l === lang
      ? `<span aria-current="page" lang="${l}"><span class="sr">${l === 'en' ? 'English' : 'Deutsch'}, </span>${l.toUpperCase()}</span>`
      : `<a href="${otherHref}" hreflang="${l}" lang="${l}" data-lang="${l}"><span class="sr">${l === 'en' ? 'English' : 'Deutsch'}, </span>${l.toUpperCase()}</a>`;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${pref}
<title>${t.title}</title>
<meta name="description" content="${t.description}">
<link rel="canonical" href="${SITE}${self}">
<link rel="alternate" hreflang="en" href="${SITE}">
<link rel="alternate" hreflang="de" href="${SITE}de/">
<link rel="alternate" hreflang="x-default" href="${SITE}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23000'/%3E%3Cpath d='M10 25V9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M9 25h12M12.5 11h5v4h-5zM20 14h1.5a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 0 3 0V12l-3-3' fill='none' stroke='%23fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<link rel="modulepreload" href="${base}core.js">
<style>
${CSS}
</style>
</head>
<body>
<main>
<header class="head">
<div><h1>Munich Fuel Minimum</h1><p class="sub">${t.sub}</p></div>
<nav class="lang" aria-label="${t.langNav}">${sw('en')}${sw('de')}</nav>
</header>

<section class="loc" aria-label="${t.locLabel}">
<form id="loc-form" class="full" role="search" autocomplete="off" novalidate>
<label class="l" for="loc-input">${t.locLabel}</label>
<div class="loc-row"><input id="loc-input" name="q" type="search" enterkeyhint="search" placeholder="${t.locPlaceholder}" value="Marienplatz, München" aria-describedby="loc-msg" aria-controls="loc-results" aria-autocomplete="list"><button type="submit" class="btn dark" id="loc-submit">${t.locSearch}</button></div>
<ul id="loc-results" class="results" hidden></ul>
</form>
<p id="loc-msg" class="msg full" role="status" aria-live="polite"></p>
<div class="opts full">
<button type="button" id="geo" class="btn small">${PIN}${t.geo}</button>
<fieldset class="seg"><legend>${t.radius}</legend>${RADII.map((r) => `<label><input type="radio" name="radius" value="${r}"${r === 17 ? ' checked' : ''}><span>${r} km</span></label>`).join('')}</fieldset>
<label class="check"><input type="checkbox" id="open-only" checked> ${t.openOnly}</label>
</div>
</section>

<div class="status"><div class="txt" id="status" role="status" aria-live="polite"></div><button type="button" id="refresh" class="btn small">${REFRESH}${t.refresh}</button></div>
<noscript><p class="note err">${t.noscript}</p></noscript>
<p id="note" class="note" role="alert"></p>

<div class="cards" role="group" aria-label="${t.fuelNav}">
${['e5', 'e10', 'diesel'].map((f, i) => `<button type="button" class="card" data-fuel="${f}" aria-pressed="${i === 0}"><span class="k">${{ e5: 'Super E5', e10: 'Super E10', diesel: 'Diesel' }[f]}</span><span class="p">–</span><span class="h">${t.cardHint}</span></button>`).join('\n')}
</div>

<h2 id="best-h">${t.bestTitle}</h2>
<section id="best" aria-labelledby="best-h" aria-live="polite"></section>

<details class="more" id="more">
<summary><span id="more-title">${t.moreTitle}</span></summary>
<div class="more-body">
<div class="filters">
<label class="wide" for="list-q">${t.listSearch}<input id="list-q" type="search" placeholder="${t.listSearchPh}"></label>
<label for="list-fuel">${t.fuelLabel}<select id="list-fuel"><option value="e5">Super E5</option><option value="e10">Super E10</option><option value="diesel">Diesel</option></select></label>
<label for="list-sort">${t.sortLabel}<select id="list-sort"><option value="price">${t.sortPrice}</option><option value="dist">${t.sortDist}</option></select></label>
<label for="list-status">${t.statusLabel}<select id="list-status"><option value="open">${t.statusOpen}</option><option value="all">${t.statusAll}</option><option value="closed">${t.statusClosed}</option></select></label>
</div>
<p class="count" id="list-count" aria-live="polite"></p>
<ul class="list" id="list"></ul>
<button type="button" class="btn small" id="show-more" hidden>${t.showMore}</button>
</div>
</details>

<footer>
<details><summary>${t.howTitle}</summary>${t.how.map((p) => `<p>${p}</p>`).join('')}</details>
<p>${t.attribution}</p>
<p>${t.disclaimer} ${t.source}</p>
</footer>
</main>
<script>document.querySelectorAll("[data-lang]").forEach(function(a){a.addEventListener("click",function(){try{localStorage.setItem("lang",a.getAttribute("data-lang"))}catch(e){}})})</script>
<script type="module" src="${base}app.js"></script>
</body>
</html>
`;
}

mkdirSync('docs/de', { recursive: true });
writeFileSync('docs/index.html', page('en'));
writeFileSync('docs/de/index.html', page('de'));
console.log('Built docs/index.html and docs/de/index.html');
