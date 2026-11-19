// Bewertet alle Funde: Punkte aus den Ja/Nein-Kriterien, Status nach Sperre und Schwelle.
// Aufruf: node werkzeug/bewerten.mjs [--daten <ordner>]
// Punktwerte aus plan/bauplan.yaml, Abschnitt bewertung (stehen nicht in config.json).
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WURZEL, lesenJson, schreibenJson, heuteBerlin } from './lib.mjs';

export const BEWERTUNG = {
  kurios: { kriterien: ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'], je_ja: 5 },
  nachfrage: { n1: 10, n2: 5, n3: 10 },
  p1_preisklasse: { bis_40: 10, '40_bis_80': 5, ueber_80: 0 },
  p3: 5,
  tageszuschlag: { gattung_30_tage_frei: 10, kategorie_7_tage_max_1: 5, ton_und_format_anders_als_letzte_2_tage: 5 },
};

// p2 nach Provision in Prozent: ab 6 = 10 · 4 bis 5,5 = 7 · 3 bis 3,5 = 4 · darunter (bis 1) = 0
export function p2Punkte(prozent) {
  if (prozent >= 6) return 10;
  if (prozent >= 4) return 7;
  if (prozent >= 3) return 4;
  return 0;
}

export function bewerteFund(fund, config) {
  const k = fund.kriterien || {};
  const ja = (n) => k[n] === true;
  const kurios = BEWERTUNG.kurios.je_ja * BEWERTUNG.kurios.kriterien.filter(ja).length;
  const nachfrage = Object.entries(BEWERTUNG.nachfrage).reduce((s, [n, p]) => s + (ja(n) ? p : 0), 0);
  const prov = config.provision_prozent;
  const prozent = prov[fund.kategorie] ?? prov.sonstiges ?? 0;
  const kauf = (BEWERTUNG.p1_preisklasse[fund.preisklasse] ?? 0) + p2Punkte(prozent) + (ja('p3') ? BEWERTUNG.p3 : 0);
  return { kurios, nachfrage, kauf, grund: kurios + nachfrage + kauf };
}

// Schreibt score und Status in die Funde (verändert die Liste). geaendert nur bei echter Änderung.
export function bewerteAlle(funde, config, heute = heuteBerlin()) {
  for (const fund of funde) {
    const score = bewerteFund(fund, config);
    let status = fund.status;
    if (fund.kriterien && fund.kriterien.sperre) status = 'gesperrt';
    else if (status === 'vorschlag' && score.grund < config.schwellen.reserve) status = 'verworfen';
    const alt = JSON.stringify([fund.score, fund.status]);
    if (alt !== JSON.stringify([score, status])) {
      fund.score = score;
      fund.status = status;
      fund.geaendert = heute;
    }
  }
  return funde;
}

function argWert(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ordner = resolve(argWert('--daten') ?? join(WURZEL, 'daten'));
  const config = lesenJson(join(WURZEL, 'config.json'));
  const pfad = join(ordner, 'funde.json');
  const funde = bewerteAlle(lesenJson(pfad), config);
  schreibenJson(pfad, funde);
  const breite = Math.max(...funde.map((f) => f.titel.length));
  console.log(`id      ${'titel'.padEnd(breite)}  grund  status`);
  for (const f of funde) console.log(`${f.id}  ${f.titel.padEnd(breite)}  ${String(f.score.grund).padStart(5)}  ${f.status}`);
}
