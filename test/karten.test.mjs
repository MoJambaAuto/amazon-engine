// Tests für karten.mjs (Paket AE-12) – ohne echten Browser: laufen() schreibt ein kleines PNG mit der verlangten Größe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WURZEL, lesenJson, schreibenJson } from '../werkzeug/lib.mjs';
import { auswahl, zeileAus, karteHtml, karten, pngGroesse, FORMATE } from '../werkzeug/karten.mjs';

const config = lesenJson(join(WURZEL, 'config.json'));
const vorlage = readFileSync(join(WURZEL, 'assets', 'karte.html'), 'utf8');

// Minimal-PNG: Signatur + IHDR mit Breite/Höhe (reicht für pngGroesse)
function fakePng(breite, hoehe) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(breite, 16); b.writeUInt32BE(hoehe, 20);
  return b;
}
const fakeBrowser = (aufrufe) => (befehl, args) => {
  aufrufe.push(args);
  const png = args.find((a) => a.startsWith('--screenshot=')).slice('--screenshot='.length);
  const [w, h] = args.find((a) => a.startsWith('--window-size=')).slice('--window-size='.length).split(',').map(Number);
  writeFileSync(png, fakePng(w, h));
  return { status: 0 };
};

test('auswahl: 3 Funde des Pakets mit höchstem Grundscore, ohne verworfene', () => {
  const funde = [
    { id: 'f-0001', paket: 'KW-2026-49', status: 'vorschlag', score: { grund: 40 } },
    { id: 'f-0002', paket: 'KW-2026-49', status: 'verworfen', score: { grund: 99 } },
    { id: 'f-0003', paket: 'KW-2026-49', status: 'vorschlag', score: { grund: 70 } },
    { id: 'f-0004', paket: 'KW-2026-49', status: 'vorschlag', score: { grund: 70 } },
    { id: 'f-0005', paket: 'start', status: 'freigegeben', score: { grund: 100 } },
    { id: 'f-0006', paket: 'KW-2026-49', status: 'vorschlag', score: { grund: 10 } },
  ];
  assert.deepEqual(auswahl(funde, 'KW-2026-49').map((f) => f.id), ['f-0003', 'f-0004', 'f-0001']);
});

test('karteHtml: Platzhalter gefüllt, Titel maskiert, Kasten je Format, kein Amazon und kein Preis', () => {
  const f = { titel: 'Tasse <mit> Keksfach', texte: { web: { p: 'Unten ist ein Fach. Kaffee oben.' } } };
  assert.equal(zeileAus(f), 'Unten ist ein Fach.');
  for (const format of FORMATE) {
    const h = karteHtml(vorlage, f, format);
    assert.ok(!h.includes('{{'));
    assert.ok(h.includes('Tasse &lt;mit&gt; Keksfach') && h.includes(format.kasten) && h.includes(`width:${format.breite}px`));
    assert.ok(!/amazon\./i.test(h.replace(/<!--[\s\S]*?-->/g, '')) && !/\d\s?(€|Euro)/.test(h));
  }
});

test('karten: je Fund zwei Bilder in der richtigen Größe und eine Social-Seite mit geprüften Texten ohne Amazon-Link', () => {
  const o = mkdtempSync(join(tmpdir(), 'ae12-'));
  try {
    const daten = join(o, 'daten'), docs = join(o, 'docs');
    schreibenJson(join(daten, 'funde.json'), lesenJson(join(WURZEL, 'daten', 'funde.json')));
    const aufrufe = [];
    const { ziel, eintraege } = karten({ paket: 'start', daten, docs, config, browser: 'browser', laufen: fakeBrowser(aufrufe), vorlage });
    assert.equal(eintraege.length, 3);
    assert.equal(aufrufe.length, 6);
    for (const e of eintraege) {
      assert.deepEqual(pngGroesse(join(ziel, `${e.id}.png`)), { breite: 1080, hoehe: 1350 });
      assert.deepEqual(pngGroesse(join(ziel, `${e.id}-pin.png`)), { breite: 1000, hoehe: 1500 });
      assert.ok(e.text.startsWith('Anzeige') && e.text.includes(config.pflichttexte.social_verweis) && !e.text.includes('amazon.de'));
    }
    const html = readFileSync(join(ziel, 'index.html'), 'utf8');
    assert.ok(html.includes('noindex') && html.includes('Text kopieren') && !html.includes('amazon.de'));
    assert.throws(() => karten({ paket: 'KW-2099-01', daten, docs, config, browser: 'b', laufen: fakeBrowser([]), vorlage }), /keine Funde/);
  } finally { rmSync(o, { recursive: true, force: true }); }
});
