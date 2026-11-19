// Rückfall ohne KI: füllt leere Textfelder der Funde aus vorlagen/texte.json.
// Aufruf: node werkzeug/texten.mjs --fehlende [--daten <ordner>]
// Kanal und Social bekommen nur den Mittelteil; Anfang, Link-Zeile und Pflichtsatz setzt bauen.mjs.
// Regeln (plan/bauplan.yaml, Paket AE-05), n = Nummer des Fundes (f-0007 → 7):
// - Kanal: drei Fassungen mit formate[(n+i) mod 5] und toene[(n+i) mod 4] für i = 0, 1, 2; Muster n mod 4.
// - Social: zwei Fassungen mit den Mustern n mod 4 und (n+1) mod 4, Hashtags '#funddestages #geschenkidee #kurios'.
// - web.h: Muster n mod 4; länger als textlaengen.web_h → Muster 0. web.p: Muster n mod 2.
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WURZEL, lesenJson, schreibenJson, heuteBerlin } from './lib.mjs';

export const RUECKFALL_HASHTAGS = '#funddestages #geschenkidee #kurios';

const fuellen = (muster, fund) => muster.replaceAll('{titel}', fund.titel).replaceAll('{notiz}', fund.notiz);
const nummer = (fund) => parseInt(String(fund.id).slice(2), 10);

// Liefert die Texte für einen Fund aus den Vorlagen (ohne den Fund zu verändern).
export function texteAusVorlagen(fund, vorlagen, config) {
  const n = nummer(fund);
  const kanal = [0, 1, 2].map((i) => {
    const format = config.formate[(n + i) % config.formate.length];
    const ton = config.toene[(n + i) % config.toene.length];
    return { format, ton, text: fuellen(vorlagen.kanal[format][n % 4], fund) };
  });
  const social = [n % 4, (n + 1) % 4].map((m) => ({ text: fuellen(vorlagen.social[m], fund), hashtags: RUECKFALL_HASHTAGS }));
  let h = fuellen(vorlagen.web_h[n % 4], fund);
  if ([...h].length > config.textlaengen.web_h) h = fuellen(vorlagen.web_h[0], fund);
  const p = fuellen(vorlagen.web_p[n % 2], fund);
  return { web: { h, p }, kanal, social };
}

// Füllt nur leere Felder; gibt die Anzahl geänderter Funde zurück.
export function fuelleFehlende(funde, vorlagen, config, heute = heuteBerlin()) {
  let geaendert = 0;
  for (const fund of funde) {
    const t = fund.texte || (fund.texte = { web: { h: '', p: '' }, kanal: [], social: [] });
    t.web = t.web || { h: '', p: '' };
    const neu = texteAusVorlagen(fund, vorlagen, config);
    let anders = false;
    if (!t.web.h) { t.web.h = neu.web.h; anders = true; }
    if (!t.web.p) { t.web.p = neu.web.p; anders = true; }
    if (!Array.isArray(t.kanal) || t.kanal.length === 0) { t.kanal = neu.kanal; anders = true; }
    if (!Array.isArray(t.social) || t.social.length === 0) { t.social = neu.social; anders = true; }
    if (anders) { fund.geaendert = heute; geaendert++; }
  }
  return geaendert;
}

function argWert(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--fehlende')) {
    console.log('Aufruf: node werkzeug/texten.mjs --fehlende [--daten <ordner>]');
    process.exit(1);
  }
  const ordner = resolve(argWert('--daten') ?? join(WURZEL, 'daten'));
  const config = lesenJson(join(WURZEL, 'config.json'));
  const vorlagen = lesenJson(join(WURZEL, 'vorlagen', 'texte.json'));
  const pfad = join(ordner, 'funde.json');
  const funde = lesenJson(pfad);
  const n = fuelleFehlende(funde, vorlagen, config);
  schreibenJson(pfad, funde);
  console.log(`texte ergänzt: ${n} Funde`);
}
