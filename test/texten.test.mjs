// Tests für texten.mjs und die Mittelteil-Regeln (Paket AE-05).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { WURZEL, lesenJson } from '../werkzeug/lib.mjs';
import { pruefeFund, pruefeText } from '../werkzeug/regeln.mjs';
import { texteAusVorlagen, fuelleFehlende, RUECKFALL_HASHTAGS } from '../werkzeug/texten.mjs';

const config = lesenJson(join(WURZEL, 'config.json'));
const vorlagen = lesenJson(join(WURZEL, 'vorlagen', 'texte.json'));
const ohneTexte = (f) => ({ ...f, texte: { web: { h: '', p: '' }, kanal: [], social: [] } });
const startliste = () => lesenJson(join(WURZEL, 'daten', 'funde.json'));

test('Vorlagen: 5 Formate mit je 4 Kanal-Mustern, 4 Social, 4 web.h, 2 web.p', () => {
  assert.deepEqual(Object.keys(vorlagen.kanal).sort(), [...config.formate].sort());
  for (const f of config.formate) assert.equal(vorlagen.kanal[f].length, 4, f);
  assert.equal(vorlagen.social.length, 4);
  assert.equal(vorlagen.web_h.length, 4);
  assert.equal(vorlagen.web_p.length, 2);
});

test('texten --fehlende auf einem Fund mit leeren Texten erzeugt Texte, die pruefeText bestehen', () => {
  for (const f of startliste()) {
    const leer = ohneTexte(f);
    const funde = [leer];
    assert.equal(fuelleFehlende(funde, vorlagen, config, '2026-11-19'), 1);
    const t = funde[0].texte;
    assert.deepEqual(pruefeText(t.web.h, 'web_h', config), [], `${f.id} web.h`);
    assert.deepEqual(pruefeText(t.web.p, 'web_p', config), [], `${f.id} web.p`);
    for (const k of t.kanal) assert.deepEqual(pruefeText(k.text, 'kanal_mitte', config), [], `${f.id} kanal`);
    for (const s of t.social) assert.deepEqual(pruefeText(s.text, 'social_mitte', config), [], `${f.id} social`);
    assert.deepEqual(pruefeFund(funde[0], config), [], f.id);
  }
});

test('Rückfall-Regeln: Formate, Töne und Muster nach Fundnummer', () => {
  const f7 = startliste().find((f) => f.id === 'f-0007');
  const t = texteAusVorlagen(f7, vorlagen, config);
  assert.deepEqual(t.kanal.map((k) => k.format), [7, 8, 9].map((x) => config.formate[x % 5]));
  assert.deepEqual(t.kanal.map((k) => k.ton), [7, 8, 9].map((x) => config.toene[x % 4]));
  assert.equal(t.kanal[0].text, vorlagen.kanal[config.formate[2]][3].replaceAll('{titel}', f7.titel).replaceAll('{notiz}', f7.notiz));
  assert.deepEqual(t.social.map((s) => s.hashtags), [RUECKFALL_HASHTAGS, RUECKFALL_HASHTAGS]);
  assert.equal(t.web.p, vorlagen.web_p[1].replaceAll('{notiz}', f7.notiz));
});

test('vorhandene Texte bleiben unverändert', () => {
  const f = startliste()[0];
  const funde = [f];
  const vorher = JSON.stringify(f.texte);
  if (f.texte.web.h && f.texte.web.p && f.texte.kanal.length && f.texte.social.length) {
    assert.equal(fuelleFehlende(funde, vorlagen, config), 0);
    assert.equal(JSON.stringify(funde[0].texte), vorher);
  }
});

test('Mittelteil: kein Amazon, kein Link, keine Hashtags', () => {
  assert.ok(pruefeText('Gibt es bei Amazon.', 'kanal_mitte', config).some((x) => x.includes('Amazon')));
  assert.ok(pruefeText('Mehr unter schmetterlingsfutter.de', 'social_mitte', config).some((x) => x.includes('Link')));
  assert.ok(pruefeText('Lustig #kurios', 'kanal_mitte', config).some((x) => x.includes('Hashtag')));
  assert.deepEqual(pruefeText('Kaffee oben, Kekse unten.', 'social_mitte', config), []);
});

test('höchstens ein Emoji und ein Ausrufezeichen je Text', () => {
  assert.ok(pruefeText('Toll! Super!', 'web_p', config).some((x) => x.includes('Ausrufezeichen')));
  assert.ok(pruefeText('Hallo 🦋 und 🎁', 'kanal_mitte', config).some((x) => x.includes('Emoji')));
  assert.deepEqual(pruefeText('Hallo 🦋, schau mal!', 'kanal_mitte', config), []);
});

test('Kanal-Fassungen: Form, erlaubte Werte, verschiedene Formate und Töne', () => {
  const f = startliste()[0];
  const mit = (kanal, social = []) => pruefeFund({ ...f, status: 'vorschlag', texte: { web: { h: 'Kopf', p: 'Absatz.' }, kanal, social } }, config);
  assert.ok(mit(['nur Text']).some((x) => x.startsWith('kanal[0]')));
  assert.ok(mit([{ format: 'gedicht', ton: 'trocken', text: 'A.' }]).some((x) => x.includes("format 'gedicht'")));
  assert.ok(mit([{ format: 'urteil', ton: 'trocken', text: 'A.' }, { format: 'urteil', ton: 'absurd', text: 'B.' }]).some((x) => x.includes('Formate')));
  assert.ok(mit([{ format: 'urteil', ton: 'trocken', text: 'A.' }, { format: 'frage', ton: 'trocken', text: 'B?' }]).some((x) => x.includes('Töne')));
  assert.deepEqual(mit([{ format: 'urteil', ton: 'trocken', text: 'A.' }, { format: 'frage', ton: 'absurd', text: 'B?' }]), []);
});

// Akzeptanz AE-05 und STIL.md Regeln 7 bis 9 für das Startpaket
const anfang = (s, n) => s.trim().split(/\s+/).slice(0, n).join(' ').toLowerCase();
test('Startpaket: jeder Fund hat web.h, web.p, 3 Kanal-Fassungen (3 Formate, 3 Töne) und 2 Social-Fassungen', () => {
  for (const f of startliste().filter((x) => x.paket === 'start')) {
    const t = f.texte;
    assert.ok(t.web.h && t.web.p, `${f.id} web`);
    assert.equal(t.kanal.length, 3, `${f.id} kanal`);
    assert.equal(new Set(t.kanal.map((k) => k.format)).size, 3, `${f.id} Formate`);
    assert.equal(new Set(t.kanal.map((k) => k.ton)).size, 3, `${f.id} Töne`);
    assert.equal(t.social.length, 2, `${f.id} social`);
    assert.equal(new Set(t.kanal.map((k) => anfang(k.text, 1))).size, 3, `${f.id} gleiche Einstiegswörter`);
  }
});

test('Startpaket: Formate und Töne nach STIL.md', () => {
  for (const f of startliste().filter((x) => x.paket === 'start')) {
    for (const k of f.texte.kanal) {
      const id = `${f.id} ${k.format}/${k.ton}`;
      if (k.format === 'urteil') assert.ok(k.text.includes('Braucht das jemand?'), id);
      if (k.format === 'frage') assert.ok(k.text.trim().endsWith('?'), id);
      if (k.format === 'steckbrief') assert.equal(k.text.split('\n').length, 3, id);
      if (k.format === 'papillon-spricht') assert.ok(/Papillon/.test(k.text) && /\b(ich|mich|mir|mein)\b/i.test(k.text) && !/\b(der|die|das) Papillon/i.test(k.text), id);
      if (k.ton === 'trocken') assert.ok(!k.text.includes('!'), id);
    }
  }
});

test('Startpaket: kein Einstieg mehr als zweimal mit denselben drei Wörtern', () => {
  for (const art of ['kanal', 'social']) {
    const zaehler = new Map();
    for (const f of startliste().filter((x) => x.paket === 'start')) {
      for (const e of f.texte[art]) { const a = anfang(e.text, 3); zaehler.set(a, (zaehler.get(a) || 0) + 1); }
    }
    for (const [a, n] of zaehler) assert.ok(n <= 2, `${art}: „${a}“ ${n}×`);
  }
});

test('Startpaket: keine Superlative (STIL.md Regel 3)', () => {
  const ordnung = /^(erst|letzt|nächst)/i; // Ordnungswörter sind keine Superlative
  for (const f of startliste().filter((x) => x.paket === 'start')) {
    const t = f.texte;
    const alle = [t.web.h, t.web.p, ...t.kanal.map((k) => k.text), ...t.social.map((s) => s.text)].join(' ');
    const amSten = alle.match(/(?<!\p{L})am \p{L}+sten(?!\p{L})/giu) || [];
    // nach dem Artikel kleingeschrieben = Adjektiv („die lustigste“), großgeschrieben = Hauptwort („die Schlummertaste“)
    const mitArtikel = (alle.match(/(?<!\p{L})([Dd]er|[Dd]ie|[Dd]as|[Dd]en|[Dd]em|[Dd]es)\s+(\p{Ll}+(st|ßt)e[nrs]?)(?!\p{L})/gu) || [])
      .filter((x) => !ordnung.test(x.split(/\s+/)[1]));
    const werbung = alle.match(/(?<!\p{L})(nummer 1|beste[nrs]?|größte[nrs]?|einzigartig\p{L}*|unschlagbar\p{L}*)(?!\p{L})/giu) || [];
    assert.deepEqual([...amSten, ...mitArtikel, ...werbung], [], f.id);
  }
});

test('Social-Fassungen: 3 bis 5 Hashtags aus der Liste, immer #funddestages', () => {
  const f = startliste()[0];
  const mit = (hashtags) => pruefeFund({ ...f, status: 'vorschlag', texte: { web: { h: '', p: '' }, kanal: [], social: [{ text: 'Kekse.', hashtags }] } }, config);
  assert.ok(mit('#funddestages #kurios').some((x) => x.includes('2 Hashtags')));
  assert.ok(mit('#geschenkidee #kurios #wichteln').some((x) => x.includes('#funddestages fehlt')));
  assert.ok(mit('#funddestages #kurios #rabatt').some((x) => x.includes('#rabatt')));
  assert.deepEqual(mit('#funddestages #kurios #wichteln'), []);
});
