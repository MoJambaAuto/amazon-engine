// Tests für planen.mjs (Paket AE-04) mit festen Testdaten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WURZEL, lesenJson, schreibenJson } from '../werkzeug/lib.mjs';
import { bewerteAlle } from '../werkzeug/bewerten.mjs';
import { planen, laufen, plusTage, abstand, istSonntag } from '../werkzeug/planen.mjs';

const config = lesenJson(join(WURZEL, 'config.json'));
const MONTAG = '2026-11-23'; // Montag; Sonntag darauf ist der 29.11.2026

let nr = 0;
const GEPRUEFT = { geprueft_am: '2026-11-01', geprueft_von: 'Mo', pruef_beleg: 'Test' };
function fund(gattung, kategorie, grund, aenderung = {}) {
  nr++;
  return {
    id: `f-${String(nr).padStart(4, '0')}`, titel: `Fund ${nr}`, gattung, kategorie, status: 'freigegeben',
    score: { kurios: 0, nachfrage: 0, kauf: 0, grund }, texte: { web: { h: '', p: '' }, kanal: [], social: [] },
    asin: `B0TEST${String(nr).padStart(4, '0')}`, produkt: GEPRUEFT, // AE-13: Test-Funde gelten als geprüft
    ...aenderung,
  };
}
const fassung = (ton, format) => ({ ton, format, text: `${ton} ${format}` });

// Prüft die Regeln aus dem Bauplan auf einem fertigen Plan.
function pruefeRegeln(plan, funde) {
  const nachId = new Map(funde.map((f) => [f.id, f]));
  const tage = Object.entries(plan).filter(([, e]) => e.art === 'fund').map(([d, e]) => ({ d, f: nachId.get(e.fund) }));
  for (const a of tage) {
    for (const b of tage) {
      if (a.d >= b.d) continue;
      const t = abstand(a.d, b.d);
      assert.ok(!(a.f.gattung === b.f.gattung && t < 30), `Gattung ${a.f.gattung} am ${a.d} und ${b.d}`);
      assert.ok(!(a.f.id === b.f.id && t < 180), `Fund ${a.f.id} am ${a.d} und ${b.d}`);
    }
  }
  const alle = Object.keys(plan).sort();
  if (alle.length === 0) return;
  for (let s = alle[0]; s <= alle[alle.length - 1]; s = plusTage(s, 1)) {
    const zaehler = {};
    for (const x of tage) if (abstand(s, x.d) >= 0 && abstand(s, x.d) < 7) zaehler[x.f.kategorie] = (zaehler[x.f.kategorie] || 0) + 1;
    for (const [k, n] of Object.entries(zaehler)) assert.ok(n <= 2, `Kategorie ${k} ${n}× ab ${s}`);
  }
  for (const [d, e] of Object.entries(plan)) {
    if (e.art !== 'rueckblick') continue;
    assert.ok(istSonntag(d), `Rückblick an einem Nicht-Sonntag ${d}`);
  }
}

test('keine Gattung zweimal in 30 Tagen', () => {
  const funde = [fund('a', 'k1', 70), fund('a', 'k2', 69), fund('a', 'k3', 68), fund('b', 'k4', 50), fund('c', 'k5', 50),
    fund('d', 'k6', 50), fund('e', 'k7', 50), fund('f', 'k8', 50), fund('g', 'k9', 50), fund('h', 'k10', 50),
    fund('i', 'k11', 50), fund('j', 'k12', 50), fund('k', 'k13', 50), fund('l', 'k14', 50)];
  const { plan } = planen({ funde, config, heute: MONTAG });
  const gattungA = Object.values(plan).filter((e) => e.art === 'fund' && funde.find((f) => f.id === e.fund).gattung === 'a');
  assert.equal(gattungA.length, 1);
  pruefeRegeln(plan, funde);
});

test('keine Kategorie dreimal in 7 Tagen', () => {
  const funde = [];
  for (let i = 0; i < 10; i++) funde.push(fund(`viel-${i}`, 'kueche', 70));
  for (let i = 0; i < 10; i++) funde.push(fund(`rest-${i}`, `kat-${i}`, 45));
  const { plan } = planen({ funde, config, heute: MONTAG });
  assert.equal(Object.keys(plan).length, 14);
  pruefeRegeln(plan, funde);
  const ersteWoche = [0, 1, 2, 3, 4, 5, 6].map((n) => plan[plusTage(MONTAG, n)]).filter((e) => e.art === 'fund' && funde.find((f) => f.id === e.fund).kategorie === 'kueche');
  assert.ok(ersteWoche.length <= 2);
});

test('Sonntag = Rückblick, wenn davor mindestens 3 Funde liegen', () => {
  const funde = Array.from({ length: 20 }, (_, i) => fund(`g${i}`, `k${i}`, 50 + i));
  const { plan } = planen({ funde, config, heute: MONTAG });
  assert.deepEqual(plan['2026-11-29'], { art: 'rueckblick' });
  assert.deepEqual(plan['2026-12-06'], { art: 'rueckblick' });
  assert.equal(Object.values(plan).filter((e) => e.art === 'rueckblick').length, 2);
});

test('Sonntag ohne 3 Funde davor wird wie ein Wochentag geplant', () => {
  const funde = Array.from({ length: 20 }, (_, i) => fund(`s${i}`, `ks${i}`, 50));
  const { plan } = planen({ funde, config, heute: '2026-11-22' }); // Sonntag, davor nichts
  assert.equal(plan['2026-11-22'].art, 'fund');
});

test('zweiter Lauf am selben Tag ändert plan.json nicht', () => {
  const ordner = mkdtempSync(join(tmpdir(), 'ae04-'));
  try {
    schreibenJson(join(ordner, 'funde.json'), Array.from({ length: 20 }, (_, i) => fund(`w${i}`, `kw${i % 5}`, 50 + (i % 7))));
    schreibenJson(join(ordner, 'plan.json'), {});
    writeFileSync(join(ordner, 'verlauf.jsonl'), '');
    laufen({ ordner, heute: MONTAG, config });
    const erster = readFileSync(join(ordner, 'plan.json'), 'utf8');
    laufen({ ordner, heute: MONTAG, config });
    assert.equal(readFileSync(join(ordner, 'plan.json'), 'utf8'), erster);
    assert.equal(Object.keys(JSON.parse(erster)).length, 14);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
});

test('schon geplante Tage bleiben unverändert', () => {
  const funde = Array.from({ length: 20 }, (_, i) => fund(`p${i}`, `kp${i}`, 50 + i));
  const fest = { art: 'fund', fund: funde[0].id, ton: null, format: null, fassung: null };
  const { plan } = planen({ funde, plan: { [plusTage(MONTAG, 2)]: fest }, config, heute: MONTAG });
  assert.deepEqual(plan[plusTage(MONTAG, 2)], fest);
  assert.equal(Object.values(plan).filter((e) => e.fund === funde[0].id).length, 1);
});

test('höchster Wert gewinnt, bei Gleichstand die kleinere id', () => {
  const a = fund('ga', 'ka', 60), b = fund('gb', 'kb', 60), c = fund('gc', 'kc', 59);
  const { plan } = planen({ funde: [c, b, a], config: { ...config, planung_tage_voraus: 1 }, heute: MONTAG });
  assert.equal(plan[MONTAG].fund, a.id < b.id ? a.id : b.id);
});

test('Ton und Format: Fassung, deren Paar an den zwei Tagen davor nicht vorkam', () => {
  const vorher = fund('gv', 'kv', 50, { status: 'vorschlag' });
  const f = fund('gx', 'kx', 60, { texte: { web: { h: '', p: '' }, social: [], kanal: [fassung('trocken', 'urteil'), fassung('absurd', 'frage'), fassung('pruefend', 'steckbrief')] } });
  const verlauf = [
    { datum: plusTage(MONTAG, -1), art: 'fund', fund: vorher.id, gattung: 'gv', kategorie: 'kv', ton: 'trocken', format: 'urteil', fassung: 0 },
    { datum: plusTage(MONTAG, -2), art: 'fund', fund: 'f-alt', gattung: 'galt', kategorie: 'kalt', ton: 'absurd', format: 'frage', fassung: 1 },
  ];
  const { plan } = planen({ funde: [vorher, f], verlauf, config: { ...config, planung_tage_voraus: 1 }, heute: MONTAG });
  assert.deepEqual(plan[MONTAG], { art: 'fund', fund: f.id, ton: 'pruefend', format: 'steckbrief', fassung: 2 });
});

test('Sperrfrist Fund 180 Tage; Notfall senkt auf 60 Tage und nimmt die am längsten unbenutzte Fassung', () => {
  const f = fund('gn', 'kn', 60, { texte: { web: { h: '', p: '' }, social: [], kanal: [fassung('trocken', 'urteil'), fassung('absurd', 'frage')] } });
  const kurz = [{ datum: plusTage(MONTAG, -10), art: 'fund', fund: f.id, gattung: 'gn', kategorie: 'kn', ton: 'trocken', format: 'urteil', fassung: 0 }];
  assert.deepEqual(planen({ funde: [f], verlauf: kurz, config: { ...config, planung_tage_voraus: 1 }, heute: MONTAG }).plan[MONTAG], { art: 'pause' }); // AE-13: statt leer
  const lang = [{ datum: plusTage(MONTAG, -100), art: 'fund', fund: f.id, gattung: 'gn', kategorie: 'kn', ton: 'trocken', format: 'urteil', fassung: 0 }];
  assert.deepEqual(planen({ funde: [f], verlauf: lang, config: { ...config, planung_tage_voraus: 1 }, heute: MONTAG }).plan[MONTAG],
    { art: 'fund', fund: f.id, ton: 'absurd', format: 'frage', fassung: 1 });
});

test('nur freigegebene Funde; ohne Kandidaten wird der Tag zur Pause; vorrat_tage zählt ungenutzte Freigegebene', () => {
  const funde = [fund('v1', 'kv1', 70, { status: 'vorschlag' }), fund('v2', 'kv2', 50), fund('v3', 'kv3', 50, { status: 'verworfen' })];
  const { plan, vorrat } = planen({ funde, config: { ...config, planung_tage_voraus: 3 }, heute: MONTAG });
  assert.deepEqual(Object.values(plan).filter((e) => e.art === 'fund').map((e) => e.fund), [funde[1].id]);
  assert.equal(Object.values(plan).filter((e) => e.art === 'pause').length, 2);
  assert.equal(vorrat, 0);
  assert.equal(planen({ funde, config, heute: MONTAG, plan: {} }).vorrat, 0);
  assert.equal(planen({ funde: [fund('v4', 'kv4', 50), fund('v5', 'kv5', 50)], config: { ...config, planung_tage_voraus: 1 }, heute: MONTAG }).vorrat, 1);
});

test('Probelauf: Startliste komplett freigegeben ergibt 14 Plan-Tage nach allen Regeln', () => {
  const funde = bewerteAlle(lesenJson(join(WURZEL, 'daten', 'funde.json')), config, '2026-11-19').map((f) => ({ ...f, status: 'freigegeben', produkt: { ...f.produkt, ...GEPRUEFT } }));
  for (const heute of ['2026-11-19', MONTAG, '2026-11-22']) {
    const { plan, vorrat } = planen({ funde, config, heute });
    assert.equal(Object.keys(plan).length, 14, heute);
    pruefeRegeln(plan, funde);
    assert.equal(vorrat, 30 - Object.values(plan).filter((e) => e.art === 'fund').length);
  }
});
