// Prüft alle Funde in daten/funde.json gegen die Regeln.
// Ausgabe je Fehler 'f-0001: <Fehler>'; Exit-Code 1 bei Fehlern, sonst 'ok: <Anzahl> Funde'.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WURZEL, lesenJson, schluessel } from './lib.mjs';
import { pruefeFund } from './regeln.mjs';

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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = lesenJson(join(WURZEL, 'config.json'));
  const funde = lesenJson(join(WURZEL, 'daten', 'funde.json'));
  const fehler = pruefeAlle(funde, config);
  if (fehler.length) {
    for (const z of fehler) console.log(z);
    process.exit(1);
  }
  console.log(`ok: ${funde.length} Funde`);
}
