// Überträgt neue Zeilen aus protokoll/*.jsonl in den Hive-Tab Änderungsprotokoll (Paket AE-10).
// Ohne Make: läuft auf Mos PC über das lokale Hive-Programm (Mo 11.11.2026: Hive auf diesem PC ohne Make),
// aufgerufen vom Automatiken-Wächter (täglich 07:20). Fällt der PC aus, holt der nächste Lauf alles nach.
// Merker der schon übertragenen Zeilen: plan/hive-stand.json (plan/ ist nicht im Repo).
// Aufruf: node werkzeug/hive-melden.mjs [--trocken] [--hive <pfad zu hive.py>]
// Endet immer mit Exit-Code 0; Fehler stehen in der Ausgabe.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { WURZEL } from './lib.mjs';

export const HIVE_STANDARD = 'C:/Users/zabai/Documents/MoJamba Redesign/mojamba-app/client/hive.py';
const SPALTEN = ['zeit', 'wer', 'woher', 'system', 'objekt', 'aktion', 'was', 'warum', 'rueckgaengig'];
const MERKEN_HOECHSTENS = 2000;

export const schluessel = (z) => [z.zeit, z.objekt, z.aktion, z.was].join('|');

// Alle Protokollzeilen, älteste zuerst. Kaputte Zeilen werden übersprungen.
export function zeilenLesen(ordner) {
  if (!existsSync(ordner)) return [];
  const zeilen = [];
  for (const datei of readdirSync(ordner).filter((d) => /^\d{4}-\d{2}\.jsonl$/.test(d)).sort()) {
    for (const text of readFileSync(join(ordner, datei), 'utf8').split('\n')) {
      if (!text.trim()) continue;
      try { const z = JSON.parse(text); if (z && z.zeit) zeilen.push(z); } catch { /* übersprungen */ }
    }
  }
  return zeilen;
}

export function neueZeilen(zeilen, gemeldet) {
  const schon = new Set(gemeldet);
  return zeilen.filter((z) => !schon.has(schluessel(z)));
}

export const hiveZeile = (z) => SPALTEN.map((k) => String(z[k] ?? ''));

// ausfuehren(zeilen) muss { ok: true } liefern, sonst bleibt der Merker unverändert (nächster Lauf versucht es erneut).
export function melden({ ordner = join(WURZEL, 'protokoll'), standDatei = join(WURZEL, 'plan', 'hive-stand.json'), ausfuehren, trocken = false } = {}) {
  let stand = { gemeldet: [] };
  try { stand = JSON.parse(readFileSync(standDatei, 'utf8')); } catch { /* erster Lauf */ }
  const neu = neueZeilen(zeilenLesen(ordner), stand.gemeldet || []);
  if (!neu.length) return { neu: 0, ok: true, meldung: 'nichts Neues' };
  if (trocken) return { neu: neu.length, ok: true, meldung: 'trocken', zeilen: neu.map(hiveZeile) };
  const r = ausfuehren(neu.map(hiveZeile));
  if (!r || !r.ok) return { neu: neu.length, ok: false, meldung: (r && r.fehler) || 'Hive-Programm meldet keinen Erfolg' };
  const gemeldet = [...(stand.gemeldet || []), ...neu.map(schluessel)].slice(-MERKEN_HOECHSTENS);
  mkdirSync(join(standDatei, '..'), { recursive: true });
  writeFileSync(standDatei, JSON.stringify({ gemeldet, zuletzt: new Date().toISOString() }, null, 1) + '\n', 'utf8');
  return { neu: neu.length, ok: true, meldung: 'übertragen' };
}

// Ruft hive.py append auf; wiederholt einmal, wenn kein "ok":true zurückkommt.
export function hiveAnhaengen(hive) {
  return (zeilen) => {
    const datei = join(tmpdir(), `amazon-engine-hive-${process.pid}.json`);
    writeFileSync(datei, JSON.stringify(zeilen), 'utf8');
    let letzter = '';
    for (let versuch = 0; versuch < 2; versuch++) {
      const p = spawnSync('python', ['-X', 'utf8', '-I', hive, 'append', 'Änderungsprotokoll!A:I', '--json-file', datei, '--wer', 'Claude (Automatiken-Wächter)'], { encoding: 'utf8', timeout: 60000 });
      letzter = (p.stdout || '') + (p.stderr || '');
      if (/"ok"\s*:\s*true/.test(p.stdout || '')) return { ok: true };
    }
    return { ok: false, fehler: letzter.trim().slice(0, 200) || 'keine Antwort' };
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--hive');
  const hive = i > 0 ? process.argv[i + 1] : HIVE_STANDARD;
  try {
    const r = melden({ ausfuehren: hiveAnhaengen(hive), trocken: process.argv.includes('--trocken') });
    console.log(`hive-melden: ${r.neu} neue Zeile(n), ${r.ok ? r.meldung : 'FEHLER: ' + r.meldung}`);
    if (r.zeilen) for (const z of r.zeilen) console.log('  ' + z.join(' | '));
  } catch (e) {
    console.log('hive-melden: FEHLER ' + e.message);
  }
}
