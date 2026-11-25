// Tests für bauen.mjs und taeglich.mjs (Paket AE-06) in einem Wegwerf-Ordner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WURZEL, lesenJson, schreibenJson } from '../werkzeug/lib.mjs';
import { pruefeText } from '../werkzeug/regeln.mjs';
import { bauen, vorschau } from '../werkzeug/bauen.mjs';
import { taeglich, schonGelaufen } from '../werkzeug/taeglich.mjs';
import { plusTage } from '../werkzeug/planen.mjs';

const config = lesenJson(join(WURZEL, 'config.json'));
const P = config.pflichttexte;
const HEUTE = '2026-11-25'; // Mittwoch
const JETZT = new Date('2026-11-25T04:10:00Z');

function ordner({ freigegeben = [], plan = {}, verlauf = [] } = {}) {
  const o = mkdtempSync(join(tmpdir(), 'ae06-'));
  const daten = join(o, 'daten');
  const funde = lesenJson(join(WURZEL, 'daten', 'funde.json')).map((f) => (({ ...f, status: freigegeben.includes(f.id) ? 'freigegeben' : 'vorschlag' })));
  schreibenJson(join(daten, 'funde.json'), funde);
  schreibenJson(join(daten, 'plan.json'), plan);
  writeFileSync(join(daten, 'verlauf.jsonl'), verlauf.map((v) => JSON.stringify(v) + '\n').join(''));
  return { o, daten, docs: join(o, 'docs'), protokoll: join(o, 'protokoll'), weg: () => rmSync(o, { recursive: true, force: true }) };
}
const verlaufZeilen = (daten) => readFileSync(join(daten, 'verlauf.jsonl'), 'utf8').split('\n').filter(Boolean).map((z) => JSON.parse(z));
function alleDateien(dir, basis = dir) {
  if (!existsSync(dir)) return {};
  const aus = {};
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) Object.assign(aus, alleDateien(p, basis));
    else aus[p.slice(basis.length)] = readFileSync(p, 'utf8');
  }
  return aus;
}
const zaehle = (text, teil) => text.split(teil).length - 1;

test('bauen zweimal am selben Tag: identische Dateien und nur eine Verlaufszeile', () => {
  const t = ordner({ freigegeben: ['f-0001'], plan: { [HEUTE]: { art: 'fund', fund: 'f-0001', ton: 'begeistert', format: 'mini-geschichte', fassung: 1 } } });
  try {
    bauen({ daten: t.daten, docs: t.docs, config, heute: HEUTE, jetzt: JETZT });
    const erst = alleDateien(t.docs);
    bauen({ daten: t.daten, docs: t.docs, config, heute: HEUTE, jetzt: JETZT });
    assert.deepEqual(alleDateien(t.docs), erst);
    const v = verlaufZeilen(t.daten);
    assert.equal(v.length, 1);
    assert.deepEqual(v[0], { datum: HEUTE, art: 'fund', fund: 'f-0001', gattung: 'gag-kleidung', kategorie: 'bekleidung', ton: 'begeistert', format: 'mini-geschichte', fassung: 1 });
  } finally { t.weg(); }
});

test('Fund-Tag: Kanal- und Social-Text mit Pflichtteilen, Feed ohne Link und Kennung', () => {
  const t = ordner({ freigegeben: ['f-0001'], plan: { [HEUTE]: { art: 'fund', fund: 'f-0001', ton: 'absurd', format: 'frage', fassung: 2 } } });
  try {
    bauen({ daten: t.daten, docs: t.docs, config, heute: HEUTE, jetzt: JETZT });
    const h = lesenJson(join(t.docs, 'feed', 'heute.json'));
    const f1 = lesenJson(join(t.daten, 'funde.json'))[0];
    assert.ok(h.kanal_text.startsWith(P.anfang_kanal) && h.kanal_text.endsWith(P.ende));
    assert.ok(h.kanal_text.includes(f1.texte.kanal[2].text));
    assert.ok(h.kanal_text.includes('https://www.amazon.de/s?k=Notfall+Unterhose+Dose&tag=schmetterlingsfutter-21'));
    assert.ok(h.social_text.startsWith(P.anfang_social + ' · ' + f1.texte.social[0].text));
    assert.ok(h.social_text.endsWith(f1.texte.social[0].hashtags));
    assert.deepEqual(pruefeText(h.kanal_text, 'kanal', config), []);
    assert.deepEqual(pruefeText(h.social_text, 'social', config), []);
    const feed = readFileSync(join(t.docs, 'feed', 'funde.json'), 'utf8');
    assert.equal(JSON.parse(feed).length, 1);
    assert.ok(!feed.includes('amazon.de') && !feed.includes('schmetterlingsfutter-21'));
    assert.equal(JSON.parse(feed)[0].slug, 'f-0001-notfall-unterhose-in-der-dose');
    const html = readFileSync(join(t.docs, 'heute', 'index.html'), 'utf8');
    for (const s of ['<h1>Heute posten</h1>', 'Text kopieren', 'Für Instagram und Facebook', 'noindex', 'Mittwoch, 25.11.2026']) assert.ok(html.includes(s), s);
    assert.ok(!/<script[^>]+src=/.test(html), 'keine Fremd-Skripte');
    // ein Knopf: kopieren und Kanal öffnen; Startbildschirm-Symbol
    assert.ok(html.includes(`data-dann="${config.kanal_url}">Kopieren und Kanal öffnen</button>`));
    assert.ok(html.includes('<link rel="manifest" href="manifest.webmanifest">'));
    const m = lesenJson(join(t.docs, 'heute', 'manifest.webmanifest'));
    assert.equal(m.name, 'Heute posten');
    assert.equal(m.icons.length, 2);
    for (const i of m.icons) assert.ok(existsSync(join(WURZEL, 'docs', i.src.replace('../', ''))), i.src);
  } finally { t.weg(); }
});

test('Rückblick-Text enthält genau drei Links', () => {
  const funde = ['f-0001', 'f-0002', 'f-0003', 'f-0004'];
  const verlauf = funde.map((id, i) => ({ datum: plusTage(HEUTE, -(i + 1)), art: 'fund', fund: id, gattung: 'g' + i, kategorie: 'k' + i, ton: null, format: null, fassung: 0 }));
  const t = ordner({ freigegeben: funde, plan: { [HEUTE]: { art: 'rueckblick' } }, verlauf });
  try {
    const { kanal, social } = bauen({ daten: t.daten, docs: t.docs, config, heute: HEUTE, jetzt: JETZT });
    assert.equal(zaehle(kanal, 'https://www.amazon.de/s?k='), 3);
    assert.ok(kanal.startsWith(P.anfang_rueckblick) && kanal.includes('Die drei Funde der Woche:') && kanal.endsWith(P.ende));
    assert.equal(social, null);
    assert.deepEqual(pruefeText(kanal, 'kanal', config), []);
  } finally { t.weg(); }
});

test('ohne freigegebene Funde: Warnung „Heute kein Fund geplant“ und leerer Feed', () => {
  const t = ordner();
  try {
    bauen({ daten: t.daten, docs: t.docs, config, heute: HEUTE, jetzt: JETZT });
    const s = lesenJson(join(t.docs, 'status.json'));
    assert.ok(s.warnungen.includes('Heute kein Fund geplant'));
    assert.ok(s.warnungen.includes(`Vorrat unter ${config.vorrat_warnung_tage} Tagen`));
    assert.equal(s.datum, HEUTE);
    assert.equal(s.letzter_lauf, JETZT.toISOString());
    assert.deepEqual(lesenJson(join(t.docs, 'feed', 'funde.json')), []);
    assert.equal(readFileSync(join(t.docs, 'robots.txt'), 'utf8').includes('Disallow: /heute/'), true);
    assert.ok(existsSync(join(t.docs, '.nojekyll')));
    assert.ok(readFileSync(join(t.docs, 'heute', 'index.html'), 'utf8').includes('Heute ist kein Fund geplant.'));
  } finally { t.weg(); }
});

test('Prüffehler bricht ab, ohne docs oder Verlauf zu ändern', () => {
  const t = ordner({ freigegeben: ['f-0001'], plan: { [HEUTE]: { art: 'fund', fund: 'f-0001', ton: null, format: null, fassung: 0 } } });
  try {
    const funde = lesenJson(join(t.daten, 'funde.json'));
    funde[0].texte.kanal[0].text = 'Ein echtes Schnäppchen.';
    schreibenJson(join(t.daten, 'funde.json'), funde);
    assert.throws(() => bauen({ daten: t.daten, docs: t.docs, config, heute: HEUTE, jetzt: JETZT }), /Prüfung fehlgeschlagen/);
    assert.equal(existsSync(t.docs), false);
    assert.equal(verlaufZeilen(t.daten).length, 0);
  } finally { t.weg(); }
});

test('Vorschau eines Pakets: alle Funde mit Texten und „Link testen“', () => {
  const t = ordner();
  try {
    const { anzahl, pfad } = vorschau({ paket: 'start', daten: t.daten, docs: t.docs, config });
    const html = readFileSync(pfad, 'utf8');
    assert.equal(anzahl, 30);
    assert.equal(zaehle(html, '>Link testen</a>'), 30);
    assert.ok(html.includes('noindex') && html.includes('Grundscore'));
    assert.throws(() => vorschau({ paket: 'KW-2099-01', daten: t.daten, docs: t.docs, config }), /keine Funde/);
  } finally { t.weg(); }
});

test('taeglich: plant, baut, protokolliert einmal; zweiter Lauf ändert nichts', () => {
  const alle = lesenJson(join(WURZEL, 'daten', 'funde.json')).map((f) => f.id);
  const t = ordner({ freigegeben: alle });
  try {
    const a = taeglich({ daten: t.daten, docs: t.docs, protokollOrdner: t.protokoll, config, heute: HEUTE, jetzt: JETZT });
    assert.equal(a.status.heute_art, 'fund');
    assert.equal(Object.keys(lesenJson(join(t.daten, 'plan.json'))).length, 14);
    const prot = () => readFileSync(join(t.protokoll, '2026-11.jsonl'), 'utf8').split('\n').filter(Boolean);
    assert.equal(prot().length, 1);
    assert.equal(JSON.parse(prot()[0]).aktion, 'veröffentlicht');
    const docs = alleDateien(t.docs);
    taeglich({ daten: t.daten, docs: t.docs, protokollOrdner: t.protokoll, config, heute: HEUTE, jetzt: JETZT });
    assert.equal(prot().length, 1);
    assert.equal(verlaufZeilen(t.daten).length, 1);
    assert.deepEqual(alleDateien(t.docs), docs);
  } finally { t.weg(); }
});

test('Ersatzlauf: schonGelaufen erkennt, ob heute schon gebaut wurde', () => {
  const t = ordner();
  try {
    assert.equal(schonGelaufen({ docs: t.docs, heute: HEUTE }), false);
    bauen({ daten: t.daten, docs: t.docs, config, heute: HEUTE, jetzt: JETZT });
    assert.equal(schonGelaufen({ docs: t.docs, heute: HEUTE }), true);
    assert.equal(schonGelaufen({ docs: t.docs, heute: plusTage(HEUTE, 1) }), false);
  } finally { t.weg(); }
});

test('Kopierseite enthält die Texte aller geplanten Tage; der Browser wählt den heutigen', () => {
  const alle = lesenJson(join(WURZEL, 'daten', 'funde.json')).map((f) => f.id);
  const t = ordner({ freigegeben: alle });
  try {
    taeglich({ daten: t.daten, docs: t.docs, protokollOrdner: t.protokoll, config, heute: HEUTE, jetzt: JETZT });
    const html = readFileSync(join(t.docs, 'heute', 'index.html'), 'utf8');
    const block = html.match(/<script type="application\/json" id="tage">([\s\S]*?)<\/script>/);
    assert.ok(block, 'Datenblock fehlt');
    const D = JSON.parse(block[1]);
    const plan = lesenJson(join(t.daten, 'plan.json'));
    assert.equal(D.gebaut, HEUTE);
    assert.equal(D.tage.length, Object.keys(plan).length);
    for (const tag of D.tage) {
      assert.ok(tag.kanal.startsWith(tag.art === 'fund' ? P.anfang_kanal : P.anfang_rueckblick) && tag.kanal.endsWith(P.ende), tag.datum);
      assert.deepEqual(pruefeText(tag.kanal, 'kanal', config), [], tag.datum);
      if (tag.art === 'fund') assert.deepEqual(pruefeText(tag.social, 'social', config), [], tag.datum);
    }
    assert.ok(html.includes("timeZone:'Europe/Berlin'"));
    assert.ok(!block[1].includes('</'), 'kein </ im Datenblock');
  } finally { t.weg(); }
});

test('verpasster Tag wird beim nächsten Lauf nachgetragen und protokolliert', () => {
  const gestern = plusTage(HEUTE, -1);
  const plan = { [gestern]: { art: 'fund', fund: 'f-0002', ton: null, format: null, fassung: 0 }, [HEUTE]: { art: 'fund', fund: 'f-0003', ton: null, format: null, fassung: 0 } };
  const t = ordner({ freigegeben: ['f-0002', 'f-0003'], plan });
  try {
    taeglich({ daten: t.daten, docs: t.docs, protokollOrdner: t.protokoll, config, heute: HEUTE, jetzt: JETZT });
    assert.deepEqual(verlaufZeilen(t.daten).map((v) => [v.datum, v.fund]), [[gestern, 'f-0002'], [HEUTE, 'f-0003']]);
    const prot = readFileSync(join(t.protokoll, '2026-11.jsonl'), 'utf8').split('\n').filter(Boolean).map((z) => JSON.parse(z).aktion);
    assert.deepEqual(prot, ['nachgetragen', 'veröffentlicht']);
    assert.equal(lesenJson(join(t.docs, 'feed', 'funde.json')).length, 2);
  } finally { t.weg(); }
});
