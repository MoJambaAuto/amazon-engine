// Sammelt einmal pro Woche Signale für die Auswahl neuer Funde (Paket AE-11):
// Google-Trends-Schlagzeilen für Deutschland (RSS) und die Anlässe der nächsten 45 Tage aus daten/anlass-kalender.json.
// Schreibt daten/signale/<JJJJ-MM-TT>.json. Schlägt der Abruf fehl: eintraege leer, Feld fehler gesetzt, Exit-Code 0.
// Ruft amazon.de nirgends auf.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WURZEL, lesenJson, schreibenJson, heuteBerlin } from './lib.mjs';

export const QUELLE = 'https://trends.google.com/trending/rss?geo=DE';
const TAG_MS = 86400000;

const entities = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();

// Liest Titel und Datum aus einem RSS-Text (nur <item>-Blöcke).
export function rssLesen(xml) {
  const eintraege = [];
  for (const m of String(xml).matchAll(/<item\b[\s\S]*?<\/item>/g)) {
    const titel = (m[0].match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const datum = (m[0].match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
    if (titel && entities(titel)) eintraege.push({ titel: entities(titel), datum: datum ? entities(datum) : '' });
  }
  return eintraege;
}

// Anlässe, die heute laufen oder in den nächsten 45 Tagen beginnen.
export function anlaesseNaechste(kalender, heute, tage = 45) {
  const t0 = Date.parse(heute + 'T00:00:00Z');
  return kalender.filter((a) => Date.parse(a.bis + 'T00:00:00Z') >= t0 && Date.parse(a.von + 'T00:00:00Z') <= t0 + tage * TAG_MS)
    .map((a) => ({ schluessel: a.schluessel, name: a.name, von: a.von, bis: a.bis }));
}

export async function signale({ holen = fetch, heute = heuteBerlin(), daten = join(WURZEL, 'daten') } = {}) {
  const ergebnis = { quelle: QUELLE, abgerufen: new Date().toISOString(), eintraege: [], anlaesse_naechste_45_tage: [] };
  try { ergebnis.anlaesse_naechste_45_tage = anlaesseNaechste(lesenJson(join(daten, 'anlass-kalender.json')), heute); } catch (e) { ergebnis.fehler_kalender = e.message; }
  try {
    const r = await holen(QUELLE, { headers: { 'User-Agent': 'amazon-engine-signale' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    ergebnis.eintraege = rssLesen(await r.text());
    if (!ergebnis.eintraege.length) ergebnis.fehler = 'keine Einträge im Feed';
  } catch (e) {
    ergebnis.fehler = e.message || String(e);
  }
  const pfad = join(daten, 'signale', `${heute}.json`);
  schreibenJson(pfad, ergebnis);
  return { pfad, ergebnis };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { pfad, ergebnis } = await signale();
  console.log(`signale: ${ergebnis.eintraege.length} Einträge, ${ergebnis.anlaesse_naechste_45_tage.length} Anlässe${ergebnis.fehler ? ', Fehler: ' + ergebnis.fehler : ''} → ${pfad}`);
}
