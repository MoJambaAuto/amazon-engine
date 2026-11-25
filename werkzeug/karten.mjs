// Bildkarten für Instagram/Facebook und Pinterest je Paket (Paket AE-12).
// Aufruf: node werkzeug/karten.mjs <paket> [--browser <pfad>]
//   Wählt die 3 Funde des Pakets mit dem höchsten score.grund, füllt assets/karte.html und lässt einen Browser ohne
//   Fenster (Chrome, Chromium oder Edge) je Fund zwei PNG fotografieren:
//     docs/social/<paket>/<id>.png      1080 × 1350 (Instagram/Facebook, Kasten „Link im WhatsApp-Kanal“)
//     docs/social/<paket>/<id>-pin.png  1000 × 1500 (Pinterest, Kasten „schmetterlingsfutter.de/funde“)
//   Dazu docs/social/<paket>/index.html (noindex) mit Bild, Social-Text und Kopier-Knopf je Karte.
// Keine Fotos, keine Preise, kein Amazon-Link auf den Karten und in den Social-Texten. Ruft amazon.de nie auf.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { WURZEL, lesenJson, slug } from './lib.mjs';
import { pruefeText } from './regeln.mjs';
import { socialText, seite, KOPIEREN } from './bauen.mjs';

export const FORMATE = [
  { endung: '', breite: 1080, hoehe: 1350, kasten: 'Link im WhatsApp-Kanal' },
  { endung: '-pin', breite: 1000, hoehe: 1500, kasten: 'schmetterlingsfutter.de/funde' },
];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Die 3 Funde des Pakets mit dem höchsten score.grund (ohne verworfene und gesperrte), bei Gleichstand kleinere id.
export function auswahl(funde, paket, n = 3) {
  return funde.filter((f) => f.paket === paket && !['verworfen', 'gesperrt'].includes(f.status))
    .sort((a, b) => ((b.score?.grund ?? 0) - (a.score?.grund ?? 0)) || (a.id < b.id ? -1 : 1)).slice(0, n);
}

// Erster Satz des Web-Textes als Zeile unter dem Titel.
export function zeileAus(fund) {
  const p = String(fund.texte?.web?.p ?? '').trim();
  const m = p.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : p).trim();
}

export function karteHtml(vorlage, fund, format) {
  return vorlage.replaceAll('{{BREITE}}', String(format.breite)).replaceAll('{{HOEHE}}', String(format.hoehe))
    .replace('{{TITEL}}', esc(fund.titel)).replace('{{ZEILE}}', esc(zeileAus(fund))).replace('{{KASTEN}}', esc(format.kasten));
}

// Browser ohne Fenster: KARTEN_BROWSER, sonst bekannte Pfade (Linux-Runner: google-chrome; Mos PC: Edge).
export function browserPfad() {
  if (process.env.KARTEN_BROWSER) return process.env.KARTEN_BROWSER;
  const kandidaten = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
  return kandidaten.find((p) => existsSync(p)) || null;
}

// PNG-Größe aus dem IHDR-Block lesen.
export function pngGroesse(pfad) {
  const b = readFileSync(pfad);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${pfad}: kein PNG`);
  return { breite: b.readUInt32BE(16), hoehe: b.readUInt32BE(20) };
}

// Fotografiert eine HTML-Datei. laufen(befehl, argumente) ist austauschbar (Tests).
export function fotografieren({ browser, htmlDatei, png, breite, hoehe, laufen = spawnSync }) {
  const profil = mkdtempSync(join(tmpdir(), 'karten-profil-'));
  try {
    const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--no-first-run',
      `--user-data-dir=${profil}`, `--window-size=${breite},${hoehe}`, '--virtual-time-budget=8000', `--screenshot=${png}`,
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []), pathToFileURL(htmlDatei).href];
    const r = laufen(browser, args, { encoding: 'utf8', timeout: 90000 });
    if (r && r.status && r.status !== 0) throw new Error(`Browser-Fehler ${r.status}: ${(r.stderr || '').slice(0, 200)}`);
  } finally { rmSync(profil, { recursive: true, force: true }); }
}

export function socialSeite(paket, eintraege, config) {
  const karten = eintraege.map((e, i) => `<section class="fund"><h2>${esc(e.titel)}</h2>
<img src="${esc(e.bild)}" alt="Bildkarte: ${esc(e.titel)}" width="1080" height="1350" style="width:100%;height:auto;border-radius:12px">
<p class="klein">Pinterest-Karte: <a href="${esc(e.pin)}">${esc(e.pin)}</a></p>
<pre class="box" id="s${i}">${esc(e.text)}</pre>
<button class="knopf zwei" type="button" data-kopiere="s${i}">Text kopieren</button></section>`);
  return seite(`Social ${paket} · Papillons Fund des Tages`,
    `<h1>Social-Karten ${esc(paket)}</h1>\n<p class="datum">${eintraege.length} Karten · Bild lange drücken oder Rechtsklick zum Speichern</p>\n${karten.join('\n')}`,
    config, KOPIEREN);
}

export function karten({ paket, daten = join(WURZEL, 'daten'), docs = join(WURZEL, 'docs'), config = lesenJson(join(WURZEL, 'config.json')),
  browser = browserPfad(), laufen = spawnSync, vorlage = readFileSync(join(WURZEL, 'assets', 'karte.html'), 'utf8') }) {
  if (!/^[A-Za-z0-9-]+$/.test(paket || '')) throw new Error('Paketname fehlt oder ist ungültig');
  const funde = auswahl(lesenJson(join(daten, 'funde.json')), paket);
  if (!funde.length) throw new Error(`Paket ${paket}: keine Funde`);
  if (!browser) throw new Error('Kein Browser gefunden (KARTEN_BROWSER setzen)');
  const ziel = join(docs, 'social', paket);
  mkdirSync(ziel, { recursive: true });
  const fehler = [];
  const arbeit = mkdtempSync(join(tmpdir(), 'karten-'));
  const eintraege = [];
  try {
    for (const f of funde) {
      for (const format of FORMATE) {
        const html = karteHtml(vorlage, f, format);
        if (/amazon\./i.test(html.replace(/<!--[\s\S]*?-->/g, ''))) fehler.push(`${f.id}: Amazon auf der Karte`);
        const htmlDatei = join(arbeit, `${f.id}${format.endung}.html`);
        writeFileSync(htmlDatei, html, 'utf8');
        fotografieren({ browser, htmlDatei, png: join(ziel, `${f.id}${format.endung}.png`), breite: format.breite, hoehe: format.hoehe, laufen });
      }
      const text = socialText(f, config);
      fehler.push(...pruefeText(text, 'social', config).map((x) => `${f.id} ${x}`));
      if (/amazon\.de/i.test(text)) fehler.push(`${f.id}: Social-Text enthält einen Amazon-Link`);
      eintraege.push({ id: f.id, titel: f.titel, slug: `${f.id}-${slug(f.titel)}`, bild: `${f.id}.png`, pin: `${f.id}-pin.png`, text });
    }
  } finally { rmSync(arbeit, { recursive: true, force: true }); }
  if (fehler.length) throw new Error('Prüfung fehlgeschlagen: ' + fehler.join(' | '));
  writeFileSync(join(ziel, 'index.html'), socialSeite(paket, eintraege, config), 'utf8');
  return { ziel, eintraege };
}

function argWert(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const paket = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined;
    const { ziel, eintraege } = karten({ paket, browser: argWert('--browser') ?? browserPfad(), docs: resolve(argWert('--docs') ?? join(WURZEL, 'docs')) });
    for (const e of eintraege) {
      for (const format of FORMATE) {
        const g = pngGroesse(join(ziel, `${e.id}${format.endung}.png`));
        if (g.breite !== format.breite || g.hoehe !== format.hoehe) throw new Error(`${e.id}${format.endung}.png: ${g.breite} × ${g.hoehe} statt ${format.breite} × ${format.hoehe}`);
      }
    }
    console.log(`karten: ${eintraege.length} Funde, ${eintraege.length * FORMATE.length} Bilder → ${ziel}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
