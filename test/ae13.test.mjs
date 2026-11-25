// Tests für Paket AE-13: Link direkt zum Produkt, Pflicht zur Sichtprüfung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WURZEL, lesenJson, schreibenJson, produktLink, pruefLink, amazonLink } from '../werkzeug/lib.mjs';
import { istGeprueft, pruefeFund, pruefeFundLink } from '../werkzeug/regeln.mjs';
import { planen } from '../werkzeug/planen.mjs';
import { bauen } from '../werkzeug/bauen.mjs';
import { pruefeAusgaben } from '../werkzeug/pruefen.mjs';

const config = lesenJson(join(WURZEL, 'config.json'));
const HEUTE = '2026-11-25';
const geprueft = (am) => ({ geprueft_am: am, geprueft_von: 'Mo', pruef_beleg: 'Test' });
// Testdaten: echte Funde ohne Sichtprüfung (seit 25.11.2026 sind die echten Funde von Mo geprüft)
const ungeprueft = () => lesenJson(join(WURZEL, 'daten', 'funde.json')).map((f) => ({ ...f, produkt: { ...f.produkt, geprueft_am: null, geprueft_von: null, pruef_beleg: null } }));

test('produktLink: Produkt-Muster mit Kennung; ungültige asin wirft', () => {
  assert.equal(produktLink('B0DGPL4SGB', 'schmetterlingsfutter-21', config), 'https://www.amazon.de/dp/B0DGPL4SGB/ref=nosim?tag=schmetterlingsfutter-21');
  assert.equal(pruefLink('B0DGPL4SGB', config), 'https://www.amazon.de/dp/B0DGPL4SGB');
  assert.equal(produktLink('B0DGPL4SGB', 'x', { ...config, kennung_aktiv: false }), 'https://www.amazon.de/dp/B0DGPL4SGB/ref=nosim');
  for (const a of [null, '', 'b0dgpl4sgb', 'B0DGPL4SG', 'B0DGPL4SGB1']) assert.throws(() => produktLink(a, 'k', config), /asin/);
  assert.deepEqual(pruefeFundLink(produktLink('B0DGPL4SGB', 'schmetterlingsfutter-21', config), config), []);
  assert.ok(pruefeFundLink(amazonLink('Notfall Unterhose', 'schmetterlingsfutter-21', 0, config), config)[0].startsWith('Suchlink'));
  assert.ok(pruefeFundLink('https://www.amazon.de/dp/B0DGPL4SGB/ref=nosim?tag=fremd-21', config).length === 1);
});

test('istGeprueft: ohne Datum nein, frisch ja, am Tag 90 ja, am Tag 91 nein, vor der Prüfung nein', () => {
  const f = { asin: 'B0DGPL4SGB', produkt: { geprueft_am: null, geprueft_von: null } };
  assert.equal(istGeprueft(f, HEUTE, config), false);
  const g = { asin: 'B0DGPL4SGB', produkt: geprueft('2026-11-25') };
  assert.equal(istGeprueft(g, '2026-11-25', config), true);
  assert.equal(istGeprueft(g, '2027-02-23', config), true); // Tag 90
  assert.equal(istGeprueft(g, '2027-02-24', config), false); // Tag 91
  assert.equal(istGeprueft(g, '2026-11-24', config), false);
  assert.equal(istGeprueft({ asin: 'B0DGPL4SGB', produkt: { geprueft_am: '2026-11-25', geprueft_von: null } }, HEUTE, config), false);
  assert.equal(istGeprueft({ asin: null, produkt: geprueft('2026-11-25') }, HEUTE, config), false);
});

test('Regeln: freigegeben braucht asin; geprueft_am nicht in der Zukunft und nur mit geprueft_von', () => {
  const f = lesenJson(join(WURZEL, 'daten', 'funde.json'))[0];
  assert.ok(pruefeFund({ ...f, asin: null }, config).includes('freigegebener Fund braucht eine gültige asin'));
  assert.ok(pruefeFund({ ...f, produkt: { ...f.produkt, geprueft_am: '2099-01-01', geprueft_von: 'Mo' } }, config).includes('produkt.geprueft_am liegt in der Zukunft'));
  assert.ok(pruefeFund({ ...f, produkt: { ...f.produkt, geprueft_am: '2026-11-25', geprueft_von: null } }, config).includes('produkt.geprueft_am ohne geprueft_von'));
  assert.ok(pruefeFund({ ...f, produkt: { ...f.produkt, preis: 9 } }, config).some((x) => x.includes("unbekanntes Feld 'preis'")));
});

test('Startliste: alle 30 Funde haben asin und produkt, niemand ist ungeprüft als geprüft eingetragen', () => {
  const funde = lesenJson(join(WURZEL, 'daten', 'funde.json'));
  for (const f of funde) {
    assert.match(f.asin, /^[A-Z0-9]{10}$/, f.id);
    assert.ok(f.produkt && f.produkt.gefunden_ueber === 'websuche', f.id);
    if (f.produkt.geprueft_am) assert.equal(f.produkt.geprueft_von, 'Mo', f.id);
    assert.ok(!f.texte.web.p.includes('Auswahl'), f.id);
  }
});

test('planen wählt keinen ungeprüften Fund; ohne geprüfte Funde nur Pausen; Vorrat zählt nur Geprüfte', () => {
  const funde = lesenJson(join(WURZEL, 'daten', 'funde.json')).map((f) => ({ ...f, status: 'freigegeben', produkt: { ...f.produkt, geprueft_am: null, geprueft_von: null } }));
  const r = planen({ funde, config, heute: HEUTE });
  assert.ok(Object.values(r.plan).every((e) => e.art === 'pause'));
  assert.equal(r.vorrat, 0);
  funde[3].produkt = geprueft('2026-11-24');
  const r2 = planen({ funde, config, heute: HEUTE });
  assert.deepEqual(Object.values(r2.plan).filter((e) => e.art === 'fund').map((e) => e.fund), [funde[3].id]);
  // geplanter, ungeprüfter Fund ab morgen wird neu berechnet
  const r3 = planen({ funde, plan: { '2026-11-26': { art: 'fund', fund: funde[7].id } }, config, heute: HEUTE });
  assert.notEqual(r3.plan['2026-11-26'].fund, funde[7].id);
});

function alleTexte(dir) {
  let s = '';
  for (const n of readdirSync(dir)) { const p = join(dir, n); s += statSync(p).isDirectory() ? alleTexte(p) : readFileSync(p, 'utf8'); }
  return s;
}

test('bauen: keine Fund-Ausgabe enthält amazon.de/s?; ungeprüfter veröffentlichter Fund ohne Link; Pause ohne Amazon-Link', () => {
  const o = mkdtempSync(join(tmpdir(), 'ae13-'));
  try {
    const daten = join(o, 'daten'), docs = join(o, 'docs');
    const funde = ungeprueft().map((f) => ({ ...f, produkt: { ...f.produkt, ...(f.id === 'f-0002' ? geprueft('2026-11-20') : {}) } }));
    schreibenJson(join(daten, 'funde.json'), funde);
    schreibenJson(join(daten, 'plan.json'), { [HEUTE]: { art: 'fund', fund: 'f-0002', ton: null, format: null, fassung: 0 }, '2026-11-26': { art: 'pause' } });
    writeFileSync(join(daten, 'verlauf.jsonl'), JSON.stringify({ datum: '2026-11-24', art: 'fund', fund: 'f-0001', gattung: 'x', kategorie: 'y', ton: null, format: null, fassung: 0 }) + '\n');
    bauen({ daten, docs, config, heute: HEUTE, jetzt: new Date('2026-11-25T04:10:00Z') });
    const alles = alleTexte(docs);
    assert.ok(!alles.includes('amazon.de/s?'));
    const feed = lesenJson(join(docs, 'feed', 'funde.json'));
    const f1 = feed.find((e) => e.id === 'f-0001'), f2 = feed.find((e) => e.id === 'f-0002');
    assert.equal(f1.link, null);
    assert.equal(f1.link_status, 'wird_neu_geprueft');
    assert.equal(f2.link, produktLink(funde[1].asin, 'schmetterlingsfutter-21', config));
    assert.equal(lesenJson(join(docs, 'feed', 'heute.json')).fund.link, f2.link);
    const html = readFileSync(join(docs, 'heute', 'index.html'), 'utf8');
    assert.ok(html.includes(produktLink(funde[1].asin, config.kennungen.kanal, config)));
    const s = lesenJson(join(docs, 'status.json'));
    assert.equal(s.warten_auf_sichtpruefung, 29);
    assert.deepEqual(pruefeAusgaben({ daten, docs, funde, config, heute: HEUTE }), []);
    // Pause-Tag: heute.json art pause, Kopierseite mit Verweis auf die Funde-Seite, kein Amazon-Link
    schreibenJson(join(daten, 'plan.json'), { '2026-11-26': { art: 'pause' } });
    bauen({ daten, docs, config, heute: '2026-11-26', jetzt: new Date('2026-11-26T04:10:00Z') });
    assert.equal(lesenJson(join(docs, 'feed', 'heute.json')).art, 'pause');
    assert.ok(readFileSync(join(docs, 'heute', 'index.html'), 'utf8').includes('Heute kein neuer Fund. Alle bisherigen findest du unter schmetterlingsfutter.de/funde.'));
    assert.ok(lesenJson(join(docs, 'status.json')).warnungen.includes('Heute Pause: kein Fund mit gültiger Sichtprüfung'));
  } finally { rmSync(o, { recursive: true, force: true }); }
});

test('pruefeAusgaben: meldet Suchlinks und ungeprüfte Funde im Plan', () => {
  const o = mkdtempSync(join(tmpdir(), 'ae13p-'));
  try {
    const daten = join(o, 'daten'), docs = join(o, 'docs');
    const funde = ungeprueft();
    schreibenJson(join(daten, 'plan.json'), { '2026-11-27': { art: 'fund', fund: 'f-0003' } });
    writeFileSync(join(daten, 'verlauf.jsonl'), '');
    schreibenJson(join(docs, 'feed', 'funde.json'), [{ id: 'f-0001', link: 'https://www.amazon.de/s?k=X&tag=schmetterlingsfutter-21' }]);
    const f = pruefeAusgaben({ daten, docs, funde, config, heute: HEUTE });
    assert.ok(f.some((x) => x.includes('plan.json 2026-11-27')));
    assert.ok(f.some((x) => x.includes("Suchlink 'amazon.de/s?'")));
  } finally { rmSync(o, { recursive: true, force: true }); }
});
