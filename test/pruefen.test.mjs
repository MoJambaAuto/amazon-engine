// Tests für den Regel-Prüfer: je Regel ein Fall, der sie verletzt, und einer, der besteht.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WURZEL, lesenJson, slug, schluessel, amazonLink, heuteBerlin, zeitBerlin } from '../werkzeug/lib.mjs';
import { pruefeFund, pruefeText, pruefeLink } from '../werkzeug/regeln.mjs';
import { pruefeAlle } from '../werkzeug/pruefen.mjs';
import { protokoll } from '../werkzeug/protokoll.mjs';

const config = lesenJson(join(WURZEL, 'config.json'));
const P = config.pflichttexte;

function fund(aenderung = {}) {
  return {
    id: 'f-0001', titel: 'Tasse mit Keksfach', gattung: 'tasse', suchbegriff: 'Tasse mit Keksfach',
    haendler: 'amazon', asin: null, kategorie: 'kueche', preisklasse: 'bis_40',
    anlaesse: ['wichteln'], zielgruppe: ['kollegen'], wichtel_max_cent: 1500,
    notiz: 'Unten im Becher ist ein Fach für Kekse.',
    quelle: { art: 'redaktion', url: '', gesehen_am: '2026-11-14' },
    kriterien: { k1: true, k2: true, k3: true, k4: true, k5: true, k6: true, n1: true, n2: false, n3: false, p3: true, sperre: '' },
    score: { kurios: 0, nachfrage: 0, kauf: 0, grund: 0 },
    status: 'vorschlag', paket: 'start', texte: { web: { h: '', p: '' }, kanal: [], social: [] },
    freigabe: '', angelegt: '2026-11-19', geaendert: '2026-11-19',
    ...aenderung,
  };
}
const kanal = (mitte) => `${P.anfang_kanal}\n\n${mitte}\n\n${P.ende}`;
const social = (mitte, tags = '#funddestages #geschenkidee') => `${P.anfang_social} · ${mitte}\n\n${P.ende}\n\n${tags}`;

test('gültiger Fund besteht', () => {
  assert.deepEqual(pruefeFund(fund(), config), []);
});

test('Pflichtfeld fehlt', () => {
  const f = fund(); delete f.gattung;
  assert.ok(pruefeFund(f, config).some((x) => x.includes("Pflichtfeld 'gattung'")));
});

test('Werte außerhalb der erlaubten Listen', () => {
  const fehler = pruefeFund(fund({ status: 'live', preisklasse: 'teuer', haendler: 'ebay', kategorie: 'tabakwaren' }), config);
  for (const teil of ['status', 'preisklasse', 'haendler', 'kategorie']) assert.ok(fehler.some((x) => x.startsWith(teil)), teil);
  assert.deepEqual(pruefeFund(fund({ status: 'freigegeben', texte: { web: { h: 'Kekse im Keller', p: 'Ein Fach unten im Becher.' }, kanal: [{ format: 'urteil', ton: 'trocken', text: 'Kaffee oben, Kekse unten.' }], social: [] } }), config), []);
});

test('Titel ohne Amazon', () => {
  assert.ok(pruefeFund(fund({ titel: 'Amazon Tasse' }), config).some((x) => x.includes("'Amazon'")));
});

test('Sperr-Wort am Wortanfang trifft, mitten im Wort nicht', () => {
  assert.ok(pruefeFund(fund({ titel: 'Bierkrug lustig' }), config).some((x) => x.includes("Sperr-Wort 'bier'")));
  assert.ok(pruefeFund(fund({ notiz: 'Für den MESSERblock.' }), config).some((x) => x.includes("'messer'")));
  // 'sex' steckt in 'Essex' nicht am Wortanfang, 'wein' in 'Schweine' auch nicht
  assert.deepEqual(pruefeFund(fund({ notiz: 'Aus Essex, für Schweine-Fans.' }), config), []);
});

test('kein Bezug zu anderen Geschäften', () => {
  assert.ok(pruefeFund(fund({ notiz: 'Gibt es auch bei MoJamba.' }), config).some((x) => x.includes("'mojamba'")));
});

test('verbotene Muster in Texten', () => {
  assert.ok(pruefeText('Nur 9,99 € heute', 'web_p', config).some((x) => x.includes('verbotenes Muster')));
  assert.ok(pruefeText('Ein echtes Schnäppchen', 'web_p', config).some((x) => x.includes('verbotenes Muster')));
  assert.ok(pruefeText('Fünf Sterne von mir', 'web_p', config).some((x) => x.includes('verbotenes Muster')));
  assert.ok(pruefeText('Mit Prime morgen da', 'web_p', config).some((x) => x.includes('verbotenes Muster')));
  assert.ok(pruefeText('Hier: bit.ly/abc', 'web_p', config).some((x) => x.includes('verbotenes Muster')));
  assert.deepEqual(pruefeText('Kaffee oben, Kekse unten.', 'web_p', config), []);
});

test('Textlängen', () => {
  assert.ok(pruefeText('x'.repeat(61), 'web_h', config).some((x) => x.includes('zu lang')));
  assert.deepEqual(pruefeText('x'.repeat(60), 'web_h', config), []);
  // Kanal- und Social-Längen gelten für den Mittelteil (STIL.md Regel 6), nicht für den fertigen Text
  assert.ok(pruefeText('y'.repeat(351), 'kanal_mitte', config).some((x) => x.includes('zu lang')));
  assert.deepEqual(pruefeText('y'.repeat(350), 'kanal_mitte', config), []);
  assert.ok(pruefeText('y'.repeat(301), 'social_mitte', config).some((x) => x.includes('zu lang')));
  assert.deepEqual(pruefeText(kanal('y'.repeat(350)), 'kanal', config), []);
});

test('Kanal-Text: Anfang und Pflichtsatz', () => {
  assert.deepEqual(pruefeText(kanal('Kaffee oben, Kekse unten.'), 'kanal', config), []);
  assert.deepEqual(pruefeText(`${P.anfang_rueckblick}\n\nDie drei Funde der Woche.\n\n${P.ende}`, 'kanal', config), []);
  assert.ok(pruefeText(`Kaffee oben.\n\n${P.ende}`, 'kanal', config).some((x) => x.includes('beginnt nicht')));
  assert.ok(pruefeText(`${P.anfang_kanal}\n\nKaffee oben.`, 'kanal', config).some((x) => x.includes('Pflichtsatz')));
});

test('Social-Text: Anfang, Pflichtsatz, höchstens Hashtags danach', () => {
  assert.deepEqual(pruefeText(social('Kekse im Becher.'), 'social', config), []);
  assert.ok(pruefeText(`Kekse im Becher.\n\n${P.ende}`, 'social', config).some((x) => x.includes('beginnt nicht')));
  assert.ok(pruefeText(`${P.anfang_social} · Kekse.\n\n${P.ende}\n\nNoch ein Satz.`, 'social', config).some((x) => x.includes('Pflichtsatz')));
  assert.ok(pruefeText(social('Kekse.', '#a #b #c #d #e #f'), 'social', config).some((x) => x.includes('Hashtags')));
});

test('Texte im Fund werden geprüft', () => {
  const f = fund({ texte: { web: { h: 'Bestseller-Tasse', p: '' }, kanal: ['ohne Anzeige'], social: [] } });
  const fehler = pruefeFund(f, config);
  assert.ok(fehler.some((x) => x.startsWith('web_h')));
  assert.ok(fehler.some((x) => x.startsWith('kanal[0]')));
});

test('freigegebener Fund braucht Texte', () => {
  assert.ok(pruefeFund(fund({ status: 'freigegeben' }), config).some((x) => x.includes('freigegebener Fund')));
});

test('Link passt genau auf link_muster', () => {
  const ok = amazonLink('Tasse mit Keksfach', 'schmetterlingsfutter-21', 0, config);
  assert.equal(ok, 'https://www.amazon.de/s?k=Tasse+mit+Keksfach&tag=schmetterlingsfutter-21');
  assert.deepEqual(pruefeLink(ok, config), []);
  assert.deepEqual(pruefeLink(amazonLink('Wärmflasche Kuscheltier', 'schmetterlingsfutter-21', 1500, config), config), []);
  for (const falsch of [
    'https://amzn.to/abc',
    'https://www.amazon.de/s?k=Tasse&tag=fremd-21',
    'https://www.amazon.de/dp/B000000000?tag=schmetterlingsfutter-21',
    'https://www.amazon.de/s?k=Tasse&tag=schmetterlingsfutter-21&ref=x',
    'http://www.amazon.de/s?k=Tasse&tag=schmetterlingsfutter-21',
  ]) assert.ok(pruefeLink(falsch, config).length > 0, falsch);
});

test('Link ohne Kennung, wenn kennung_aktiv false', () => {
  const aus = { ...config, kennung_aktiv: false };
  const link = amazonLink('Useless Box', 'schmetterlingsfutter-21', 0, aus);
  assert.equal(link, 'https://www.amazon.de/s?k=Useless+Box');
  assert.deepEqual(pruefeLink(link, aus), []);
  assert.ok(pruefeLink('https://www.amazon.de/s?k=Useless+Box&tag=schmetterlingsfutter-21', aus).length > 0);
});

test('Dubletten: id, schluessel, asin', () => {
  const a = fund();
  const b = fund({ id: 'f-0001', titel: 'Keksfach mit Tasse', asin: null });
  const c = fund({ id: 'f-0003', titel: 'Anderes Ding', asin: 'B0ABCDEFGH' });
  const d = fund({ id: 'f-0004', titel: 'Noch ein Ding', asin: 'B0ABCDEFGH' });
  const fehler = pruefeAlle([a, b, c, d], config);
  assert.ok(fehler.some((x) => x.includes('doppelte id')));
  assert.ok(fehler.some((x) => x.includes('doppelter schluessel')));
  assert.ok(fehler.some((x) => x.includes('doppelte asin')));
  assert.deepEqual(pruefeAlle([a, c], config), []);
});

test('Startliste: 30 Funde, alle gültig', () => {
  const funde = lesenJson(join(WURZEL, 'daten', 'funde.json'));
  assert.equal(funde.length, 30);
  assert.deepEqual(pruefeAlle(funde, config), []);
  assert.equal(funde[29].id, 'f-0030');
});

test('lib: slug, schluessel, Datumsformate', () => {
  assert.equal(slug('Wärmflasche im Kuscheltier!'), 'waermflasche-im-kuscheltier');
  assert.equal(schluessel('Tasse mit Keksfach'), schluessel('Keksfach-Tasse'));
  assert.equal(heuteBerlin(new Date('2026-11-18T23:30:00Z')), '2026-11-19');
  assert.equal(zeitBerlin(new Date('2026-07-01T10:05:00Z')), '01.07.2026 12:05');
});

test('protokoll hängt eine JSON-Zeile an', () => {
  const ordner = mkdtempSync(join(tmpdir(), 'ae-protokoll-'));
  try {
    const jetzt = new Date('2026-11-19T08:30:00Z');
    const eintrag = { wer: 'Test', woher: 'test', system: 'amazon-engine', objekt: 'x', aktion: 'geprüft', was: 'y', warum: 'z', rueckgaengig: '-' };
    protokoll(eintrag, { ordner, jetzt });
    const { datei } = protokoll(eintrag, { ordner, jetzt });
    assert.ok(datei.endsWith('2026-11.jsonl'));
    const zeilen = readFileSync(datei, 'utf8').trim().split('\n');
    assert.equal(zeilen.length, 2);
    assert.equal(JSON.parse(zeilen[0]).zeit, '19.11.2026 09:30');
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
});
