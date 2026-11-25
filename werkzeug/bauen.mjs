// Tagesbau: Verlauf fortschreiben, Feed, Tagestext, Kopierseite und Status unter docs/ erzeugen.
// Aufruf: node werkzeug/bauen.mjs                 (Tagesbau für heute, Europe/Berlin)
//         node werkzeug/bauen.mjs --vorschau start (Vorschau-Seite eines Pakets)
// Prüft alle zusammengesetzten Texte und Links; bei Fehlern Abbruch mit Exit-Code 1, ohne docs zu ändern.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WURZEL, lesenJson, schreibenJson, heuteBerlin, slug, produktLink, pruefLink } from './lib.mjs';
import { pruefeText, pruefeFundLink, istGeprueft } from './regeln.mjs';
import { lesenVerlauf, plusTage, abstand } from './planen.mjs';

const ROBOTS = ['User-agent: *', 'Disallow: /heute/', 'Disallow: /vorschau/', 'Disallow: /social/',
  'Disallow: /amazon-engine/heute/', 'Disallow: /amazon-engine/vorschau/', 'Disallow: /amazon-engine/social/', ''].join('\n');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const WOCHENTAG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const KURZTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const wtag = (d) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay();
const datumLang = (d) => `${WOCHENTAG[wtag(d)]}, ${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const datumKurz = (d) => `${KURZTAG[wtag(d)]} ${d.slice(8, 10)}.${d.slice(5, 7)}.`;

// ---------- Texte zusammensetzen ----------
export function kanalText(fund, fassung, config) {
  const p = config.pflichttexte;
  const k = fund.texte.kanal[Number.isInteger(fassung) ? fassung : 0];
  if (!k || !k.text) throw new Error(`${fund.id}: Kanal-Fassung ${fassung} fehlt`);
  const link = produktLink(fund.asin, config.kennungen.kanal, config); // AE-13: direkt zum Produkt
  return { text: [p.anfang_kanal, k.text, p.link_zeile.replace('{link}', link), p.alle_funde, p.ende].join('\n\n'), links: [link] };
}

export function rueckblickText(funde, config) {
  const p = config.pflichttexte;
  const links = funde.map((f) => produktLink(f.asin, config.kennungen.kanal, config));
  const zeilen = funde.map((f, i) => `${i + 1}. ${f.titel} – ${links[i]}`);
  return { text: [p.anfang_rueckblick, ['Die drei Funde der Woche:', ...zeilen].join('\n'), p.alle_funde, p.ende].join('\n\n'), links };
}

export function socialText(fund, config) {
  const p = config.pflichttexte;
  const s = fund.texte.social[0];
  if (!s || !s.text) throw new Error(`${fund.id}: Social-Fassung fehlt`);
  return `${p.anfang_social} · ${s.text}\n\n${p.social_verweis}\n${p.ende}\n\n${s.hashtags}`;
}

// AE-13: Feed mit asin und fertigem Web-Link (kein Suchbegriff mehr). Ist die Sichtprüfung am Bautag
// nicht (mehr) gültig: link null und link_status 'wird_neu_geprueft' – die Website zeigt dann keinen Knopf.
function feedEintrag(v, fund, heute, config) {
  const geprueft = istGeprueft(fund, heute, config);
  return { id: fund.id, slug: `${fund.id}-${slug(fund.titel)}`, datum: v.datum, titel: fund.titel,
    text_h: fund.texte.web.h, text_p: fund.texte.web.p, asin: fund.asin ?? null,
    link: geprueft ? produktLink(fund.asin, config.kennungen.web, config) : null,
    ...(geprueft ? {} : { link_status: 'wird_neu_geprueft' }), anlaesse: fund.anlaesse, kategorie: fund.kategorie };
}

// ---------- Seiten ----------
const CSS = (g) => `:root{--bg:${g.hintergrund};--text:${g.text};--gruen:${g.akzent_gruen};--pink:${g.akzent_pink};--cyan:${g.akzent_cyan};--box:#17172a}
*{box-sizing:border-box;margin:0;padding:0}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--text);font:500 ${g.schrift_fliesstext_min_px}px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px 16px 56px}
main{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:20px}
h1,h2{font-size:${g.schrift_ueberschrift_min_px}px;line-height:1.1;font-weight:800;overflow-wrap:anywhere;hyphens:auto}
h1{color:var(--gruen)}
h2{color:var(--cyan);margin-top:20px}
.datum{font-size:24px;font-weight:700}
.box{background:var(--box);border:2px solid var(--cyan);border-radius:16px;padding:18px;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
.leer{border-color:var(--pink)}
.knopf{display:flex;align-items:center;justify-content:center;width:100%;min-height:${g.knopf_hoehe_min_px}px;padding:12px 16px;border:0;border-radius:14px;
  font:800 22px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--gruen);color:var(--bg);cursor:pointer;text-decoration:none;text-align:center}
.knopf.zwei{background:var(--cyan)}
.knopf:focus-visible{outline:3px solid var(--pink);outline-offset:3px}
.vorrat{list-style:none;display:flex;flex-direction:column;gap:10px}
.vorrat li{display:flex;flex-direction:column;gap:2px;padding:14px 16px;background:var(--box);border-radius:12px}
.vorrat .d{font-weight:800;color:var(--cyan);font-variant-numeric:tabular-nums}
.fund{display:flex;flex-direction:column;gap:12px;padding-top:8px;border-top:2px solid #2a2a44}
.marke{font-weight:800;color:var(--gruen)}
.klein{font-size:20px;font-weight:700;color:var(--cyan)}`;

export const KOPIEREN = `document.querySelectorAll('[data-kopiere]').forEach(function(b){b.addEventListener('click',function(){
var q=document.getElementById(b.getAttribute('data-kopiere'));var t=q.textContent;var alt=b.textContent;
var dann=b.getAttribute('data-dann');
function ok(){b.textContent='Kopiert ✓';if(dann){setTimeout(function(){window.location.href=dann},500)}setTimeout(function(){b.textContent=alt},2500)}
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(ok,function(){waehle(q);ok()})}else{waehle(q);ok()}});});
function waehle(q){var r=document.createRange();r.selectNodeContents(q);var s=window.getSelection();s.removeAllRanges();s.addRange(r);try{document.execCommand('copy')}catch(e){}}`;

// Kopf-Zusatz der Kopierseite: lässt sich als „Heute posten“ mit Schmetterling auf den Startbildschirm legen.
const STARTBILDSCHIRM = `<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" href="../papillon-192.png">
<link rel="apple-touch-icon" href="../papillon-192.png">
<meta name="theme-color" content="#0B0B14">
<meta name="apple-mobile-web-app-title" content="Heute posten">`;
const MANIFEST = (g) => JSON.stringify({ name: 'Heute posten', short_name: 'Heute posten', start_url: './', scope: './', display: 'standalone',
  background_color: g.hintergrund, theme_color: g.hintergrund, lang: 'de',
  icons: [{ src: '../papillon-192.png', sizes: '192x192', type: 'image/png' }, { src: '../papillon-512.png', sizes: '512x512', type: 'image/png' }] }, null, 2) + '\n';

export function seite(titel, inhalt, config, skript = '', kopf = '') {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
${kopf ? kopf + '\n' : ''}<title>${esc(titel)}</title>
<style>${CSS(config.gestaltung_engine_seiten)}</style>
</head>
<body>
<main>
${inhalt}
</main>
${skript ? `<script>${skript}</script>` : ''}
</body>
</html>
`;
}

// Wählt im Browser den Tag nach Berliner Datum aus den vorab gebauten Tagen (Daten im Block #tage).
// So stimmt der Text morgens auch dann, wenn der Tageslauf bei GitHub verspätet oder gar nicht kommt.
const TAGESWAHL = `(function(){var el=document.getElementById('tage');if(!el)return;var D=JSON.parse(el.textContent);
var heute=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
if(heute===D.gebaut)return;var W=${JSON.stringify(WOCHENTAG)},K=${JSON.stringify(KURZTAG)};
function wt(d){return new Date(Date.UTC(+d.slice(0,4),+d.slice(5,7)-1,+d.slice(8,10))).getUTCDay()}
function z(id){return document.getElementById(id)}
z('datum').textContent=W[wt(heute)]+', '+heute.slice(8,10)+'.'+heute.slice(5,7)+'.'+heute.slice(0,4);
var t=null;for(var i=0;i<D.tage.length;i++){if(D.tage[i].datum===heute)t=D.tage[i]}
z('kanal').textContent=t?t.kanal:'';z('kanal').hidden=!t;z('kanalknopf').hidden=!t;z('leer').hidden=!!t;
var s=t&&t.social;z('social').textContent=s||'';['socialkopf','social','socialknopf'].forEach(function(id){z(id).hidden=!s});
var v=D.plan.filter(function(p){return p.datum>heute}).slice(0,7);
z('vorrat').innerHTML='';v.forEach(function(p){var li=document.createElement('li');var a=document.createElement('span');a.className='d';
a.textContent=K[wt(p.datum)]+' '+p.datum.slice(8,10)+'.'+p.datum.slice(5,7)+'.';var b=document.createElement('span');b.textContent=p.titel;li.appendChild(a);li.appendChild(b);z('vorrat').appendChild(li)});
z('vorrat').hidden=!v.length;z('vorratleer').hidden=!!v.length;})();`;

function heuteSeite({ datum, tage, plan }, config) {
  const t = tage.find((x) => x.datum === datum) || null;
  const vorrat = plan.filter((p) => p.datum > datum).slice(0, 7);
  const aus = (b) => (b ? '' : ' hidden');
  const teile = [`<h1>Heute posten</h1>`, `<p class="datum" id="datum">${esc(datumLang(datum))}</p>`,
    `<pre class="box" id="kanal"${aus(t)}>${esc(t ? t.kanal : '')}</pre>`,
    // Ein Knopf: kopieren und gleich den Kanal öffnen (ohne Kanal-Link nur kopieren)
    config.kanal_url
      ? `<button class="knopf" type="button" id="kanalknopf" data-kopiere="kanal" data-dann="${esc(config.kanal_url)}"${aus(t)}>Kopieren und Kanal öffnen</button>`
      : `<button class="knopf" type="button" id="kanalknopf" data-kopiere="kanal"${aus(t)}>Text kopieren</button>`,
    `<p class="box leer" id="leer"${aus(!t)}>Heute kein neuer Fund. Alle bisherigen findest du unter schmetterlingsfutter.de/funde.</p>`,
    `<h2 id="socialkopf"${aus(t && t.social)}>Für Instagram und Facebook</h2>`,
    `<pre class="box" id="social"${aus(t && t.social)}>${esc(t && t.social ? t.social : '')}</pre>`,
    `<button class="knopf zwei" type="button" id="socialknopf" data-kopiere="social"${aus(t && t.social)}>Text kopieren</button>`,
    `<h2>Vorrat</h2>`,
    `<ul class="vorrat" id="vorrat"${aus(vorrat.length)}>${vorrat.map((v) => `<li><span class="d">${esc(datumKurz(v.datum))}</span><span>${esc(v.titel)}</span></li>`).join('')}</ul>`,
    `<p class="box leer" id="vorratleer"${aus(!vorrat.length)}>Nichts geplant.</p>`,
    `<script type="application/json" id="tage">${JSON.stringify({ gebaut: datum, tage, plan }).replace(/</g, '\\u003c')}</script>`];
  return seite('Heute posten · Papillons Fund des Tages', teile.join('\n'), config, TAGESWAHL + '\n' + KOPIEREN, STARTBILDSCHIRM);
}

// Texte eines Tages aus seinem Eintrag (Verlauf oder Plan). zeitleiste: Map Datum → Eintrag mit fund.
function texteFuer(datum, e, zeitleiste, nachId, config) {
  if (!e) return null;
  // AE-13: Pause (kein geprüfter Fund) oder ein Fund ohne gültige Sichtprüfung → kein Text, kein Link.
  // Die Kopierseite zeigt dann „Heute kein neuer Fund“ mit Verweis auf config.funde_seite.
  if (e.art === 'fund') {
    const f = nachId.get(e.fund);
    if (!f) throw new Error(`${datum}: Fund ${e.fund} unbekannt`);
    if (!istGeprueft(f, datum, config)) return null;
    const k = kanalText(f, e.fassung, config);
    return { datum, art: 'fund', fund: f, titel: f.titel, kanal: k.text, social: socialText(f, config), links: k.links };
  }
  if (e.art === 'rueckblick') {
    const woche = [...zeitleiste.entries()].filter(([d, v]) => v.art === 'fund' && nachId.has(v.fund) && istGeprueft(nachId.get(v.fund), datum, config) && abstand(d, datum) >= 1 && abstand(d, datum) <= 6)
      .map(([d, v]) => ({ d, f: nachId.get(v.fund) }))
      .sort((a, b) => (b.f.score?.grund ?? 0) - (a.f.score?.grund ?? 0) || (a.d < b.d ? 1 : -1))
      .slice(0, 3).map((x) => x.f);
    if (woche.length === 0) return null; // AE-13: keine geprüften Funde in den 6 Tagen davor → wie Pause
    const r = rueckblickText(woche, config);
    return { datum, art: 'rueckblick', fund: null, titel: 'Wochenrückblick', kanal: r.text, social: null, links: r.links };
  }
  return null;
}

function zeileAus(datum, e, nachId) {
  if (e.art === 'fund') {
    const f = nachId.get(e.fund);
    if (!f) throw new Error(`Plan ${datum}: Fund ${e.fund} unbekannt`);
    return { datum, art: 'fund', fund: f.id, gattung: f.gattung, kategorie: f.kategorie, ton: e.ton ?? null, format: e.format ?? null, fassung: e.fassung ?? null };
  }
  return { datum, art: e.art, fund: null, gattung: null, kategorie: null, ton: null, format: null, fassung: null };
}

// ---------- Tagesbau ----------
export function bauen({ daten = join(WURZEL, 'daten'), docs = join(WURZEL, 'docs'), config = lesenJson(join(WURZEL, 'config.json')),
  heute = heuteBerlin(), jetzt = new Date() } = {}) {
  const funde = lesenJson(join(daten, 'funde.json'));
  const nachId = new Map(funde.map((f) => [f.id, f]));
  const planPfad = join(daten, 'plan.json');
  const plan = existsSync(planPfad) ? lesenJson(planPfad) : {};
  const verlaufPfad = join(daten, 'verlauf.jsonl');
  const verlauf = lesenVerlauf(verlaufPfad);

  // 1. Plan-Einträge bis heute in den Verlauf übernehmen (je Tag nur einmal). Verpasste Tage der letzten
  //    planung_tage_voraus Tage werden nachgetragen – die Kopierseite hat sie an ihrem Tag schon gezeigt.
  const eintrag = plan[heute] || null;
  const imVerlauf = new Set(verlauf.map((v) => v.datum));
  const neueZeilen = Object.keys(plan).sort()
    .filter((d) => plan[d] && d <= heute && abstand(d, heute) < config.planung_tage_voraus && !imVerlauf.has(d))
    .map((d) => zeileAus(d, plan[d], nachId));
  const neueZeile = neueZeilen.find((z) => z.datum === heute) || null;
  const alleZeilen = [...verlauf, ...neueZeilen];
  const heuteZeile = alleZeilen.find((v) => v.datum === heute) || null;

  // 2. Feed (ohne Link, ohne Kennung), neueste zuerst
  const feed = alleZeilen.filter((v) => v.art === 'fund' && nachId.has(v.fund))
    .sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0))
    .map((v) => feedEintrag(v, nachId.get(v.fund), heute, config));

  // 3. Tagestexte für heute und alle geplanten Folgetage (die Kopierseite wählt im Browser den richtigen Tag)
  const zeitleiste = new Map();
  for (const [d, e] of Object.entries(plan)) if (e && d > heute) zeitleiste.set(d, e);
  for (const v of alleZeilen) zeitleiste.set(v.datum, v);
  const tage = [];
  for (let n = 0; n < config.planung_tage_voraus; n++) {
    const d = plusTage(heute, n);
    const t = texteFuer(d, zeitleiste.get(d), zeitleiste, nachId, config);
    if (t) tage.push(t);
  }
  const heuteTexte = tage.find((t) => t.datum === heute) || null;
  const kanal = heuteTexte ? heuteTexte.kanal : null;
  const social = heuteTexte ? heuteTexte.social : null;
  // Fund von heute aus dem Feed (mit link oder link null + link_status, wenn die Sichtprüfung fehlt)
  const fundHeute = heuteZeile && heuteZeile.art === 'fund' ? feed.find((e) => e.id === heuteZeile.fund && e.datum === heute) || null : null;

  // 4. Prüfen – alle vorab gebauten Texte und Links; bei Fehlern nichts schreiben
  const fehler = [];
  for (const t of tage) {
    fehler.push(...pruefeText(t.kanal, 'kanal', config).map((x) => `${t.datum} ${x}`));
    if (t.social) fehler.push(...pruefeText(t.social, 'social', config).map((x) => `${t.datum} ${x}`));
    for (const l of t.links) fehler.push(...pruefeFundLink(l, config).map((x) => `${t.datum} ${x}`));
    if (`${t.kanal}\n${t.social ?? ''}`.includes('amazon.de/s?')) fehler.push(`${t.datum}: Suchlink im Text`);
  }
  for (const e of feed) if (e.link) fehler.push(...pruefeFundLink(e.link, config).map((x) => `Feed ${e.id}: ${x}`));
  // AE-14 Nachtrag: alle freigegebenen Funde mit am Bautag gültiger Sichtprüfung (für die Wichtel-Seite), nach id
  const geprueftListe = funde.filter((f) => f.status === 'freigegeben' && istGeprueft(f, heute, config))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((f) => ({ id: f.id, titel: f.titel, asin: f.asin, link: produktLink(f.asin, config.kennungen.web, config),
      geprueft_am: f.produkt.geprueft_am, gueltig_bis: plusTage(f.produkt.geprueft_am, config.sichtpruefung_gueltig_tage ?? 90) }));
  for (const e of geprueftListe) fehler.push(...pruefeFundLink(e.link, config).map((x) => `geprueft.json ${e.id}: ${x}`));
  if (fehler.length) throw new Error('Prüfung fehlgeschlagen: ' + fehler.join(' | '));

  // 5. Status und Vorrat
  const benutzt = new Set([...alleZeilen.filter((v) => v.art === 'fund').map((v) => v.fund),
    ...Object.values(plan).filter((e) => e && e.art === 'fund').map((e) => e.fund)]);
  // AE-13: Vorrat zählt nur Funde mit gültiger Sichtprüfung; warten_auf_sichtpruefung = freigegeben, aber nicht geprüft
  const vorratTage = funde.filter((f) => f.status === 'freigegeben' && !benutzt.has(f.id) && istGeprueft(f, heute, config)).length;
  const wartend = funde.filter((f) => f.status === 'freigegeben' && !istGeprueft(f, heute, config)).length;
  const geplant = Object.keys(plan).filter((d) => d >= heute && plan[d] && plan[d].art !== 'pause').length;
  const warnungen = [];
  if (vorratTage < config.vorrat_warnung_tage) warnungen.push(`Vorrat unter ${config.vorrat_warnung_tage} Tagen`);
  if (!eintrag) warnungen.push('Heute kein Fund geplant');
  else if (eintrag.art === 'pause') warnungen.push('Heute Pause: kein Fund mit gültiger Sichtprüfung');
  if (wartend > 0) warnungen.push(`${wartend} Funde warten auf Mos Sichtprüfung`);
  const status = { letzter_lauf: jetzt.toISOString(), datum: heute, heute_art: heuteZeile ? heuteZeile.art : null,
    heute_fund: heuteZeile ? heuteZeile.fund : null, vorrat_tage: vorratTage, vorrat_geprueft_tage: vorratTage,
    warten_auf_sichtpruefung: wartend, geplante_tage: geplant, warnungen };
  const planListe = Object.keys(plan).filter((d) => d >= heute && plan[d] && plan[d].art !== 'pause').sort().map((d) => {
    const e = plan[d];
    return { datum: d, titel: e.art === 'fund' ? (nachId.get(e.fund)?.titel ?? e.fund) : 'Wochenrückblick' };
  });
  const seitenTage = tage.map(({ datum, art, titel, kanal: k, social: s }) => ({ datum, art, titel, kanal: k, social: s }));

  // 6. Schreiben
  for (const z of neueZeilen) appendFileSync(verlaufPfad, JSON.stringify(z) + '\n', 'utf8');
  schreibenJson(join(docs, 'feed', 'funde.json'), feed);
  schreibenJson(join(docs, 'feed', 'geprueft.json'), geprueftListe);
  schreibenJson(join(docs, 'feed', 'heute.json'), { datum: heute, art: heuteZeile ? heuteZeile.art : null, fund: fundHeute, kanal_text: kanal, social_text: social });
  schreibenJson(join(docs, 'status.json'), status);
  datei(join(docs, 'heute', 'index.html'), heuteSeite({ datum: heute, tage: seitenTage, plan: planListe }, config));
  datei(join(docs, 'heute', 'manifest.webmanifest'), MANIFEST(config.gestaltung_engine_seiten));
  datei(join(docs, 'robots.txt'), ROBOTS);
  datei(join(docs, '.nojekyll'), '');
  return { neueZeile, neueZeilen, status, kanal, social, tage: seitenTage };
}

function datei(pfad, inhalt) {
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, inhalt, 'utf8');
}

// ---------- Vorschau eines Pakets ----------
export function vorschau({ paket, daten = join(WURZEL, 'daten'), docs = join(WURZEL, 'docs'), config = lesenJson(join(WURZEL, 'config.json')) }) {
  if (!/^[A-Za-z0-9-]+$/.test(paket || '')) throw new Error('Paketname fehlt oder ist ungültig');
  const funde = lesenJson(join(daten, 'funde.json')).filter((f) => f.paket === paket);
  if (funde.length === 0) throw new Error(`Paket ${paket}: keine Funde`);
  const fehler = [];
  const karten = funde.map((f) => {
    // AE-13: Vorschau verlinkt die Produktseite ohne Kennung – nur für Mos Sichtprüfung
    let link = null;
    try { link = pruefLink(f.asin, config); } catch { fehler.push(`${f.id}: keine gültige asin`); }
    const t = f.texte;
    return `<section class="fund"><h2>${esc(f.titel)}</h2>
<p><span class="marke">Grundscore ${esc(f.score?.grund ?? 0)}</span> · ${esc(f.id)} · ${esc(f.status)}</p>
<div class="box"><b>${esc(t.web.h)}</b>\n${esc(t.web.p)}</div>
${t.kanal.map((k) => `<p class="klein">Kanal · ${esc(k.format)} · ${esc(k.ton)}</p><div class="box">${esc(k.text)}</div>`).join('\n')}
${t.social.map((s) => `<p class="klein">Social</p><div class="box">${esc(s.text)}\n${esc(s.hashtags)}</div>`).join('\n')}
${f.produkt && f.produkt.titel_gesehen ? `<p class="klein">Gefunden: ${esc(f.produkt.titel_gesehen)}</p>` : ''}
<a class="knopf zwei" href="${esc(link ?? '')}" target="_blank" rel="noopener">Produktseite prüfen</a></section>`;
  });
  if (fehler.length) throw new Error('Prüfung fehlgeschlagen: ' + fehler.join(' | '));
  const pfad = join(docs, 'vorschau', paket, 'index.html');
  datei(pfad, seite(`Vorschau ${paket} · Papillons Fund des Tages`, `<h1>Vorschau ${esc(paket)}</h1>\n<p class="datum">${funde.length} Funde</p>\n${karten.join('\n')}`, config));
  return { pfad, anzahl: funde.length };
}

function argWert(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes('--vorschau')) {
      const { pfad, anzahl } = vorschau({ paket: argWert('--vorschau') });
      console.log(`vorschau: ${anzahl} Funde → ${pfad}`);
    } else {
      const heute = argWert('--heute') ?? heuteBerlin();
      const { status } = bauen({ heute, daten: resolve(argWert('--daten') ?? join(WURZEL, 'daten')), docs: resolve(argWert('--docs') ?? join(WURZEL, 'docs')) });
      console.log(`gebaut: ${status.datum} · ${status.heute_art ?? 'kein Eintrag'} ${status.heute_fund ?? ''} · vorrat_tage ${status.vorrat_tage}${status.warnungen.length ? ' · Warnungen: ' + status.warnungen.join(', ') : ''}`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
