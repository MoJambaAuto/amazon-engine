// Tests für telegram.mjs: je Tag höchstens ein Post, ohne Token/Kanal nichts, Fehler ohne Token in der Meldung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WURZEL, lesenJson, schreibenJson } from '../werkzeug/lib.mjs';
import { telegramSenden } from '../werkzeug/telegram.mjs';

const config = { ...lesenJson(join(WURZEL, 'config.json')), telegram_kanal: '@papillon_test' };
const TOKEN = '123456:GEHEIM-abc';

function ordner(heute) {
  const o = mkdtempSync(join(tmpdir(), 'ae-tg-'));
  const daten = join(o, 'daten'), docs = join(o, 'docs'), protokollOrdner = join(o, 'protokoll');
  schreibenJson(join(docs, 'feed', 'heute.json'), heute);
  return { o, daten, docs, protokollOrdner };
}
const FUND = { datum: '2026-11-26', art: 'fund', fund: { id: 'f-0004' }, kanal_text: 'Anzeige · Papillons Fund des Tages\n\nText\n\n👉 Bei Amazon ansehen: https://www.amazon.de/dp/B0TEST0004/ref=nosim?tag=schmetterlingsfutter-21\n\nAls Amazon-Partner verdiene ich an qualifizierten Verkäufen.' };

test('sendet den Kanaltext genau einmal je Tag an den Kanal und merkt sich die Nachricht', async () => {
  const t = ordner(FUND);
  try {
    const aufrufe = [];
    const holen = async (url, opt) => { aufrufe.push({ url, body: JSON.parse(opt.body) }); return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 42 } }) }; };
    const r = await telegramSenden({ daten: t.daten, docs: t.docs, config, token: TOKEN, holen, protokollOrdner: t.protokollOrdner });
    assert.equal(r.gesendet, true);
    assert.equal(aufrufe.length, 1);
    assert.equal(aufrufe[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
    assert.deepEqual(aufrufe[0].body.chat_id, '@papillon_test');
    assert.equal(aufrufe[0].body.text, FUND.kanal_text);
    assert.equal(lesenJson(join(t.daten, 'telegram.json')).gesendet[0].message_id, 42);
    const zweit = await telegramSenden({ daten: t.daten, docs: t.docs, config, token: TOKEN, holen, protokollOrdner: t.protokollOrdner });
    assert.equal(zweit.gesendet, false);
    assert.equal(aufrufe.length, 1);
    assert.ok(existsSync(join(t.protokollOrdner)));
  } finally { rmSync(t.o, { recursive: true, force: true }); }
});

test('ohne Token, ohne Kanal oder an einem Pausentag wird nichts gesendet', async () => {
  const holen = async () => { throw new Error('darf nicht laufen'); };
  const t = ordner(FUND);
  const p = ordner({ datum: '2026-11-27', art: 'pause', fund: null, kanal_text: null });
  try {
    assert.equal((await telegramSenden({ daten: t.daten, docs: t.docs, config, token: '', holen })).gesendet, false);
    assert.equal((await telegramSenden({ daten: t.daten, docs: t.docs, config: { ...config, telegram_kanal: '' }, token: TOKEN, holen })).gesendet, false);
    assert.match((await telegramSenden({ daten: p.daten, docs: p.docs, config, token: TOKEN, holen })).grund, /nichts zu senden/);
  } finally { rmSync(t.o, { recursive: true, force: true }); rmSync(p.o, { recursive: true, force: true }); }
});

test('Fehler von Telegram: kein Merker, Fehler gespeichert, Token taucht nicht auf', async () => {
  const t = ordner(FUND);
  try {
    const holen = async () => ({ ok: false, status: 401, json: async () => ({ ok: false, description: `Unauthorized ${TOKEN}` }) });
    const r = await telegramSenden({ daten: t.daten, docs: t.docs, config, token: TOKEN, holen });
    assert.equal(r.gesendet, false);
    assert.ok(!r.grund.includes(TOKEN));
    const s = lesenJson(join(t.daten, 'telegram.json'));
    assert.equal(s.gesendet.length, 0);
    assert.ok(!JSON.stringify(s).includes(TOKEN));
  } finally { rmSync(t.o, { recursive: true, force: true }); }
});
