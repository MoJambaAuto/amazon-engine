// Futter-Engine Paket 2: täglich wechselnde Inhalte für App und Website (Plan: Claude-Projekt plan/futter-engine.md).
// Arten: frage (Gesprächsfrage für Paare), piek (Flügelschlag des Tages, Format wie D.pieks der App: {c,t} mit {r}),
//        wissen (Falter-Wissen), quiz (Wahr oder Falter: {w,s,x}).
// Vorrat:  daten/inhalte/<art>.json   – nur Einträge mit status "freigegeben" werden gezeigt.
// Plan:    daten/inhalte-plan.json    – je Datum die gewählten IDs; einmal geplante Tage ändern sich nie
//          (beide Handys eines Paares sehen dasselbe, auch offline über naechste-tage.json).
// Ausgabe: docs/feed/inhalte/heute.json und docs/feed/inhalte/naechste-tage.json (heute + 13 Tage).
// Aufruf:  node werkzeug/inhalte.mjs [--heute JJJJ-MM-TT]   (läuft im Tageslauf nach dem Fund-Bau)
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WURZEL, lesenJson, schreibenJson, heuteBerlin } from './lib.mjs';

export const ARTEN = ['frage', 'piek', 'wissen', 'quiz'];
export const PIEK_KATEGORIEN = ['aufmerksamkeit', 'unaufgefordert', 'dankbar', 'frage', 'neu'];
export const ANLAESSE = ['wichteln', 'advent', 'weihnachten', 'silvester', 'valentinstag', 'ostern', 'muttertag',
  'vatertag', 'halloween', 'fruehling', 'sommer', 'herbst', 'winter'];
const JAHRESZEITEN = new Set(['fruehling', 'sommer', 'herbst', 'winter']);
const SPERRE_MAX = 180;     // gezeigte Inhalte frühestens nach 180 Tagen wieder …
const SPERRE_ANTEIL = 0.8;  // … oder wenn der Vorrat kleiner ist: nach 80 % des passenden Vorrats
const VORAUS = 14;

// ---------- Datum ----------
const d2n = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
const n2d = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
export const plusTage = (d, t) => n2d(d2n(d) + t);
const iso = (j, m, t) => `${j}-${String(m).padStart(2, '0')}-${String(t).padStart(2, '0')}`;
const wochentag = (d) => new Date(d2n(d) * 864e5).getUTCDay(); // 0 = Sonntag

// Ostersonntag (gregorianisch, Algorithmus nach Meeus/Jones/Butcher)
export function ostern(j) {
  const a = j % 19, b = Math.floor(j / 100), c = j % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31), tag = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(j, monat, tag);
}
// 1. Advent: vierter Sonntag vor dem 25.12. (= Sonntag zwischen 27.11. und 3.12.)
export function ersterAdvent(j) {
  let d = iso(j, 12, 24);
  while (wochentag(d) !== 0) d = plusTage(d, -1);
  return plusTage(d, -21);
}
// Muttertag in Deutschland: 2. Sonntag im Mai
export function muttertag(j) {
  let d = iso(j, 5, 1);
  while (wochentag(d) !== 0) d = plusTage(d, 1);
  return plusTage(d, 7);
}

// Anlässe eines Tages, die genauesten zuerst. Jahreszeiten stehen immer am Ende.
export function anlaesse(d) {
  const j = +d.slice(0, 4), md = d.slice(5), n = d2n(d), r = [];
  const zwischen = (von, bis) => n >= d2n(von) && n <= d2n(bis);
  if (md >= '12-24' && md <= '12-26') r.push('weihnachten');
  if (md >= '12-27' || md === '01-01') r.push('silvester');
  if (zwischen(ersterAdvent(j), iso(j, 12, 23))) r.push('advent');
  if (md >= '11-15' && md <= '12-23') r.push('wichteln');
  if (md >= '02-01' && md <= '02-14') r.push('valentinstag');
  const os = ostern(j);
  if (zwischen(plusTage(os, -14), plusTage(os, 1))) r.push('ostern');
  const mt = muttertag(j);
  if (zwischen(plusTage(mt, -10), mt)) r.push('muttertag');
  const vt = plusTage(os, 39); // Christi Himmelfahrt = Vatertag
  if (zwischen(plusTage(vt, -7), vt)) r.push('vatertag');
  if (md >= '10-24' && md <= '10-31') r.push('halloween');
  const m = +d.slice(5, 7);
  r.push(m <= 2 || m === 12 ? 'winter' : m <= 5 ? 'fruehling' : m <= 8 ? 'sommer' : 'herbst');
  return r;
}

// ---------- Auswahl ----------
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// Darf der Eintrag an diesem Tag erscheinen? Ohne Anlass immer; mit Anlass nur, wenn einer davon aktiv ist.
// wissen/quiz können zusätzlich auf Monate begrenzt sein (Feld monate: [1..12]).
export function passt(e, aktiv, d) {
  if (e.monate && e.monate.length && !e.monate.includes(+d.slice(5, 7))) return false;
  if (!e.anlaesse || e.anlaesse.length === 0) return true;
  return e.anlaesse.some((a) => aktiv.includes(a));
}
const istBesonders = (e, aktiv) => (e.anlaesse || []).some((a) => aktiv.includes(a) && !JAHRESZEITEN.has(a));

// letzter Tag, an dem eine ID gezeigt wurde (oder geplant ist), aus dem Plan
function zuletzt(plan, art) {
  const z = new Map();
  for (const d of Object.keys(plan).sort()) { const id = plan[d][art]; if (id) z.set(id, d); }
  return z;
}

export function waehle(art, vorrat, plan, d) {
  const aktiv = anlaesse(d);
  const frei = vorrat.filter((e) => e.status === 'freigegeben' && passt(e, aktiv, d));
  if (!frei.length) return null;
  const z = zuletzt(Object.fromEntries(Object.entries(plan).filter(([k]) => k < d)), art);
  const sperre = Math.max(1, Math.min(SPERRE_MAX, Math.floor(frei.length * SPERRE_ANTEIL)));
  const offen = frei.filter((e) => !z.has(e.id) || d2n(d) - d2n(z.get(e.id)) >= sperre);
  const kandidaten = offen.length ? offen : frei.slice().sort((a, b) => (z.get(a.id) || '') < (z.get(b.id) || '') ? -1 : 1).slice(0, 1);
  // An Anlass-Tagen kommt jeden zweiten Tag ein passender Anlass-Inhalt. Am Feiertag selbst immer –
  // notfalls ein schon gezeigter aus diesem Anlass (der am längsten zurückliegt).
  const feiertag = ['12-24', '12-25', '12-26', '12-31', '01-01', '02-14'].includes(d.slice(5));
  let besondere = kandidaten.filter((e) => istBesonders(e, aktiv));
  if (feiertag && !besondere.length) {
    besondere = frei.filter((e) => istBesonders(e, aktiv)).sort((a, b) => ((z.get(a.id) || '') < (z.get(b.id) || '') ? -1 : 1)).slice(0, 1);
  }
  const nimmBesondere = besondere.length && (feiertag || d2n(d) % 2 === 0);
  const liste = (nimmBesondere ? besondere : kandidaten).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  return liste[hash(`${d}|${art}`) % liste.length].id;
}

export function planeInhalte({ vorrat, plan = {}, heute, tage = VORAUS }) {
  const neu = { ...plan };
  for (let i = 0; i < tage; i++) {
    const d = plusTage(heute, i);
    if (neu[d] && ARTEN.every((a) => a in neu[d])) continue; // einmal geplant = fest
    const tag = { ...(neu[d] || {}) };
    for (const art of ARTEN) if (!(art in tag)) { neu[d] = tag; tag[art] = waehle(art, vorrat[art] || [], neu, d); }
    neu[d] = tag;
  }
  // Verlauf älter als 400 Tage wird nicht mehr gebraucht (Sperre max. 180 Tage)
  for (const d of Object.keys(neu)) if (d2n(heute) - d2n(d) > 400) delete neu[d];
  return Object.fromEntries(Object.entries(neu).sort(([a], [b]) => (a < b ? -1 : 1)));
}

// ---------- Prüfen ----------
const SPERRWOERTER = /\b(sex|nackt|porno|kokain|cannabis|kiffen|amazon|kaufen|preis|euro|€)\b/i;
export function pruefeVorrat(vorrat) {
  const f = [];
  for (const art of ARTEN) {
    const ids = new Set(), texte = new Set();
    for (const e of vorrat[art] || []) {
      const wo = `${art}/${e.id}`;
      if (!/^[a-z]{1,2}-\d{4}$/.test(e.id || '')) f.push(`${wo}: id ungültig`);
      if (ids.has(e.id)) f.push(`${wo}: id doppelt`); ids.add(e.id);
      if (!['vorschlag', 'freigegeben', 'gesperrt'].includes(e.status)) f.push(`${wo}: status ungültig`);
      for (const a of e.anlaesse || []) if (!ANLAESSE.includes(a)) f.push(`${wo}: Anlass '${a}' unbekannt`);
      const text = art === 'quiz' ? e.s : e.t;
      if (!text || typeof text !== 'string') { f.push(`${wo}: Text fehlt`); continue; }
      if (text.length > 260) f.push(`${wo}: Text zu lang (${text.length})`);
      if (SPERRWOERTER.test(text)) f.push(`${wo}: Sperrwort im Text`);
      const k = text.toLowerCase().replace(/[^a-zäöüß]/g, '');
      if (texte.has(k)) f.push(`${wo}: Text doppelt`); texte.add(k);
      if (art === 'piek' && !PIEK_KATEGORIEN.includes(e.c)) f.push(`${wo}: Kategorie '${e.c}' unbekannt`);
      if (art === 'quiz' && (![0, 1].includes(e.w) || !e.x)) f.push(`${wo}: w (0/1) oder x fehlt`);
      if ((art === 'wissen' || art === 'quiz') && e.status === 'freigegeben' && !e.quelle) f.push(`${wo}: Fakt ohne Quelle`);
    }
  }
  return f;
}

// ---------- Bauen ----------
function eintrag(art, e) {
  if (!e) return null;
  if (art === 'piek') return { id: e.id, c: e.c, t: e.t };
  if (art === 'quiz') return { id: e.id, w: e.w, s: e.s, x: e.x };
  return { id: e.id, t: e.t };
}

export function inhalteLauf({ daten = join(WURZEL, 'daten'), docs = join(WURZEL, 'docs'), heute = heuteBerlin(), jetzt = new Date() } = {}) {
  const vorrat = Object.fromEntries(ARTEN.map((a) => {
    const p = join(daten, 'inhalte', `${a}.json`);
    return [a, existsSync(p) ? lesenJson(p) : []];
  }));
  const fehler = pruefeVorrat(vorrat);
  if (fehler.length) throw new Error('Inhalte-Prüfer meldet Fehler:\n' + fehler.join('\n'));
  const planPfad = join(daten, 'inhalte-plan.json');
  const plan = planeInhalte({ vorrat, plan: existsSync(planPfad) ? lesenJson(planPfad) : {}, heute });
  schreibenJson(planPfad, plan);
  const nachId = Object.fromEntries(ARTEN.map((a) => [a, new Map(vorrat[a].map((e) => [e.id, e]))]));
  const tag = (d) => ({ datum: d, anlaesse: anlaesse(d),
    ...Object.fromEntries(ARTEN.map((a) => [a, eintrag(a, nachId[a].get(plan[d]?.[a]))])) });
  const tage = Array.from({ length: VORAUS }, (_, i) => tag(plusTage(heute, i)));
  schreibenJson(join(docs, 'feed', 'inhalte', 'heute.json'), { erzeugt: jetzt.toISOString(), ...tage[0] });
  schreibenJson(join(docs, 'feed', 'inhalte', 'naechste-tage.json'), { erzeugt: jetzt.toISOString(), tage });
  const warnungen = [];
  for (const a of ARTEN) {
    const n = vorrat[a].filter((e) => e.status === 'freigegeben').length;
    if (n < SPERRE_MAX) warnungen.push(`${a}: nur ${n} freigegeben (Ziel ${SPERRE_MAX}, sonst Wiederholung früher)`);
    if (!tage[0][a]) warnungen.push(`${a}: heute nichts`);
  }
  return { heute: tage[0], warnungen };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const i = process.argv.indexOf('--heute');
    const { heute, warnungen } = inhalteLauf(i > 0 ? { heute: process.argv[i + 1] } : {});
    console.log(`Inhalte ${heute.datum} [${heute.anlaesse.join(', ')}]: ${ARTEN.map((a) => `${a} ${heute[a]?.id ?? '–'}`).join(' · ')}`);
    if (warnungen.length) console.log('Warnungen: ' + warnungen.join('; '));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
