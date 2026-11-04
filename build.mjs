// Generates the static English and German pages (docs/index.html, docs/de/index.html)
// from one template. Run after editing: node build.mjs. Dynamic text lives in docs/app.js.
// Visual identity follows https://nastya-star.github.io/anastasiia-stepanenko/ (same tokens).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { renderArticlePage } from './article.mjs';

const SITE = 'https://nastya-star.github.io/munich-fuel-min/';
const RADII = [5, 10, 20]; // keep in sync with docs/core.js
const DEFAULT_RADIUS = 20;

const T = {
  en: {
    title: 'Munich Fuel Minimum – cheapest Super E5, E10 and Diesel near you',
    description: 'Find the cheapest Super E5, Super E10 and Diesel near any starting point in Germany, with live MTS-K prices from Tankerkönig, on a map.',
    back: '← Back to my website',
    backHref: 'https://nastya-star.github.io/anastasiia-stepanenko/',
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
    mapLabel: 'Map of petrol stations, coloured by price for the selected fuel',
    legendTitle: 'Price colours',
    legendNone: 'no price',
    detailTitle: 'Best station',
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
    showMore: 'Show more',
    howBtn: 'How does it work?',
    howPath: 'how-it-works.html',
    noscript: 'This page needs JavaScript to request current prices.',
    howTitle: 'Price comparison at a glance',
    how: [
      'Prices for Super E5, Super E10 and Diesel are retrieved from Tankerkönig when you open the page, choose a starting point or click Refresh. For all visitors together, at most one new request is made per minute; in between, recent results are reused and labelled with their retrieval time. Moving or zooming the map and switching fuel never request new data.',
      'The cheapest price is the lowest price in €/L (to a tenth of a cent) among stations in the chosen radius that report a valid price and – unless you untick the filter – are reported as open. All stations with that price are shown and marked green with a check mark on the map. Every higher price is coloured from yellow (next cheapest) to red (most expensive) by its rank among the prices present; stations without a price for the fuel are grey. If the data for your area is incomplete, nothing is marked green.',
      'Distances are straight-line distances from your starting point, not driving distances. Directions opens Google Maps from your starting point to the station.',
      'Your starting point is used in your browser only. The server receives it rounded to about 1 km and does not store your exact location.',
    ],
    attribution: 'Price data: <a href="https://www.tankerkoenig.de/" rel="noopener">Tankerkönig</a> (<a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener">CC BY 4.0</a>), based on reports to the Markttransparenzstelle für Kraftstoffe (MTS-K) of the Bundeskartellamt. Map and address search: © <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a> contributors (tiles darkened for display), <a href="https://nominatim.openstreetmap.org/" rel="noopener">Nominatim</a>, <a href="https://leafletjs.com/" rel="noopener">Leaflet</a>.',
    disclaimer: 'No guarantee that prices are current or correct; the price at the pump applies.',
    source: 'Source code on <a href="https://github.com/nastya-star/munich-fuel-min" rel="noopener">GitHub</a>.',
  },
  de: {
    title: 'Munich Fuel Minimum – günstigstes Super E5, E10 und Diesel in Ihrer Nähe',
    description: 'Das günstigste Super E5, Super E10 und Diesel rund um jeden Startpunkt in Deutschland – mit aktuellen MTS-K-Preisen von Tankerkönig, auf einer Karte.',
    back: '← Zurück zur Hauptwebsite',
    backHref: 'https://nastya-star.github.io/anastasiia-stepanenko/de/',
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
    mapLabel: 'Karte der Tankstellen, nach Preis für den gewählten Kraftstoff eingefärbt',
    legendTitle: 'Preisfarben',
    legendNone: 'kein Preis',
    detailTitle: 'Beste Tankstelle',
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
    showMore: 'Mehr anzeigen',
    howBtn: 'Wie funktioniert es?',
    howPath: 'de/how-it-works.html',
    noscript: 'Diese Seite benötigt JavaScript, um aktuelle Preise abzufragen.',
    howTitle: 'Preisvergleich kurz erklärt',
    how: [
      'Die Preise für Super E5, Super E10 und Diesel werden bei Tankerkönig abgefragt, wenn Sie die Seite öffnen, einen Startpunkt wählen oder auf Aktualisieren klicken. Für alle Besucher zusammen erfolgt höchstens eine neue Abfrage pro Minute; dazwischen werden aktuelle Ergebnisse wiederverwendet und mit ihrem Abrufzeitpunkt gekennzeichnet. Verschieben oder Zoomen der Karte und der Wechsel des Kraftstoffs lösen nie eine neue Abfrage aus.',
      'Der günstigste Preis ist der niedrigste Literpreis (auf den Zehntelcent genau) unter den Tankstellen im gewählten Umkreis, die einen gültigen Preis melden und – sofern der Filter aktiv ist – als geöffnet gemeldet sind. Alle Tankstellen mit diesem Preis werden angezeigt und auf der Karte grün mit Häkchen markiert. Jeder höhere Preis wird nach seinem Rang unter den vorhandenen Preisen von Gelb (nächstgünstiger) bis Rot (teuerster) eingefärbt; Tankstellen ohne Preis für den Kraftstoff sind grau. Sind die Daten für Ihr Gebiet unvollständig, wird nichts grün markiert.',
      'Entfernungen sind Luftlinie ab Ihrem Startpunkt, keine Fahrstrecken. „Route planen“ öffnet Google Maps von Ihrem Startpunkt zur Tankstelle.',
      'Ihr Startpunkt wird nur in Ihrem Browser verwendet. Der Server erhält ihn auf etwa 1 km gerundet und speichert Ihren genauen Standort nicht.',
    ],
    attribution: 'Preisdaten: <a href="https://www.tankerkoenig.de/" rel="noopener">Tankerkönig</a> (<a href="https://creativecommons.org/licenses/by/4.0/deed.de" rel="noopener">CC BY 4.0</a>), basierend auf Meldungen an die Markttransparenzstelle für Kraftstoffe (MTS-K) des Bundeskartellamts. Karte und Adresssuche: © <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a>-Mitwirkende (Kacheln für die Darstellung abgedunkelt), <a href="https://nominatim.openstreetmap.org/" rel="noopener">Nominatim</a>, <a href="https://leafletjs.com/" rel="noopener">Leaflet</a>.',
    disclaimer: 'Keine Gewähr für Aktualität und Richtigkeit; es gilt der Preis an der Zapfsäule.',
    source: 'Quellcode auf <a href="https://github.com/nastya-star/munich-fuel-min" rel="noopener">GitHub</a>.',
  },
};

// Tokens shared with the business-card site (anastasiia-stepanenko/build.mjs). Price colours
// (green/yellow/orange/red) appear only on map markers and the legend; amber/red only for warnings/errors.
const CSS = `:root{--bg:#111111;--fg:#F5F3EE;--mute:#B9B5AC;--line:rgba(245,243,238,.75);--soft:rgba(245,243,238,.35);--faint:rgba(245,243,238,.18);--hover:rgba(245,243,238,.08);--press:rgba(245,243,238,.16);--warn:#F2C46D;--err:#ffb4a8;--serif:Georgia,"Times New Roman",Times,serif;--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--r:6px}
*{box-sizing:border-box}
html{background:var(--bg);color-scheme:dark;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:400 1rem/1.5 var(--sans);-webkit-font-smoothing:antialiased;overflow-x:hidden}
main{max-width:72rem;margin:0 auto;padding:.9rem 1.1rem 3rem}
a{color:inherit}
button,input,select{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
/* header */
.topbar{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1.25rem}
.back{display:inline-flex;align-items:center;min-height:2.75rem;color:var(--mute);text-decoration:none;font-size:.92rem}
.back:hover{color:var(--fg);text-decoration:underline;text-underline-offset:3px}
.lang{display:inline-flex;align-items:stretch;border:1px solid var(--soft);border-radius:var(--r);font-size:.85rem;font-weight:600;letter-spacing:.06em;flex:none}
.lang>a,.lang>span{display:flex;align-items:center;justify-content:center;width:3rem;min-height:2.75rem;color:var(--mute);text-decoration:none}
.lang>:first-child{border-radius:5px 0 0 5px}
.lang>:last-child{border-radius:0 5px 5px 0}
.lang a:hover{color:var(--fg);background:var(--hover)}
.lang [aria-current]{color:var(--bg);background:var(--fg)}
.lang>.sep{width:1px;min-height:0;background:var(--soft)}
h1{margin:0;font:400 clamp(1.9rem,6vw,2.6rem)/1.1 var(--serif);letter-spacing:.01em}
.sub{margin:.35rem 0 1.4rem;color:var(--mute)}
h2{margin:0 0 .7rem;font:400 1.3rem/1.2 var(--serif)}
/* location */
.loc{border:1px solid var(--faint);border-radius:var(--r);padding:.9rem;display:grid;gap:.75rem}
.loc label.l{font-size:.8rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.loc-row{display:flex;gap:.5rem;margin-top:.35rem}
input[type=search],select{min-height:2.9rem;padding:0 .8rem;border:1px solid var(--line);border-radius:var(--r);background:#0b0b0b;color:var(--fg)}
input::placeholder{color:#8f8b83}
.loc-row input{flex:1;min-width:0}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;min-height:2.9rem;padding:.5rem 1rem;border:1px solid var(--line);border-radius:var(--r);background:var(--bg);color:var(--fg);font-weight:600;text-decoration:none;cursor:pointer;white-space:nowrap;transition:background-color .15s,border-color .15s}
.btn:hover{background:var(--hover);border-color:var(--fg)}
.btn:active{background:var(--press)}
.btn:disabled{opacity:.45;cursor:default}
.btn.solid{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.btn.solid:hover{background:#fff}
.btn.solid:active{background:#dcd8cf}
.btn.small{min-height:2.6rem;padding:.35rem .8rem;font-size:.9rem}
.btn svg{width:18px;height:18px;flex:none}
.results{list-style:none;margin:.4rem 0 0;padding:0;border:1px solid var(--soft);border-radius:var(--r);overflow:hidden}
.results li+li{border-top:1px solid var(--faint)}
.results button{display:block;width:100%;min-height:2.9rem;padding:.55rem .8rem;border:0;background:var(--bg);text-align:left;cursor:pointer}
.results button:hover,.results button:focus-visible{background:var(--hover)}
.results .hint{padding:.5rem .8rem;color:var(--mute);font-size:.85rem}
.opts{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem 1rem}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:var(--r);margin:0;padding:0}
.seg legend{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.seg label{position:relative}
.seg input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}
.seg span{display:flex;align-items:center;min-height:2.6rem;padding:0 .85rem;font-weight:600;font-size:.9rem;border-left:1px solid var(--soft)}
.seg label:first-of-type span{border-left:0;border-radius:5px 0 0 5px}
.seg label:last-of-type span{border-radius:0 5px 5px 0}
.seg input:checked+span{background:var(--fg);color:var(--bg)}
.seg input:focus-visible+span{outline:2px solid var(--fg);outline-offset:2px}
.check{display:inline-flex;gap:.55rem;align-items:center;min-height:2.6rem;cursor:pointer}
.check input{width:1.2rem;height:1.2rem;margin:0;accent-color:var(--fg)}
.msg{margin:0;font-size:.9rem;color:var(--mute)}
.msg:empty{display:none}
.msg.err{color:var(--err)}
/* status */
.status{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin:1rem 0 .75rem;font-size:.9rem;min-height:2.6rem}
.status .txt{display:flex;flex-wrap:wrap;gap:.25rem .6rem;align-items:center;color:var(--mute)}
.pill{display:inline-block;padding:.1rem .6rem;border:1px solid var(--soft);border-radius:999px;color:var(--fg)}
.pill.warn{color:var(--warn);border-color:var(--warn)}
.note{margin:.25rem 0 .9rem;padding:.65rem .85rem;border:1px solid var(--warn);border-radius:var(--r);color:var(--warn);font-size:.9rem}
.note.err{border-color:var(--err);color:var(--err)}
.note:empty{display:none}
/* fuel cards */
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:.55rem}
.card{display:grid;gap:.15rem;align-content:start;min-height:5.4rem;padding:.75rem .7rem;border:1px solid var(--soft);border-radius:var(--r);background:var(--bg);text-align:left;cursor:pointer;transition:background-color .15s,border-color .15s}
.card:hover{border-color:var(--fg);background:var(--hover)}
.card[aria-pressed=true]{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.card .k{font-size:.8rem;font-weight:600;letter-spacing:.03em}
.card .p{font-size:clamp(1.2rem,5.4vw,1.7rem);font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.card .p small{font-size:.7rem;font-weight:600}
.card .h{font-size:.74rem;opacity:.75}
/* map + details */
.mapwrap{display:grid;gap:1rem;margin-top:1rem}
.mapbox{position:relative}
#map{height:clamp(18rem,58vh,26rem);border:1px solid var(--soft);border-radius:var(--r);background:#1a1a1a;z-index:0}
.legend{display:flex;flex-wrap:wrap;align-items:center;gap:.35rem .9rem;margin:.5rem 0 0;font-size:.82rem;color:var(--mute)}
.legend .it{display:inline-flex;align-items:center;gap:.4rem}
.legend .grad{display:inline-block;width:4.5rem;height:.6rem;border-radius:999px;background:linear-gradient(90deg,#FACC15,#F97316,#EF4444)}
.legend:empty{display:none}
.mk{display:block;width:100%;height:100%;border-radius:50%;background:var(--c);border:2px solid #111;box-shadow:0 0 0 1px rgba(0,0,0,.35)}
.mk.min{border:3px solid #fff;box-shadow:0 0 0 2px #111;display:flex;align-items:center;justify-content:center;color:#0b2e17;font:700 12px/1 var(--sans)}
.mk.none{opacity:.85}
.mk.sel{outline:3px solid #fff;outline-offset:2px}
.mk.origin{background:#fff;border:3px solid #111;box-shadow:0 0 0 2px #fff}
.legend .mk{display:inline-block;width:14px;height:14px}
.legend .mk.min{width:18px;height:18px;font-size:10px}
.detail h2{display:flex;justify-content:space-between;align-items:baseline;gap:.5rem}
.best{border:1px solid var(--line);border-radius:var(--r);padding:1rem}
.best .price{font:400 clamp(2.2rem,10vw,3rem)/1 var(--serif);font-variant-numeric:tabular-nums}
.best .price small{font:600 .95rem var(--sans);color:var(--mute)}
.stns{list-style:none;margin:.3rem 0 0;padding:0}
.stns li{display:grid;gap:.4rem;padding:.8rem 0 .15rem}
.stns li+li{border-top:1px solid var(--faint);margin-top:.6rem}
.name{margin:0;font-weight:700;font-size:1.08rem}
.meta{margin:0;color:var(--mute);font-size:.9rem;overflow-wrap:anywhere}
.badge{display:inline-block;padding:0 .5rem;border:1px solid var(--soft);border-radius:999px;font-size:.78rem;font-weight:600;color:var(--fg)}
.badge.closed{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.tie,.sel-note{margin:.35rem 0 0;color:var(--mute);font-size:.9rem}
.best .fuel{margin:0 0 .3rem;font-size:.8rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.best.sel .price{font-size:clamp(2rem,9vw,2.7rem)}
.gap{margin:.45rem 0 0;font-size:.95rem;color:var(--fg)}
.gap.lowest{display:inline-flex;align-items:center;gap:.4rem;padding:.1rem .6rem;border:1px solid var(--soft);border-radius:999px;font-weight:600}
.gap.lowest::before{content:"✓";font-weight:700}
.best .acts{display:grid;gap:.55rem;margin-top:.9rem}
#best-h:focus{outline:none}
#best-h:focus-visible{outline:2px solid var(--fg);outline-offset:4px}
.empty{margin:0;padding:1rem;border:1px dashed var(--soft);border-radius:var(--r);color:var(--mute)}
.linkbtn{background:none;border:0;padding:.3rem 0;color:var(--mute);text-decoration:underline;text-underline-offset:3px;cursor:pointer;font-size:.88rem;min-height:2.4rem}
.linkbtn:hover{color:var(--fg)}
/* comparison */
/* Link to the article: white primary button, same footprint as the 'Compare stations' accordion bar */
.howto{margin:1.5rem 0 0}
.howto .btn.article{display:flex;width:100%;min-height:calc(3rem + 2px);padding:.4rem .9rem;border:1px solid #fff;background:#fff;color:#000;font:400 1.15rem/1.25 var(--serif);white-space:normal;text-align:center}
.howto .btn.article:hover{background:#e6e3dc;border-color:#e6e3dc}
.howto .btn.article:active{background:#d6d2c8}
.howto .btn.article:focus-visible{outline:2px solid var(--fg);outline-offset:3px}
details.more{margin-top:1.5rem;border:1px solid var(--soft);border-radius:var(--r)}
details.more>summary{display:flex;justify-content:space-between;align-items:center;min-height:3rem;padding:.4rem .9rem;font:400 1.15rem var(--serif);cursor:pointer;list-style:none}
details.more>summary::-webkit-details-marker{display:none}
details.more>summary::after{content:"+";font:300 1.4rem var(--sans)}
details.more[open]>summary::after{content:"–"}
.more-body{padding:0 .85rem .9rem;display:grid;gap:.7rem}
.filters{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
.filters label{display:grid;gap:.25rem;font-size:.78rem;font-weight:600;color:var(--mute)}
.filters label.wide{grid-column:1/-1}
.filters input,.filters select{font-size:.95rem;font-weight:400}
.count{margin:0;color:var(--mute);font-size:.88rem}
.list{list-style:none;margin:0;padding:0}
.row{display:grid;grid-template-columns:auto 1fr;gap:.2rem .85rem;align-items:start;padding:.75rem 0;border-top:1px solid var(--faint)}
.row.on{background:var(--hover)}
.row .rp{display:flex;align-items:center;gap:.45rem;font-weight:700;font-variant-numeric:tabular-nums;font-size:1.05rem;min-width:4.6rem;padding-top:.1rem}
.row .rp .dot{width:.7rem;height:.7rem;border-radius:50%;background:var(--c);flex:none}
.row .who{min-width:0}
.row .who b{display:block;overflow-wrap:anywhere}
.row .acts{grid-column:2;display:flex;flex-wrap:wrap;gap:.45rem;margin-top:.35rem}
footer{margin-top:2.5rem;padding-top:1rem;border-top:1px solid var(--faint);font-size:.82rem;color:var(--mute)}
footer p{margin:.45rem 0}
footer details summary{cursor:pointer;color:var(--fg);min-height:2.4rem;display:flex;align-items:center;font:400 1rem var(--serif)}
/* Leaflet in the dark identity. Only the tile images are filtered; attribution stays readable. */
.leaflet-container{background:#1a1a1a;font:inherit;border-radius:var(--r)}
.tiles-dark{filter:invert(1) hue-rotate(180deg) brightness(.92) contrast(.88) saturate(.55)}
.leaflet-control-attribution{background:rgba(17,17,17,.82)!important;color:var(--mute)!important;font-size:11px}
.leaflet-control-attribution a{color:var(--fg)!important}
.leaflet-bar a{background:#111!important;color:var(--fg)!important;border-color:var(--soft)!important}
.leaflet-bar a:hover{background:#222!important}
.leaflet-bar a{width:40px!important;height:40px!important;line-height:40px!important;font-size:20px!important}
.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#111;color:var(--fg);border:1px solid var(--soft)}
.leaflet-popup-content-wrapper{border-radius:var(--r)}
.leaflet-popup-content{margin:.8rem .9rem;font:400 .92rem/1.4 var(--sans)}
.leaflet-container a.leaflet-popup-close-button{color:var(--mute)}
.pop .name{font-size:1rem}
.pop .pp{font:400 1.5rem/1.1 var(--serif);margin:.15rem 0}
.pop .pp small{font:600 .8rem var(--sans);color:var(--mute)}
.pop .meta{font-size:.85rem}
.pop .btn{margin-top:.45rem;min-height:2.5rem;color:var(--bg)}
@media(min-width:40rem){.loc{grid-template-columns:1fr}.filters{grid-template-columns:2fr 1fr 1fr 1fr}.filters label.wide{grid-column:auto}.card{padding:.9rem}.card .k{font-size:.85rem}}
@media(min-width:60rem){.mapwrap{grid-template-columns:minmax(0,3fr) minmax(0,2fr);align-items:start}#map{height:32rem}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}`;

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
<meta name="theme-color" content="#111111">
<meta name="color-scheme" content="dark">
<link rel="canonical" href="${SITE}${self}">
<link rel="alternate" hreflang="en" href="${SITE}">
<link rel="alternate" hreflang="de" href="${SITE}de/">
<link rel="alternate" hreflang="x-default" href="${SITE}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23111'/%3E%3Cpath d='M10 25V9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M9 25h12M12.5 11h5v4h-5zM20 14h1.5a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 0 3 0V12l-3-3' fill='none' stroke='%23F5F3EE' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<link rel="stylesheet" href="${base}vendor/leaflet/leaflet.css">
<link rel="modulepreload" href="${base}core.js">
<style>
${CSS}
</style>
</head>
<body>
<main>
<div class="topbar"><a class="back" href="${t.backHref}">${t.back}</a><nav class="lang" aria-label="${t.langNav}">${sw('en')}<span class="sep" aria-hidden="true"></span>${sw('de')}</nav></div>
<header>
<h1>Munich Fuel Minimum</h1>
<p class="sub">${t.sub}</p>
</header>

<section class="loc" aria-label="${t.locLabel}">
<form id="loc-form" role="search" autocomplete="off" novalidate>
<label class="l" for="loc-input">${t.locLabel}</label>
<div class="loc-row"><input id="loc-input" name="q" type="search" enterkeyhint="search" placeholder="${t.locPlaceholder}" value="Marienplatz, München" aria-describedby="loc-msg" aria-controls="loc-results" aria-autocomplete="list"><button type="submit" class="btn solid" id="loc-submit">${t.locSearch}</button></div>
<ul id="loc-results" class="results" hidden></ul>
</form>
<p id="loc-msg" class="msg" role="status" aria-live="polite"></p>
<div class="opts">
<button type="button" id="geo" class="btn small">${PIN}${t.geo}</button>
<fieldset class="seg"><legend>${t.radius}</legend>${RADII.map((r) => `<label><input type="radio" name="radius" value="${r}"${r === DEFAULT_RADIUS ? ' checked' : ''}><span>${r} km</span></label>`).join('')}</fieldset>
<label class="check"><input type="checkbox" id="open-only" checked> ${t.openOnly}</label>
</div>
</section>

<div class="status"><div class="txt" id="status" role="status" aria-live="polite"></div><button type="button" id="refresh" class="btn small">${REFRESH}${t.refresh}</button></div>
<noscript><p class="note err">${t.noscript}</p></noscript>
<p id="note" class="note" role="alert"></p>

<div class="cards" role="group" aria-label="${t.fuelNav}">
${['e5', 'e10', 'diesel'].map((f, i) => `<button type="button" class="card" data-fuel="${f}" aria-pressed="${i === 0}"><span class="k">${{ e5: 'Super E5', e10: 'Super E10', diesel: 'Diesel' }[f]}</span><span class="p">–</span><span class="h">${t.cardHint}</span></button>`).join('\n')}
</div>

<div class="mapwrap">
<div class="mapbox">
<div id="map" role="region" aria-label="${t.mapLabel}"></div>
<div class="legend" id="legend" aria-label="${t.legendTitle}"></div>
</div>
<section class="detail" aria-labelledby="best-h">
<h2 id="best-h" tabindex="-1">${t.detailTitle}</h2>
<div id="best" aria-live="polite"></div>
</section>
</div>

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

<p class="howto"><a class="btn article" href="${SITE}${t.howPath}">${t.howBtn}</a></p>

<footer>
<details><summary>${t.howTitle}</summary>${t.how.map((p) => `<p>${p}</p>`).join('')}</details>
<p>${t.attribution}</p>
<p>${t.disclaimer} ${t.source}</p>
</footer>
</main>
<script>document.querySelectorAll("[data-lang]").forEach(function(a){a.addEventListener("click",function(){try{localStorage.setItem("lang",a.getAttribute("data-lang"))}catch(e){}})})</script>
<script src="${base}vendor/leaflet/leaflet.js" defer></script>
<script type="module" src="${base}app.js"></script>
</body>
</html>
`;
}

mkdirSync('docs/de', { recursive: true });
writeFileSync('docs/index.html', page('en'));
writeFileSync('docs/de/index.html', page('de'));
// Article: rendered from the approved Markdown on every build (text unchanged; see article.mjs).
writeFileSync('docs/how-it-works.html', renderArticlePage(readFileSync('content/how-it-works.md', 'utf8'), 'en'));
writeFileSync('docs/de/how-it-works.html', renderArticlePage(readFileSync('content/how-it-works.de.md', 'utf8'), 'de'));
console.log('Built docs/index.html, docs/de/index.html, docs/how-it-works.html and docs/de/how-it-works.html');
