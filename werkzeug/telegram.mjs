// Postet den Fund des Tages automatisch in den Telegram-Kanal (Mo 25.11.2026: „Telegram dazu“).
// Läuft im Tageslauf (taeglich.yml) nach dem Bauen. Telegram erlaubt das offiziell über einen Bot (Bot API sendMessage).
// Aufruf: node werkzeug/telegram.mjs   (Token aus der Umgebungsvariable TELEGRAM_BOT_TOKEN, Kanal aus config.telegram_kanal)
//   - sendet docs/feed/heute.json → kanal_text (Anzeige …, Produkt-Link, Pflichtsatz) – je Tag höchstens einmal
//   - Merker und letzter Fehler in daten/telegram.json; Protokollzeile je Post
//   - fehlt Token oder Kanal, gibt es heute nichts zu senden oder schlägt der Versand fehl: Meldung, Exit-Code 0
// Der Token steht nie in Dateien, im Protokoll oder in der Ausgabe.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WURZEL, lesenJson, schreibenJson } from './lib.mjs';
import { protokoll } from './protokoll.mjs';

export async function telegramSenden({ daten = join(WURZEL, 'daten'), docs = join(WURZEL, 'docs'), config = lesenJson(join(WURZEL, 'config.json')),
  token = process.env.TELEGRAM_BOT_TOKEN, holen = fetch, protokollOrdner, jetzt = new Date() } = {}) {
  const kanal = (config.telegram_kanal || '').trim();
  if (!token || !kanal) return { gesendet: false, grund: !kanal ? 'kein Telegram-Kanal in config.json' : 'kein Token (TELEGRAM_BOT_TOKEN)' };
  const heutePfad = join(docs, 'feed', 'heute.json');
  if (!existsSync(heutePfad)) return { gesendet: false, grund: 'feed/heute.json fehlt' };
  const heute = lesenJson(heutePfad);
  if (!heute.kanal_text || !['fund', 'rueckblick'].includes(heute.art)) return { gesendet: false, grund: `heute nichts zu senden (${heute.art ?? 'kein Eintrag'})` };
  const standPfad = join(daten, 'telegram.json');
  const stand = existsSync(standPfad) ? lesenJson(standPfad) : { gesendet: [] };
  if ((stand.gesendet || []).some((g) => g.datum === heute.datum)) return { gesendet: false, grund: `${heute.datum} schon gesendet` };
  let antwort;
  try {
    const r = await holen(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ chat_id: kanal, text: heute.kanal_text, link_preview_options: { is_disabled: false } }) });
    antwort = await r.json();
    if (!r.ok || !antwort || antwort.ok !== true) throw new Error(`Telegram ${r.status}: ${(antwort && antwort.description) || 'kein ok'}`);
  } catch (e) {
    const fehler = String(e.message || e).split(token).join('***').slice(0, 200);
    schreibenJson(standPfad, { ...stand, letzter_fehler: { zeit: jetzt.toISOString(), datum: heute.datum, fehler } });
    return { gesendet: false, grund: fehler, fehler: true };
  }
  const eintrag = { datum: heute.datum, message_id: antwort.result && antwort.result.message_id, zeit: jetzt.toISOString() };
  schreibenJson(standPfad, { gesendet: [...(stand.gesendet || []), eintrag].slice(-400), letzter_fehler: null });
  protokoll({ wer: 'GitHub Actions', woher: 'taeglich.yml', system: 'amazon-engine', objekt: `${heute.datum} ${heute.fund ? heute.fund.id : heute.art}`,
    aktion: 'in Telegram gepostet', was: `Kanal ${kanal}, Nachricht ${eintrag.message_id ?? '?'}`, warum: 'H-AMAZON-ENGINE Telegram-Kanal', rueckgaengig: 'Nachricht im Kanal löschen' },
  { ordner: protokollOrdner, jetzt });
  return { gesendet: true, message_id: eintrag.message_id };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const r = await telegramSenden();
    console.log(r.gesendet ? `telegram: gesendet (Nachricht ${r.message_id})` : `telegram: nicht gesendet – ${r.grund}`);
  } catch (e) {
    console.log('telegram: FEHLER ' + String(e.message || e).split(process.env.TELEGRAM_BOT_TOKEN || '\u0000').join('***'));
  }
}
