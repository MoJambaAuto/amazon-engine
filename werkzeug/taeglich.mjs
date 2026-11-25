// Täglicher Lauf: planen → prüfen → bauen, danach eine Protokollzeile, wenn heute ein Fund veröffentlicht wurde.
// Aufruf: node werkzeug/taeglich.mjs (GitHub Actions, .github/workflows/taeglich.yml). Bricht beim ersten Fehler ab.
//         node werkzeug/taeglich.mjs --nur-wenn-fehlt  (Ersatzläufe: tut nichts, wenn heute schon gebaut wurde)
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WURZEL, lesenJson, heuteBerlin } from './lib.mjs';
import { laufen as planen } from './planen.mjs';
import { pruefeAlle } from './pruefen.mjs';
import { bauen } from './bauen.mjs';
import { protokoll } from './protokoll.mjs';
import { inhalteLauf } from './inhalte.mjs';

export function taeglich({ daten = join(WURZEL, 'daten'), docs = join(WURZEL, 'docs'), protokollOrdner,
  config = lesenJson(join(WURZEL, 'config.json')), heute = heuteBerlin(), jetzt = new Date() } = {}) {
  const plan = planen({ ordner: daten, heute, config });
  const fehler = pruefeAlle(lesenJson(join(daten, 'funde.json')), config);
  if (fehler.length) throw new Error('Prüfer meldet Fehler:\n' + fehler.join('\n'));
  const ergebnis = bauen({ daten, docs, config, heute, jetzt });
  // je neu in den Verlauf übernommenem Fund eine Protokollzeile (auch für nachgetragene Tage)
  const funde = lesenJson(join(daten, 'funde.json'));
  for (const z of ergebnis.neueZeilen.filter((x) => x.art === 'fund')) {
    const fund = funde.find((f) => f.id === z.fund);
    protokoll({ wer: 'GitHub Actions', woher: 'taeglich.yml', system: 'amazon-engine', objekt: `${z.datum} ${fund.id}`,
      aktion: z.datum === heute ? 'veröffentlicht' : 'nachgetragen', was: fund.titel, warum: 'H-AMAZON-ENGINE Tageslauf', rueckgaengig: 'git revert' },
    { ordner: protokollOrdner, jetzt });
  }
  // Futter-Engine Paket 2: täglich wechselnde Inhalte. Ein Fehler hier stoppt den Fund des Tages nie.
  let inhalte = null;
  if (existsSync(join(daten, 'inhalte'))) {
    try { inhalte = inhalteLauf({ daten, docs, heute, jetzt }); } catch (e) { inhalte = { fehler: e.message }; }
  }
  return { vorrat: plan.vorrat, ...ergebnis, inhalte };
}

// true, wenn docs/status.json schon den heutigen Tag trägt (dann ist der Tageslauf erledigt).
export function schonGelaufen({ docs = join(WURZEL, 'docs'), heute = heuteBerlin() } = {}) {
  const pfad = join(docs, 'status.json');
  if (!existsSync(pfad)) return false;
  try { return lesenJson(pfad).datum === heute; } catch { return false; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes('--nur-wenn-fehlt') && schonGelaufen()) {
      console.log(`Tageslauf ${heuteBerlin()} schon erledigt – nichts zu tun.`);
      process.exit(0);
    }
    const { status, inhalte } = taeglich();
    console.log(`Tageslauf ${status.datum}: ${status.heute_art ?? 'kein Eintrag'} ${status.heute_fund ?? ''} · vorrat_tage ${status.vorrat_tage}${status.warnungen.length ? ' · Warnungen: ' + status.warnungen.join(', ') : ''}`);
    if (inhalte) console.log(inhalte.fehler ? `Inhalte FEHLER: ${inhalte.fehler}` : `Inhalte ${inhalte.heute.datum}: ${['frage', 'piek', 'wissen', 'quiz'].map((a) => `${a} ${inhalte.heute[a]?.id ?? '–'}`).join(' · ')}${inhalte.warnungen.length ? ' · ' + inhalte.warnungen.join('; ') : ''}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
