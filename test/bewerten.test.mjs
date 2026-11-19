// Tests für bewerten.mjs (Paket AE-04).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { WURZEL, lesenJson } from '../werkzeug/lib.mjs';
import { bewerteFund, bewerteAlle, p2Punkte } from '../werkzeug/bewerten.mjs';

const config = lesenJson(join(WURZEL, 'config.json'));
const startliste = () => lesenJson(join(WURZEL, 'daten', 'funde.json'));

function fund(aenderung = {}, kriterien = {}) {
  return {
    id: 'f-9001', titel: 'Testfund', gattung: 'test', kategorie: 'kueche', preisklasse: 'bis_40', status: 'vorschlag',
    kriterien: { k1: true, k2: true, k3: true, k4: true, k5: true, k6: true, n1: true, n2: false, n3: false, p3: true, sperre: '', ...kriterien },
    score: { kurios: 0, nachfrage: 0, kauf: 0, grund: 0 }, geaendert: '2026-11-01',
    ...aenderung,
  };
}

test('f-0001 ergibt kurios 30, nachfrage 10, kauf 25, grund 65', () => {
  const f1 = startliste().find((f) => f.id === 'f-0001');
  assert.deepEqual(bewerteFund(f1, config), { kurios: 30, nachfrage: 10, kauf: 25, grund: 65 });
});

test('alle 30 Funde der Startliste liegen zwischen 40 und 80, keiner gesperrt', () => {
  const funde = bewerteAlle(startliste(), config, '2026-11-19');
  assert.equal(funde.length, 30);
  for (const f of funde) {
    assert.ok(f.score.grund >= 40 && f.score.grund <= 80, `${f.id}: ${f.score.grund}`);
    assert.notEqual(f.status, 'gesperrt', f.id);
  }
});

test('p2 nach Provision: 8 → 10, 6 → 10, 5,5 → 7, 4 → 7, 3,5 → 4, 3 → 4, 1 → 0', () => {
  assert.deepEqual([8, 6, 5.5, 4, 3.5, 3, 1].map(p2Punkte), [10, 10, 7, 7, 4, 4, 0]);
});

test('Nachfrage zählt n1 10, n2 5, n3 10; p1 nach Preisklasse', () => {
  const s = bewerteFund(fund({ preisklasse: '40_bis_80', kategorie: 'spielwaren' }, { n2: true, n3: true, p3: false }), config);
  assert.equal(s.nachfrage, 25);
  assert.equal(s.kauf, 5 + 4 + 0);
});

test('Sperre setzt Status gesperrt', () => {
  const [f] = bewerteAlle([fund({}, { sperre: 'fremde-marke' })], config, '2026-11-19');
  assert.equal(f.status, 'gesperrt');
});

test('Vorschlag unter der Reserve-Schwelle wird verworfen, Freigegebener nicht', () => {
  const schwach = { k1: false, k2: false, k3: false, k4: false, k5: false, k6: false, n1: false, p3: false };
  const [v, g] = bewerteAlle([fund({}, schwach), fund({ id: 'f-9002', status: 'freigegeben' }, schwach)], config, '2026-11-19');
  assert.ok(v.score.grund < config.schwellen.reserve);
  assert.equal(v.status, 'verworfen');
  assert.equal(g.status, 'freigegeben');
});

test('geaendert nur bei echter Änderung; zweiter Lauf ändert nichts', () => {
  const funde = bewerteAlle([fund()], config, '2026-11-19');
  assert.equal(funde[0].geaendert, '2026-11-19');
  const vorher = JSON.stringify(funde);
  bewerteAlle(funde, config, '2026-11-20');
  assert.equal(JSON.stringify(funde), vorher);
});
