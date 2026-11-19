// Täglicher Lauf: planen → prüfen → bauen, danach eine Protokollzeile, wenn heute ein Fund veröffentlicht wurde.
// Aufruf: node werkzeug/taeglich.mjs (GitHub Actions, .github/workflows/taeglich.yml). Bricht beim ersten Fehler ab.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WURZEL, lesenJson, heuteBerlin } from './lib.mjs';
import { laufen as planen } from './planen.mjs';
import { pruefeAlle } from './pruefen.mjs';
import { bauen } from './bauen.mjs';
import { protokoll } from './protokoll.mjs';

export function taeglich({ daten = join(WURZEL, 'daten'), docs = join(WURZEL, 'docs'), protokollOrdner,
  config = lesenJson(join(WURZEL, 'config.json')), heute = heuteBerlin(), jetzt = new Date() } = {}) {
  const plan = planen({ ordner: daten, heute, config });
  const fehler = pruefeAlle(lesenJson(join(daten, 'funde.json')), config);
  if (fehler.length) throw new Error('Prüfer meldet Fehler:\n' + fehler.join('\n'));
  const ergebnis = bauen({ daten, docs, config, heute, jetzt });
  if (ergebnis.neueZeile && ergebnis.neueZeile.art === 'fund') {
    const fund = lesenJson(join(daten, 'funde.json')).find((f) => f.id === ergebnis.neueZeile.fund);
    protokoll({ wer: 'GitHub Actions', woher: 'taeglich.yml', system: 'amazon-engine', objekt: `${heute} ${fund.id}`,
      aktion: 'veröffentlicht', was: fund.titel, warum: 'H-AMAZON-ENGINE Tageslauf', rueckgaengig: 'git revert' },
    { ordner: protokollOrdner, jetzt });
  }
  return { vorrat: plan.vorrat, ...ergebnis };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { status } = taeglich();
    console.log(`Tageslauf ${status.datum}: ${status.heute_art ?? 'kein Eintrag'} ${status.heute_fund ?? ''} · vorrat_tage ${status.vorrat_tage}${status.warnungen.length ? ' · Warnungen: ' + status.warnungen.join(', ') : ''}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
