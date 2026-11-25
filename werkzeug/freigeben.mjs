// Übernimmt Mos Antwort auf eine Freigabe-Karte (AE-08, seit AE-14 mit Sichtprüfung).
// Aufruf: node werkzeug/freigeben.mjs <paket> --bezug <Karten-ID> [--ohne f-0007,f-0012] [--nachpruefung f-0003] [--abgelehnt]
//   Mos Ja: alle Vorschläge des Pakets, die er nicht nennt → status 'freigegeben', freigabe { von: 'Mo', am, bezug },
//     produkt.geprueft_am = heute, geprueft_von 'Mo', pruef_beleg = Karten-ID (die Sichtprüfung kommt nur von Mo).
//   --ohne (Ausnahmen, von Mo als unpassend genannt): bleiben 'vorschlag' und bekommen den ersten Ersatz-Kandidaten
//     (wieder ungeprüft); gibt es keinen, werden sie 'verworfen' (Grund in notiz_intern).
//   --nachpruefung: bereits veröffentlichte Funde unter „Bitte neu ansehen“; ohne Ausnahme neues geprueft_am,
//     als Ausnahme wechseln sie auf den Ersatz-Kandidaten (ungeprüft, die Website zeigt dann keinen Knopf).
//   --abgelehnt: alle Vorschläge des Pakets 'verworfen'.
// Danach Regelprüfung über alle Funde; bei Fehlern wird nichts gespeichert (Exit-Code 1). Eine Protokollzeile.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WURZEL, lesenJson, schreibenJson, heuteBerlin } from './lib.mjs';
import { pruefeAlle } from './pruefen.mjs';
import { protokoll } from './protokoll.mjs';

function aufErsatz(f, bezug, am) {
  const ersatz = (f.produkt && Array.isArray(f.produkt.ersatz)) ? f.produkt.ersatz : [];
  if (!ersatz.length) return null;
  return { ...f, asin: ersatz[0], geaendert: am,
    produkt: { ...f.produkt, ersatz: ersatz.slice(1), titel_gesehen: '', geprueft_am: null, geprueft_von: null, pruef_beleg: null,
      hinweis: `Ersatz-Kandidat nach Mos Rückmeldung ${bezug}; vorher ${f.asin}` } };
}

export function freigeben(funde, { paket, bezug, ohne = [], nachpruefung = [], abgelehnt = false, am = heuteBerlin() }) {
  if (!paket || !bezug) throw new Error('paket und --bezug sind nötig');
  const weg = new Set(ohne), nach = new Set(nachpruefung);
  const geprueft = (f) => ({ ...f, produkt: { ...(f.produkt || {}), geprueft_am: am, geprueft_von: 'Mo', pruef_beleg: bezug } });
  let frei = 0, verworfen = 0, ersetzt = 0, nachgeprueft = 0;
  const neu = funde.map((f) => {
    // Nachprüfung: schon freigegebene Funde (auch das Startpaket: freigeben.mjs start --nachpruefung f-0001,…)
    if (nach.has(f.id) && f.status !== 'vorschlag') {
      if (weg.has(f.id)) { const e = aufErsatz(f, bezug, am); if (e) { ersetzt++; return e; } return { ...f, notiz_intern: `Nachprüfung ${bezug}: passt nicht, kein Ersatz` }; }
      nachgeprueft++;
      return { ...geprueft(f), geaendert: am };
    }
    if (f.paket !== paket || f.status !== 'vorschlag') return f;
    if (abgelehnt) { verworfen++; return { ...f, status: 'verworfen', geaendert: am }; }
    if (weg.has(f.id)) {
      const e = aufErsatz(f, bezug, am);
      if (e) { ersetzt++; return e; }
      verworfen++;
      return { ...f, status: 'verworfen', geaendert: am, notiz_intern: `Von Mo als unpassend genannt (${bezug}), kein Ersatz-Kandidat` };
    }
    frei++;
    return { ...geprueft(f), status: 'freigegeben', freigabe: { von: 'Mo', am, bezug }, geaendert: am };
  });
  const bekannt = new Set(funde.filter((f) => f.paket === paket || nach.has(f.id)).map((f) => f.id));
  const unbekannt = [...weg, ...nach].filter((id) => !bekannt.has(id));
  return { funde: neu, frei, verworfen, ersetzt, nachgeprueft, unbekannt };
}

function argWert(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const liste = (name) => (argWert(name) || '').split(',').map((s) => s.trim()).filter(Boolean);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paket = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined;
  const bezug = argWert('--bezug');
  const abgelehnt = process.argv.includes('--abgelehnt');
  const pfad = join(WURZEL, 'daten', 'funde.json');
  const config = lesenJson(join(WURZEL, 'config.json'));
  let r;
  try { r = freigeben(lesenJson(pfad), { paket, bezug, ohne: liste('--ohne'), nachpruefung: liste('--nachpruefung'), abgelehnt }); } catch (e) { console.log(e.message); process.exit(1); }
  if (r.unbekannt.length) console.log('Hinweis: nicht gefunden:', r.unbekannt.join(', '));
  const fehler = pruefeAlle(r.funde, config);
  if (fehler.length) { for (const z of fehler) console.log(z); console.log('nichts gespeichert'); process.exit(1); }
  schreibenJson(pfad, r.funde);
  const was = `${r.frei} freigegeben und geprüft, ${r.ersetzt} auf Ersatz-Kandidat, ${r.verworfen} verworfen, ${r.nachgeprueft} nachgeprüft`;
  protokoll({ wer: 'Claude', woher: 'freigeben.mjs', system: 'amazon-engine', objekt: `Paket ${paket}`,
    aktion: abgelehnt ? 'abgelehnt' : 'freigegeben', was, warum: `Mos Antwort auf ${bezug}`, rueckgaengig: 'git revert' });
  console.log(`Paket ${paket}: ${was}`);
}
