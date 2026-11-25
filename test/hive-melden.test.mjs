// Tests für hive-melden.mjs (Paket AE-10): neue Protokollzeilen genau einmal in den Hive, Merker nur bei Erfolg.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { melden, zeilenLesen, hiveZeile } from '../werkzeug/hive-melden.mjs';

const zeile = (tag, id) => ({ zeit: `${tag}.11.2026 05:10`, wer: 'GitHub Actions', woher: 'taeglich.yml', system: 'amazon-engine', objekt: `2026-11-${tag} ${id}`, aktion: 'veröffentlicht', was: 'Testfund', warum: 'H-AMAZON-ENGINE Tageslauf', rueckgaengig: 'git revert' });

function ordnerMit(zeilen) {
  const wurzel = mkdtempSync(join(tmpdir(), 'ae-hive-'));
  const ordner = join(wurzel, 'protokoll');
  mkdirSync(ordner);
  writeFileSync(join(ordner, '2026-11.jsonl'), zeilen.map((z) => JSON.stringify(z)).join('\n') + '\nkaputt{\n', 'utf8');
  return { wurzel, ordner, standDatei: join(wurzel, 'plan', 'hive-stand.json') };
}

test('hiveZeile: 9 Spalten in der Reihenfolge des Änderungsprotokolls (A bis I)', () => {
  assert.deepEqual(hiveZeile(zeile('25', 'f-0001')), ['25.11.2026 05:10', 'GitHub Actions', 'taeglich.yml', 'amazon-engine', '2026-11-25 f-0001', 'veröffentlicht', 'Testfund', 'H-AMAZON-ENGINE Tageslauf', 'git revert']);
});

test('zeilenLesen überspringt kaputte Zeilen', () => {
  const o = ordnerMit([zeile('25', 'f-0001')]);
  assert.equal(zeilenLesen(o.ordner).length, 1);
});

test('melden überträgt jede Zeile genau einmal und holt Ausfälle nach', () => {
  const o = ordnerMit([zeile('25', 'f-0001')]);
  const gesendet = [];
  const ok = (z) => { gesendet.push(...z); return { ok: true }; };
  assert.equal(melden({ ...o, ausfuehren: ok }).neu, 1);
  assert.equal(melden({ ...o, ausfuehren: ok }).neu, 0);
  appendFileSync(join(o.ordner, '2026-11.jsonl'), JSON.stringify(zeile('26', 'f-0002')) + '\n' + JSON.stringify(zeile('27', 'f-0003')) + '\n');
  assert.equal(melden({ ...o, ausfuehren: ok }).neu, 2);
  assert.deepEqual(gesendet.map((z) => z[4]), ['2026-11-25 f-0001', '2026-11-26 f-0002', '2026-11-27 f-0003']);
});

test('melden: scheitert der Hive, bleibt der Merker unverändert (nächster Lauf versucht es erneut)', () => {
  const o = ordnerMit([zeile('25', 'f-0001')]);
  const r = melden({ ...o, ausfuehren: () => ({ ok: false, fehler: 'Netz weg' }) });
  assert.equal(r.ok, false);
  assert.equal(existsSync(o.standDatei), false);
  assert.equal(melden({ ...o, ausfuehren: () => ({ ok: true }) }).neu, 1);
});

test('melden --trocken schreibt nichts', () => {
  const o = ordnerMit([zeile('25', 'f-0001')]);
  const r = melden({ ...o, trocken: true, ausfuehren: () => { throw new Error('darf nicht laufen'); } });
  assert.equal(r.neu, 1);
  assert.equal(existsSync(o.standDatei), false);
});
