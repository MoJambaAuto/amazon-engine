// Hängt eine Protokollzeile (JSON) an protokoll/<JJJJ-MM>.jsonl an.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WURZEL, heuteBerlin, zeitBerlin } from './lib.mjs';

export function protokoll({ wer, woher, system, objekt, aktion, was, warum, rueckgaengig }, { ordner, jetzt } = {}) {
  const datum = jetzt ?? new Date();
  const ziel = ordner ?? join(WURZEL, 'protokoll');
  mkdirSync(ziel, { recursive: true });
  const zeile = { zeit: zeitBerlin(datum), wer, woher, system, objekt, aktion, was, warum, rueckgaengig };
  const datei = join(ziel, `${heuteBerlin(datum).slice(0, 7)}.jsonl`);
  appendFileSync(datei, JSON.stringify(zeile) + '\n', 'utf8');
  return { datei, zeile };
}
