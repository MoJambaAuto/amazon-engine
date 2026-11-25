// Tests für den Wochenablauf (Paket AE-11): freigeben.mjs, signale.mjs, Anlass-Kalender.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WURZEL, lesenJson } from '../werkzeug/lib.mjs';
import { freigeben } from '../werkzeug/freigeben.mjs';
import { pruefeAlle } from '../werkzeug/pruefen.mjs';
import { rssLesen, anlaesseNaechste, signale } from '../werkzeug/signale.mjs';

const config = lesenJson(join(WURZEL, 'config.json'));
const startliste = () => lesenJson(join(WURZEL, 'daten', 'funde.json'));
const testPaket = () => startliste().slice(0, 3).map((f, i) => ({ ...f, id: `f-90${i + 1}0`, titel: f.titel + ' Test ' + i, asin: `B0WOCHE00${i + 1}`, status: 'vorschlag', paket: 'KW-2026-49', freigabe: '' }));

test('freigeben: Vorschläge des Pakets werden freigegeben, --ohne verworfen, andere Pakete bleiben', () => {
  const alt = startliste();
  const r = freigeben([...alt, ...testPaket()], { paket: 'KW-2026-49', bezug: 'F-AE-20261129', ohne: ['f-9020'], am: '2026-11-29' });
  assert.equal(r.frei, 2);
  assert.equal(r.verworfen, 1);
  const neu = r.funde.filter((f) => f.paket === 'KW-2026-49');
  assert.deepEqual(neu.map((f) => f.status), ['freigegeben', 'verworfen', 'freigegeben']);
  assert.deepEqual(neu[0].freigabe, { von: 'Mo', am: '2026-11-29', bezug: 'F-AE-20261129' });
  assert.deepEqual(r.funde.slice(0, alt.length), alt);
  assert.deepEqual(pruefeAlle(r.funde, config), []);
});

test('freigeben --abgelehnt verwirft alle Vorschläge; ohne bezug gibt es einen Fehler', () => {
  const r = freigeben(testPaket(), { paket: 'KW-2026-49', bezug: 'F-AE-1', abgelehnt: true });
  assert.equal(r.frei, 0);
  assert.equal(r.verworfen, 3);
  assert.throws(() => freigeben(testPaket(), { paket: 'KW-2026-49' }));
});

test('Anlass-Kalender: gültige Daten, von ≤ bis, Schlüssel aus den Fund-Anlässen', () => {
  const k = lesenJson(join(WURZEL, 'daten', 'anlass-kalender.json'));
  assert.ok(k.length >= 17);
  for (const a of k) {
    assert.match(a.von, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(a.bis, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(a.von <= a.bis, a.schluessel);
  }
  const am29 = anlaesseNaechste(k, '2026-11-29').map((a) => a.schluessel);
  assert.ok(am29.includes('wichteln') && am29.includes('silvester') && am29.includes('valentinstag') === false);
});

test('rssLesen liest Titel und Datum, auch mit CDATA und Entities', () => {
  const xml = '<rss><channel><title>Kanal</title><item><title><![CDATA[Adventskalender & Co]]></title><pubDate>Sun, 29 Nov 2026 03:00:00 +0100</pubDate></item><item><title>Fu&szlig;ball</title></item></channel></rss>';
  const e = rssLesen(xml);
  assert.equal(e.length, 2);
  assert.equal(e[0].titel, 'Adventskalender & Co');
  assert.equal(e[0].datum, 'Sun, 29 Nov 2026 03:00:00 +0100');
});

test('signale: Abruf schlägt fehl → Datei mit Feld fehler und leeren Einträgen, kein Abbruch', async () => {
  const daten = join(mkdtempSync(join(tmpdir(), 'ae-sig-')), 'daten');
  mkdirSync(daten);
  copyFileSync(join(WURZEL, 'daten', 'anlass-kalender.json'), join(daten, 'anlass-kalender.json'));
  const { pfad, ergebnis } = await signale({ daten, heute: '2026-11-29', holen: async () => { throw new Error('offline'); } });
  assert.ok(existsSync(pfad));
  assert.equal(ergebnis.eintraege.length, 0);
  assert.equal(ergebnis.fehler, 'offline');
  assert.ok(ergebnis.anlaesse_naechste_45_tage.length > 0);
  const ok = await signale({ daten, heute: '2026-11-29', holen: async () => ({ ok: true, text: async () => '<item><title>Glühwein</title></item>' }) });
  assert.equal(ok.ergebnis.eintraege[0].titel, 'Glühwein');
  assert.equal(ok.ergebnis.fehler, undefined);
});
