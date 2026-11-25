// Prüft alle Funde in daten/funde.json gegen die Regeln.
// Ausgabe je Fehler 'f-0001: <Fehler>'; Exit-Code 1 bei Fehlern, sonst 'ok: <Anzahl> Funde'.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WURZEL, lesenJson, schluessel, heuteBerlin } from './lib.mjs';
import { pruefeFund, pruefeFundLink, istGeprueft } from './regeln.mjs';

export function pruefeAlle(funde, config) {
  const fehler = [];
  if (!Array.isArray(funde)) return ['funde.json: keine Liste'];
  const ids = new Map();
  const schl = new Map();
  const asins = new Map();
  funde.forEach((fund, i) => {
    const name = fund && fund.id ? fund.id : `#${i + 1}`;
    for (const x of pruefeFund(fund, config)) fehler.push(`${name}: ${x}`);
    if (!fund) return;
    if (fund.id) {
      if (ids.has(fund.id)) fehler.push(`${name}: doppelte id (auch ${ids.get(fund.id)})`);
      else ids.set(fund.id, name);
    }
    if (typeof fund.titel === 'string') {
      const s = schluessel(fund.titel);
      if (schl.has(s)) fehler.push(`${name}: doppelter schluessel '${s}' (auch ${schl.get(s)})`);
      else schl.set(s, name);
    }
    if (fund.asin) {
      if (asins.has(fund.asin)) fehler.push(`${name}: doppelte asin ${fund.asin} (auch ${asins.get(fund.asin)})`);
      else asins.set(fund.asin, name);
    }
  });
  return fehler;
}

// AE-13: Ausgaben prüfen – plan.json, docs/feed/funde.json, docs/feed/heute.json, docs/heute/.
// Harter Fehler: ein Fund ohne gültige Sichtprüfung an seinem Tag (geplante, noch nicht veröffentlichte Tage;
// im Feed nur, wenn er dort einen Link trägt), ein Suchlink 'amazon.de/s?' oder ein Amazon-Link,
// der nicht auf das Produkt-Muster passt.
export function pruefeAusgaben({ daten = join(WURZEL, 'daten'), docs = join(WURZEL, 'docs'), funde, config, heute = heuteBerlin() }) {
  const fehler = [];
  const nachId = new Map(funde.map((f) => [f.id, f]));
  const lies = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
  const verlauf = (lies(join(daten, 'verlauf.jsonl')) || '').split(/\r?\n/).filter((z) => z.trim()).map((z) => JSON.parse(z));
  const imVerlauf = new Set(verlauf.map((v) => v.datum));
  const planText = lies(join(daten, 'plan.json'));
  if (planText) {
    for (const [d, e] of Object.entries(JSON.parse(planText))) {
      if (!e || e.art !== 'fund' || d < heute || imVerlauf.has(d)) continue;
      if (!istGeprueft(nachId.get(e.fund), d, config)) fehler.push(`plan.json ${d}: ${e.fund} ohne gültige Sichtprüfung`);
    }
  }
  const amazonLinks = (text) => text.match(/https?:\/\/(?:www\.)?amazon\.de\/[^\s"'<>\\)]+/g) || [];
  const pruefeAusgabe = (name, text) => {
    if (text === null) return;
    if (text.includes('amazon.de/s?')) fehler.push(`${name}: enthält einen Suchlink 'amazon.de/s?'`);
    for (const l of amazonLinks(text.replace(/&amp;/g, '&'))) for (const x of pruefeFundLink(l, config)) fehler.push(`${name}: ${x}`);
  };
  const feedText = lies(join(docs, 'feed', 'funde.json'));
  pruefeAusgabe('feed/funde.json', feedText);
  if (feedText) {
    for (const e of JSON.parse(feedText)) {
      if (e.link && !istGeprueft(nachId.get(e.id), heute, config)) fehler.push(`feed/funde.json ${e.id}: Link ohne gültige Sichtprüfung`);
      if (!e.link && e.link_status !== 'wird_neu_geprueft') fehler.push(`feed/funde.json ${e.id}: link fehlt ohne link_status`);
    }
  }
  pruefeAusgabe('feed/heute.json', lies(join(docs, 'feed', 'heute.json')));
  pruefeAusgabe('heute/index.html', lies(join(docs, 'heute', 'index.html')));
  return fehler;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = lesenJson(join(WURZEL, 'config.json'));
  const funde = lesenJson(join(WURZEL, 'daten', 'funde.json'));
  const fehler = [...pruefeAlle(funde, config), ...pruefeAusgaben({ funde, config })];
  if (fehler.length) {
    for (const z of fehler) console.log(z);
    process.exit(1);
  }
  console.log(`ok: ${funde.length} Funde`);
}
