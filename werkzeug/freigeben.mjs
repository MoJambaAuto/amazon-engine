// Übernimmt Mos Freigabe eines Pakets (Paket AE-08, genutzt vom Wochenablauf KURATIEREN.md Schritt 2).
// Aufruf: node werkzeug/freigeben.mjs <paket> --bezug <Karten-ID> [--ohne f-0007,f-0012] [--abgelehnt]
//   Alle Funde des Pakets mit status 'vorschlag' → 'freigegeben' mit freigabe = { von: 'Mo', am, bezug };
//   die mit --ohne genannten → 'verworfen'. Mit --abgelehnt werden alle Vorschläge des Pakets 'verworfen'.
// Danach Regelprüfung über alle Funde; bei Fehlern wird nichts gespeichert (Exit-Code 1). Eine Protokollzeile.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WURZEL, lesenJson, schreibenJson, heuteBerlin } from './lib.mjs';
import { pruefeAlle } from './pruefen.mjs';
import { protokoll } from './protokoll.mjs';

export function freigeben(funde, { paket, bezug, ohne = [], abgelehnt = false, am = heuteBerlin() }) {
  if (!paket || !bezug) throw new Error('paket und --bezug sind nötig');
  const weg = new Set(ohne);
  let frei = 0, verworfen = 0;
  const neu = funde.map((f) => {
    if (f.paket !== paket || f.status !== 'vorschlag') return f;
    if (abgelehnt || weg.has(f.id)) { verworfen++; return { ...f, status: 'verworfen', geaendert: am }; }
    frei++;
    return { ...f, status: 'freigegeben', freigabe: { von: 'Mo', am, bezug }, geaendert: am };
  });
  const unbekannt = [...weg].filter((id) => !funde.some((f) => f.id === id && f.paket === paket));
  return { funde: neu, frei, verworfen, unbekannt };
}

function argWert(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paket = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined;
  const bezug = argWert('--bezug');
  const ohne = (argWert('--ohne') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const abgelehnt = process.argv.includes('--abgelehnt');
  const pfad = join(WURZEL, 'daten', 'funde.json');
  const config = lesenJson(join(WURZEL, 'config.json'));
  let r;
  try { r = freigeben(lesenJson(pfad), { paket, bezug, ohne, abgelehnt }); } catch (e) { console.log(e.message); process.exit(1); }
  if (r.unbekannt.length) console.log('Hinweis: nicht im Paket gefunden:', r.unbekannt.join(', '));
  const fehler = pruefeAlle(r.funde, config);
  if (fehler.length) { for (const z of fehler) console.log(z); console.log('nichts gespeichert'); process.exit(1); }
  schreibenJson(pfad, r.funde);
  protokoll({ wer: 'Claude', woher: 'freigeben.mjs', system: 'amazon-engine', objekt: `Paket ${paket}`,
    aktion: abgelehnt ? 'abgelehnt' : 'freigegeben', was: `${r.frei} freigegeben, ${r.verworfen} verworfen`,
    warum: `Mos Freigabe ${bezug}`, rueckgaengig: 'git revert' });
  console.log(`Paket ${paket}: ${r.frei} freigegeben, ${r.verworfen} verworfen`);
}
