// Tagesbau: Verlauf fortschreiben, Feed, Tagestext, Kopierseite und Status unter docs/ erzeugen.
// Aufruf: node werkzeug/bauen.mjs                 (Tagesbau für heute, Europe/Berlin)
//         node werkzeug/bauen.mjs --vorschau start (Vorschau-Seite eines Pakets)
// Prüft alle zusammengesetzten Texte und Links; bei Fehlern Abbruch mit Exit-Code 1, ohne docs zu ändern.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WURZEL, lesenJson, schreibenJson, heuteBerlin, slug, amazonLink } from './lib.mjs';
import { pruefeText, pruefeLink } from './regeln.mjs';
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
  const link = amazonLink(fund.suchbegriff, config.kennungen.kanal, 0, config);
  return { text: [p.anfang_kanal, k.text, p.link_zeile.replace('{link}', link), p.alle_funde, p.ende].join('\n\n'), links: [link] };
}

export function rueckblickText(funde, config) {
  const p = config.pflichttexte;
  const links = funde.map((f) => amazonLink(f.suchbegriff, config.kennungen.kanal, 0, config));
  const zeilen = funde.map((f, i) => `${i + 1}. ${f.titel} – ${links[i]}`);
  return { text: [p.anfang_rueckblick, ['Die drei Funde der Woche:', ...zeilen].join('\n'), p.alle_funde, p.ende].join('\n\n'), links };
}

export function socialText(fund, config) {
  const p = config.pflichttexte;
  const s = fund.texte.social[0];
  if (!s || !s.text) throw new Error(`${fund.id}: Social-Fassung fehlt`);
  return `${p.anfang_social} · ${s.text}\n\n${p.social_verweis}\n${p.ende}\n\n${s.hashtags}`;
}

function feedEintrag(v, fund) {
  return { id: fund.id, slug: `${fund.id}-${slug(fund.titel)}`, datum: v.datum, titel: fund.titel,
    text_h: fund.texte.web.h, text_p: fund.texte.web.p, suchbegriff: fund.suchbegriff, anlaesse: fund.anlaesse, kategorie: fund.kategorie };
}

// ---------- Seiten ----------
const CSS = (g) => `:root{--bg:${g.hintergrund};--text:${g.text};--gruen:${g.akzent_gruen};--pink:${g.akzent_pink};--cyan:${g.akzent_cyan};--box:#17172a}
*{box-sizing:border-box;margin:0;padding:0}
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

const KOPIEREN = `document.querySelectorAll('[data-kopiere]').forEach(function(b){b.addEventListener('click',function(){
var q=document.getElementById(b.getAttribute('data-kopiere'));var t=q.textContent;var alt=b.textContent;
function ok(){b.textContent='Kopiert ✓';setTimeout(function(){b.textContent=alt},2500)}
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(ok,function(){waehle(q);ok()})}else{waehle(q);ok()}});});
function waehle(q){var r=document.createRange();r.selectNodeContents(q);var s=window.getSelection();s.removeAllRanges();s.addRange(r);try{document.execCommand('copy')}catch(e){}}`;

function seite(titel, inhalt, config, skript = '') {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(titel)}</title>
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

function heuteSeite({ datum, kanal, social, vorrat }, config) {
  const teile = [`<h1>Heute posten</h1>`, `<p class="datum">${esc(datumLang(datum))}</p>`];
  if (kanal) {
    teile.push(`<pre class="box" id="kanal">${esc(kanal)}</pre>`, `<button class="knopf" type="button" data-kopiere="kanal">Text kopieren</button>`);
    if (config.kanal_url) teile.push(`<a class="knopf zwei" href="${esc(config.kanal_url)}" target="_blank" rel="noopener">Kanal öffnen</a>`);
  } else {
    teile.push(`<p class="box leer">Heute ist kein Fund geplant.</p>`);
  }
  if (social) {
    teile.push(`<h2>Für Instagram und Facebook</h2>`, `<pre class="box" id="social">${esc(social)}</pre>`,
      `<button class="knopf zwei" type="button" data-kopiere="social">Text kopieren</button>`);
  }
  teile.push(`<h2>Vorrat</h2>`);
  teile.push(vorrat.length
    ? `<ul class="vorrat">${vorrat.map((v) => `<li><span class="d">${esc(datumKurz(v.datum))}</span><span>${esc(v.titel)}</span></li>`).join('')}</ul>`
    : `<p class="box leer">Nichts geplant.</p>`);
  return seite('Heute posten · Papillons Fund des Tages', teile.join('\n'), config, kanal || social ? KOPIEREN : '');
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

  // 1. Heutigen Plan-Eintrag in den Verlauf übernehmen (nur einmal)
  const eintrag = plan[heute] || null;
  let neueZeile = null;
  if (eintrag && !verlauf.some((v) => v.datum === heute)) {
    if (eintrag.art === 'fund') {
      const f = nachId.get(eintrag.fund);
      if (!f) throw new Error(`Plan ${heute}: Fund ${eintrag.fund} unbekannt`);
      neueZeile = { datum: heute, art: 'fund', fund: f.id, gattung: f.gattung, kategorie: f.kategorie,
        ton: eintrag.ton ?? null, format: eintrag.format ?? null, fassung: eintrag.fassung ?? null };
    } else {
      neueZeile = { datum: heute, art: eintrag.art, fund: null, gattung: null, kategorie: null, ton: null, format: null, fassung: null };
    }
  }
  const alleZeilen = neueZeile ? [...verlauf, neueZeile] : verlauf;
  const heuteZeile = alleZeilen.find((v) => v.datum === heute) || null;

  // 2. Feed (ohne Link, ohne Kennung), neueste zuerst
  const feed = alleZeilen.filter((v) => v.art === 'fund' && nachId.has(v.fund))
    .sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0))
    .map((v) => feedEintrag(v, nachId.get(v.fund)));

  // 3. Tagestexte
  let kanal = null, social = null, links = [], fundHeute = null;
  if (heuteZeile && heuteZeile.art === 'fund') {
    const f = nachId.get(heuteZeile.fund);
    fundHeute = feed.find((e) => e.id === f.id && e.datum === heute) || null;
    ({ text: kanal, links } = kanalText(f, heuteZeile.fassung, config));
    social = socialText(f, config);
  } else if (heuteZeile && heuteZeile.art === 'rueckblick') {
    const woche = alleZeilen.filter((v) => v.art === 'fund' && nachId.has(v.fund) && abstand(v.datum, heute) >= 1 && abstand(v.datum, heute) <= 6)
      .map((v) => ({ v, f: nachId.get(v.fund) }))
      .sort((a, b) => (b.f.score?.grund ?? 0) - (a.f.score?.grund ?? 0) || (a.v.datum < b.v.datum ? 1 : -1))
      .slice(0, 3).map((x) => x.f);
    if (woche.length === 0) throw new Error(`Rückblick ${heute}: keine Funde in den 6 Tagen davor`);
    ({ text: kanal, links } = rueckblickText(woche, config));
  }

  // 4. Prüfen – bei Fehlern nichts schreiben
  const fehler = [];
  if (kanal) fehler.push(...pruefeText(kanal, 'kanal', config));
  if (social) fehler.push(...pruefeText(social, 'social', config));
  for (const l of links) fehler.push(...pruefeLink(l, config));
  if (fehler.length) throw new Error('Prüfung fehlgeschlagen: ' + fehler.join(' | '));

  // 5. Status und Vorrat
  const benutzt = new Set([...alleZeilen.filter((v) => v.art === 'fund').map((v) => v.fund),
    ...Object.values(plan).filter((e) => e && e.art === 'fund').map((e) => e.fund)]);
  const vorratTage = funde.filter((f) => f.status === 'freigegeben' && !benutzt.has(f.id)).length;
  const geplant = Object.keys(plan).filter((d) => d >= heute).length;
  const warnungen = [];
  if (vorratTage < config.vorrat_warnung_tage) warnungen.push(`Vorrat unter ${config.vorrat_warnung_tage} Tagen`);
  if (!eintrag) warnungen.push('Heute kein Fund geplant');
  const status = { letzter_lauf: jetzt.toISOString(), datum: heute, heute_art: heuteZeile ? heuteZeile.art : null,
    heute_fund: heuteZeile ? heuteZeile.fund : null, vorrat_tage: vorratTage, geplante_tage: geplant, warnungen };
  const vorrat = Object.keys(plan).filter((d) => d > heute).sort().slice(0, 7).map((d) => {
    const e = plan[d];
    return { datum: d, titel: e.art === 'fund' ? (nachId.get(e.fund)?.titel ?? e.fund) : 'Wochenrückblick' };
  });

  // 6. Schreiben
  if (neueZeile) appendFileSync(verlaufPfad, JSON.stringify(neueZeile) + '\n', 'utf8');
  schreibenJson(join(docs, 'feed', 'funde.json'), feed);
  schreibenJson(join(docs, 'feed', 'heute.json'), { datum: heute, art: heuteZeile ? heuteZeile.art : null, fund: fundHeute, kanal_text: kanal, social_text: social });
  schreibenJson(join(docs, 'status.json'), status);
  datei(join(docs, 'heute', 'index.html'), heuteSeite({ datum: heute, kanal, social, vorrat }, config));
  datei(join(docs, 'robots.txt'), ROBOTS);
  datei(join(docs, '.nojekyll'), '');
  return { neueZeile, status, kanal, social };
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
    const link = amazonLink(f.suchbegriff, config.kennungen.web, 0, config);
    fehler.push(...pruefeLink(link, config).map((x) => `${f.id}: ${x}`));
    const t = f.texte;
    return `<section class="fund"><h2>${esc(f.titel)}</h2>
<p><span class="marke">Grundscore ${esc(f.score?.grund ?? 0)}</span> · ${esc(f.id)} · ${esc(f.status)}</p>
<div class="box"><b>${esc(t.web.h)}</b>\n${esc(t.web.p)}</div>
${t.kanal.map((k) => `<p class="klein">Kanal · ${esc(k.format)} · ${esc(k.ton)}</p><div class="box">${esc(k.text)}</div>`).join('\n')}
${t.social.map((s) => `<p class="klein">Social</p><div class="box">${esc(s.text)}\n${esc(s.hashtags)}</div>`).join('\n')}
<a class="knopf zwei" href="${esc(link)}" target="_blank" rel="sponsored noopener">Link testen</a></section>`;
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
