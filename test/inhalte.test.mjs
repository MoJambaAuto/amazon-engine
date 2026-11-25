// Tests für werkzeug/inhalte.mjs (Futter-Engine Paket 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WURZEL, lesenJson } from '../werkzeug/lib.mjs';
import { anlaesse, ostern, ersterAdvent, muttertag, planeInhalte, pruefeVorrat, inhalteLauf, plusTage, ARTEN } from '../werkzeug/inhalte.mjs';

test('Feiertage werden richtig berechnet', () => {
  assert.equal(ostern(2026), '2026-04-05');
  assert.equal(ostern(2027), '2027-03-28');
  assert.equal(ersterAdvent(2026), '2026-11-29');
  assert.equal(ersterAdvent(2027), '2027-11-28');
  assert.equal(muttertag(2026), '2026-05-10');
  assert.deepEqual(anlaesse('2026-11-25'), ['wichteln', 'herbst']);
  assert.ok(anlaesse('2026-12-24').includes('weihnachten'));
  assert.ok(anlaesse('2026-12-01').includes('advent'));
  assert.ok(anlaesse('2027-02-14').includes('valentinstag'));
  assert.ok(anlaesse('2026-05-14').includes('vatertag')); // Himmelfahrt 2026
  assert.ok(anlaesse('2026-12-31').includes('silvester'));
  assert.ok(!anlaesse('2026-12-28').includes('wichteln'));
});

const vorratEcht = () => Object.fromEntries(ARTEN.map((a) => [a, lesenJson(join(WURZEL, 'daten', 'inhalte', `${a}.json`))]));

test('echter Vorrat besteht die Prüfung', () => {
  assert.deepEqual(pruefeVorrat(vorratEcht()), []);
});

test('Plan: ein Jahr ohne Lücke, Anlass-Inhalte nur im Fenster, keine Wiederholung innerhalb der Sperre', () => {
  const vorrat = vorratEcht();
  let plan = {};
  const start = '2026-11-25';
  for (let i = 0; i < 365; i++) plan = planeInhalte({ vorrat, plan, heute: plusTage(start, i) });
  const nachId = Object.fromEntries(ARTEN.map((a) => [a, new Map(vorrat[a].map((e) => [e.id, e]))]));
  const tage = Object.keys(plan).filter((d) => d >= start && d < plusTage(start, 365));
  assert.equal(tage.length, 365);
  for (const a of ARTEN) {
    const zuletzt = new Map();
    const frei = vorrat[a].filter((e) => e.status === 'freigegeben').length;
    for (const d of tage) {
      const id = plan[d][a];
      assert.ok(id, `${a} fehlt am ${d}`);
      const e = nachId[a].get(id);
      if (e.anlaesse.length) assert.ok(e.anlaesse.some((x) => anlaesse(d).includes(x)), `${id} außerhalb Anlass am ${d}`);
      if (e.monate) assert.ok(e.monate.includes(+d.slice(5, 7)), `${id} im falschen Monat am ${d}`);
      const feiertag = ['12-24', '12-25', '12-26', '12-31', '01-01', '02-14'].includes(d.slice(5)); // dort bewusst Wiederholung erlaubt
      if (zuletzt.has(id) && !feiertag) {
        const abst = (Date.parse(d) - Date.parse(zuletzt.get(id))) / 864e5;
        assert.ok(abst >= Math.min(30, Math.floor(frei * 0.5)), `${a} ${id} schon nach ${abst} Tagen wieder`);
      }
      zuletzt.set(id, d);
    }
  }
});

test('am Feiertag selbst kommt immer ein Anlass-Inhalt', () => {
  const vorrat = vorratEcht();
  let plan = {};
  for (let i = 0; i < 120; i++) plan = planeInhalte({ vorrat, plan, heute: plusTage('2026-11-25', i) });
  for (const [d, x] of [['2026-12-24', 'weihnachten'], ['2026-12-31', 'silvester'], ['2027-02-14', 'valentinstag']]) {
    for (const a of ['frage', 'piek']) {
      const e = vorrat[a].find((v) => v.id === plan[d][a]);
      assert.ok(e.anlaesse.includes(x), `${a} am ${d} ohne ${x}: ${e.t}`);
    }
  }
});

test('einmal geplante Tage ändern sich nicht', () => {
  const vorrat = vorratEcht();
  const p1 = planeInhalte({ vorrat, heute: '2026-12-01' });
  const p2 = planeInhalte({ vorrat, plan: JSON.parse(JSON.stringify(p1)), heute: '2026-12-05' });
  for (const d of Object.keys(p1)) assert.deepEqual(p2[d], p1[d]);
});

test('Lauf schreibt heute.json und naechste-tage.json', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'inh-'));
  try {
    mkdirSync(join(tmp, 'daten', 'inhalte'), { recursive: true });
    for (const a of ARTEN) writeFileSync(join(tmp, 'daten', 'inhalte', `${a}.json`), readFileSync(join(WURZEL, 'daten', 'inhalte', `${a}.json`)));
    const r = inhalteLauf({ daten: join(tmp, 'daten'), docs: join(tmp, 'docs'), heute: '2026-12-24', jetzt: new Date('2026-12-24T04:00:00Z') });
    const h = JSON.parse(readFileSync(join(tmp, 'docs', 'feed', 'inhalte', 'heute.json'), 'utf8'));
    const n = JSON.parse(readFileSync(join(tmp, 'docs', 'feed', 'inhalte', 'naechste-tage.json'), 'utf8'));
    assert.equal(h.datum, '2026-12-24');
    assert.equal(n.tage.length, 14);
    for (const a of ARTEN) assert.ok(h[a] && h[a].id, `${a} fehlt`);
    assert.ok(h.piek.t && h.piek.c);
    assert.ok([0, 1].includes(h.quiz.w));
    assert.equal(r.heute.datum, '2026-12-24');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('Prüfer findet kaputte Einträge', () => {
  const f = pruefeVorrat({ frage: [{ id: 'fr-0001', t: 'Kauf das bei Amazon für 5 Euro', status: 'freigegeben', anlaesse: ['ostern'] }, { id: 'fr-0001', t: 'x', status: 'neu', anlaesse: ['xmas'] }],
    piek: [{ id: 'pk-0001', c: 'falsch', t: 'Tu etwas.', status: 'freigegeben' }], wissen: [{ id: 'wi-0001', t: 'Fakt', status: 'freigegeben' }], quiz: [] });
  assert.ok(f.some((x) => x.includes('Sperrwort')));
  assert.ok(f.some((x) => x.includes('doppelt')));
  assert.ok(f.some((x) => x.includes('status')));
  assert.ok(f.some((x) => x.includes("'xmas'")));
  assert.ok(f.some((x) => x.includes('Kategorie')));
  assert.ok(f.some((x) => x.includes('ohne Quelle')));
});
