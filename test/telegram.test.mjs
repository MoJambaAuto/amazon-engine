// Tests für telegram.mjs: je Tag höchstens ein Post, ohne Token/Kanal nichts, Fehler ohne Token in der Meldung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WURZEL, lesenJson, schreibenJson } from '../werkzeug/lib.mjs';
import { telegramSenden, telegramText } from '../werkzeug/telegram.mjs';

const config = { ...lesenJson(join(WURZEL, 'config.json')), telegram_kanal: '@papillon_test' };
const TOKEN = '123456:GEHEIM-abc';

function ordner(heute) {
  const o = mkdtempSync(join(tmpdir(), 'ae-tg-'));
  const daten = join(o, 'daten'), docs = join(o, 'docs'), protokollOrdner = join(o, 'protokoll');
  schreibenJson(join(docs, 'feed', 'heute.json'), heute);
  schreibenJson(join(docs, 'feed', 'funde.json'), [{ id: 'f-0004', slug: 'f-0004-taco-halter', asin: 'B0TEST0004' }]);
  return { o, daten, docs, protokollOrdner };
}
const FUND = { datum: '2026-11-26', art: 'fund', fund: { id: 'f-0004', slug: 'f-0004-taco-halter', asin: 'B0TEST0004' }, kanal_text: 'Anzeige · Papillons Fund des Tages\n\nText\n\n👉 Bei Amazon ansehen: https://www.amazon.de/dp/B0TEST0004/ref=nosim?tag=schmetterlingsfutter-21\n\nAls Amazon-Partner verdiene ich an qualifizierten Verkäufen.' };

test('sendet den Kanaltext genau einmal je Tag an den Kanal und merkt sich die Nachricht', async () => {
  const t = ordner(FUND);
  try {
    const aufrufe = [];
    const holen = async (url, opt) => {
      if (opt.method === 'GET') { aufrufe.push({ url, get: true }); return { ok: true, status: 200 }; }
      aufrufe.push({ url, body: JSON.parse(opt.body) }); return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 42 } }) };
    };
    const r = await telegramSenden({ daten: t.daten, docs: t.docs, config, token: TOKEN, holen, protokollOrdner: t.protokollOrdner });
    assert.equal(r.gesendet, true);
    const post = aufrufe.filter((a) => !a.get);
    assert.equal(post.length, 1);
    assert.equal(aufrufe[0].url, 'https://schmetterlingsfutter.de/funde/f-0004-taco-halter/');
    assert.equal(post[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
    assert.deepEqual(post[0].body.chat_id, '@papillon_test');
    assert.ok(post[0].body.text.startsWith('Anzeige · Papillons Fund des Tages'));
    assert.ok(post[0].body.text.includes('👉 Zum Fund: https://schmetterlingsfutter.de/funde/f-0004-taco-halter/'));
    assert.ok(!post[0].body.text.includes('amazon.de') || post[0].body.text.includes('Als Amazon-Partner'));
    assert.ok(!/amazon\.de\//.test(post[0].body.text));
    assert.equal(lesenJson(join(t.daten, 'telegram.json')).gesendet[0].message_id, 42);
    const zweit = await telegramSenden({ daten: t.daten, docs: t.docs, config, token: TOKEN, holen, protokollOrdner: t.protokollOrdner });
    assert.equal(zweit.gesendet, false);
    assert.equal(aufrufe.filter((a) => !a.get).length, 1);
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
    const holen = async (url, opt) => (opt.method === 'GET' ? { ok: true, status: 200 } : { ok: false, status: 401, json: async () => ({ ok: false, description: `Unauthorized ${TOKEN}` }) });
    const r = await telegramSenden({ daten: t.daten, docs: t.docs, config, token: TOKEN, holen });
    assert.equal(r.gesendet, false);
    assert.ok(!r.grund.includes(TOKEN));
    const s = lesenJson(join(t.daten, 'telegram.json'));
    assert.equal(s.gesendet.length, 0);
    assert.ok(!JSON.stringify(s).includes(TOKEN));
  } finally { rmSync(t.o, { recursive: true, force: true }); }
});

test('Fund-Seite noch nicht online: nicht senden, kein Merker (der nächste Lauf versucht es wieder)', async () => {
  const t = ordner(FUND);
  try {
    const holen = async (url, opt) => { if (opt.method === 'GET') return { ok: false, status: 404 }; throw new Error('darf nicht senden'); };
    const r = await telegramSenden({ daten: t.daten, docs: t.docs, config, token: TOKEN, holen });
    assert.equal(r.gesendet, false);
    assert.match(r.grund, /noch nicht online/);
    assert.equal(existsSync(join(t.daten, 'telegram.json')), false);
  } finally { rmSync(t.o, { recursive: true, force: true }); }
});

test('telegramText: Rückblick-Links zeigen auf die Fund-Seiten, unbekannte auf die Übersicht', () => {
  const k = ['Anzeige · Papillons Wochenrückblick', '', '1. A – https://www.amazon.de/dp/B0AAAAAAAA/ref=nosim?tag=schmetterlingsfutter-21',
    '2. B – https://www.amazon.de/dp/B0BBBBBBBB/ref=nosim?tag=schmetterlingsfutter-21'].join('\n');
  const t = telegramText(k, (a) => (a === 'B0AAAAAAAA' ? 'https://schmetterlingsfutter.de/funde/f-0001-a/' : 'https://schmetterlingsfutter.de/funde/'));
  assert.ok(t.includes('1. A – https://schmetterlingsfutter.de/funde/f-0001-a/') && t.includes('2. B – https://schmetterlingsfutter.de/funde/'));
  assert.ok(!t.includes('amazon.de/dp'));
});

test('telegram: Querverweis „Auch bei Telegram“ wird im Telegram-Post zu „Auch bei WhatsApp“ (Mo 28.11.2026)', async () => {
  const { telegramText } = await import('../werkzeug/telegram.mjs');
  const p = { quer_whatsapp: 'Auch bei Telegram: t.me/papillionsfund', quer_telegram: 'Auch bei WhatsApp: https://whatsapp.com/channel/x' };
  const t = telegramText('A\n\nAuch bei Telegram: t.me/papillionsfund\n\nB', () => 'https://schmetterlingsfutter.de/funde/', p);
  assert.ok(t.includes('Auch bei WhatsApp: https://whatsapp.com/channel/x') && !t.includes('t.me/papillionsfund'));
  assert.equal(telegramText('A', () => '', {}), 'A');
});
