// Plant die nächsten Tage: je Tag ein Fund oder sonntags ein Wochenrückblick.
// Aufruf: node werkzeug/planen.mjs [--daten <ordner>] [--heute JJJJ-MM-TT]
// Liest config.json, <daten>/funde.json, plan.json, verlauf.jsonl; schreibt <daten>/plan.json.
//
// Regeln (plan/bauplan.yaml, Paket AE-04):
// - Zeitraum heute bis heute + planung_tage_voraus − 1. Schon geplante Tage bleiben unverändert.
// - Sonntag: Rückblick, wenn in den 6 Tagen davor mindestens 3 Funde geplant oder veröffentlicht sind.
// - Sonst: freigegebene Funde, die die Sperrfristen einhalten. Fristen gelten in beide Richtungen
//   (auch gegenüber schon geplanten späteren Tagen): Fund 180 Tage, Gattung 30 Tage,
//   Kategorie höchstens kategorie_max in jedem Fenster von kategorie_fenster Tagen.
// - Wert = score.grund + Tageszuschlag; höchster Wert gewinnt, bei Gleichstand die kleinere id.
// - Kanal-Fassung: die erste, deren Paar (ton, format) an den zwei Tagen davor nicht vorkam, sonst die erste.
// - Notfall (kein Kandidat): Fund-Frist 60 statt 180 Tage, Fassung die für diesen Fund am längsten
//   nicht benutzt wurde. Gibt es dann immer noch keinen, bleibt der Tag leer (wird nicht gespeichert).
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WURZEL, lesenJson, schreibenJson, heuteBerlin } from './lib.mjs';
import { BEWERTUNG } from './bewerten.mjs';
import { istGeprueft } from './regeln.mjs';

const NOTFALL_FUND_TAGE = 60;
const TAG_MS = 86400000;

const zuMs = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const plusTage = (d, n) => new Date(zuMs(d) + n * TAG_MS).toISOString().slice(0, 10);
export const abstand = (a, b) => Math.round((zuMs(b) - zuMs(a)) / TAG_MS);
export const istSonntag = (d) => new Date(zuMs(d)).getUTCDay() === 0;

export function lesenVerlauf(pfad) {
  if (!existsSync(pfad)) return [];
  return readFileSync(pfad, 'utf8').split(/\r?\n/).filter((z) => z.trim()).map((z) => JSON.parse(z));
}

// Fassungen eines Fundes als {ton, format}; Strings oder Objekte ohne Angaben ergeben null.
function fassungen(fund) {
  const k = (fund.texte && Array.isArray(fund.texte.kanal)) ? fund.texte.kanal : [];
  return k.map((e) => ({ ton: (e && e.ton) || null, format: (e && e.format) || null }));
}

// Belegung aller Tage: Verlauf zählt vor Plan (bauen.mjs übernimmt den Plan-Eintrag in den Verlauf).
function belegungAus(plan, verlauf, nachId) {
  const b = new Map();
  const mitDaten = (e) => {
    if (e.art !== 'fund') return { ...e };
    const f = nachId.get(e.fund) || {};
    return { ...e, gattung: e.gattung ?? f.gattung, kategorie: e.kategorie ?? f.kategorie };
  };
  for (const [datum, e] of Object.entries(plan)) if (e) b.set(datum, mitDaten(e));
  for (const e of verlauf) if (e && e.datum) b.set(e.datum, mitDaten(e));
  return b;
}

const fundEintraege = (belegung) => [...belegung.entries()].filter(([, e]) => e.art === 'fund');

function haeltFristen(fund, datum, belegung, config, fundTage) {
  const s = config.sperrfristen_tage;
  for (const [d, e] of fundEintraege(belegung)) {
    const a = Math.abs(abstand(datum, d));
    if (e.fund === fund.id && a < fundTage) return false;
    if (e.gattung === fund.gattung && a < s.gattung) return false;
  }
  return kategorieSpitze(fund.kategorie, datum, belegung, s.kategorie_fenster) <= s.kategorie_max;
}

// Höchste Anzahl dieser Kategorie in einem Fenster, das den Tag enthält – den Tag selbst mitgezählt.
function kategorieSpitze(kategorie, datum, belegung, fenster) {
  const tage = fundEintraege(belegung).filter(([, e]) => e.kategorie === kategorie).map(([d]) => abstand(datum, d));
  let spitze = 0;
  for (let start = -(fenster - 1); start <= 0; start++) {
    const n = 1 + tage.filter((t) => t >= start && t <= start + fenster - 1 && t !== 0).length;
    spitze = Math.max(spitze, n);
  }
  return spitze;
}

function paareDavor(datum, belegung) {
  const paare = new Set();
  for (const n of [1, 2]) {
    const e = belegung.get(plusTage(datum, -n));
    if (e && e.art === 'fund' && (e.ton || e.format)) paare.add(`${e.ton}|${e.format}`);
  }
  return paare;
}

function waehleFassung(fund, datum, belegung, notfall) {
  const fs = fassungen(fund);
  if (fs.length === 0) return { ton: null, format: null, fassung: null };
  let i;
  if (notfall) {
    // am längsten nicht benutzt: nie benutzt zuerst, sonst ältester letzter Einsatz, bei Gleichstand kleinster Index
    const zuletzt = fs.map(() => null);
    for (const [d, e] of fundEintraege(belegung)) {
      if (e.fund === fund.id && Number.isInteger(e.fassung) && e.fassung < fs.length) {
        if (zuletzt[e.fassung] === null || d > zuletzt[e.fassung]) zuletzt[e.fassung] = d;
      }
    }
    i = 0;
    for (let j = 1; j < fs.length; j++) {
      const a = zuletzt[j], b = zuletzt[i];
      if (b !== null && (a === null || a < b)) i = j;
    }
  } else {
    const davor = paareDavor(datum, belegung);
    i = fs.findIndex((f) => !davor.has(`${f.ton}|${f.format}`));
    if (i < 0) i = 0;
  }
  return { ton: fs[i].ton, format: fs[i].format, fassung: i };
}

function wert(fund, datum, belegung, config) {
  const z = BEWERTUNG.tageszuschlag;
  let w = (fund.score && fund.score.grund) || 0;
  w += z.gattung_30_tage_frei; // jeder Kandidat hält die Gattungsfrist ein
  if (kategorieSpitze(fund.kategorie, datum, belegung, config.sperrfristen_tage.kategorie_fenster) <= 1) w += z.kategorie_7_tage_max_1;
  const davor = paareDavor(datum, belegung);
  if (fassungen(fund).some((f) => (f.ton || f.format) && !davor.has(`${f.ton}|${f.format}`))) w += z.ton_und_format_anders_als_letzte_2_tage;
  return w;
}

function waehleFund(datum, freigegeben, belegung, config) {
  for (const [fundTage, notfall] of [[config.sperrfristen_tage.fund, false], [NOTFALL_FUND_TAGE, true]]) {
    const kandidaten = freigegeben.filter((f) => haeltFristen(f, datum, belegung, config, fundTage));
    if (kandidaten.length === 0) continue;
    const bewertet = kandidaten.map((f) => ({ f, w: wert(f, datum, belegung, config) }));
    bewertet.sort((a, b) => b.w - a.w || (a.f.id < b.f.id ? -1 : 1));
    const fund = bewertet[0].f;
    return { art: 'fund', fund: fund.id, ...waehleFassung(fund, datum, belegung, notfall) };
  }
  return null;
}

// Reine Funktion: liefert den neuen Plan (alte Einträge unverändert) und den Vorrat.
// AE-13: Kandidaten sind nur freigegebene Funde mit gültiger Sichtprüfung am jeweiligen Tag. Gibt es keinen,
// bekommt der Tag die Art 'pause'. Geplante, noch nicht veröffentlichte Tage, deren Fund am Tag nicht (mehr)
// geprüft ist, und frühere Pausen werden neu berechnet. Der Vorrat zählt nur geprüfte Funde.
export function planen({ funde, plan = {}, verlauf = [], config, heute }) {
  const nachId = new Map(funde.map((f) => [f.id, f]));
  const freigegeben = funde.filter((f) => f.status === 'freigegeben');
  const imVerlauf = new Set(verlauf.map((v) => v.datum));
  const neu = { ...plan };
  for (const [d, e] of Object.entries(neu)) {
    if (d < heute || imVerlauf.has(d) || !e) continue;
    // Rückblicke ebenfalls neu bestimmen: ihre Woche kann sich durch entfernte Funde geändert haben
    if (e.art === 'pause' || e.art === 'rueckblick' || (e.art === 'fund' && !istGeprueft(nachId.get(e.fund), d, config))) delete neu[d];
  }
  const belegung = belegungAus(neu, verlauf, nachId);
  for (let n = 0; n < config.planung_tage_voraus; n++) {
    const datum = plusTage(heute, n);
    if (neu[datum] || belegung.has(datum)) continue;
    let eintrag = null;
    if (istSonntag(datum)) {
      const funde6 = [1, 2, 3, 4, 5, 6].filter((k) => (belegung.get(plusTage(datum, -k)) || {}).art === 'fund').length;
      if (funde6 >= 3) eintrag = { art: 'rueckblick' };
    }
    if (!eintrag) eintrag = waehleFund(datum, freigegeben.filter((f) => istGeprueft(f, datum, config)), belegung, config);
    if (!eintrag) eintrag = { art: 'pause' }; // AE-13: kein geprüfter Kandidat
    neu[datum] = eintrag;
    const f = eintrag.art === 'fund' ? nachId.get(eintrag.fund) : null;
    belegung.set(datum, f ? { ...eintrag, gattung: f.gattung, kategorie: f.kategorie } : eintrag);
  }
  const sortiert = Object.fromEntries(Object.entries(neu).sort(([a], [b]) => (a < b ? -1 : 1)));
  const benutzt = new Set(fundEintraege(belegung).map(([, e]) => e.fund));
  const vorrat = freigegeben.filter((f) => !benutzt.has(f.id) && istGeprueft(f, heute, config)).length;
  return { plan: sortiert, vorrat };
}

// Datei-Ebene: liest den Datenordner, plant, schreibt plan.json.
export function laufen({ ordner = join(WURZEL, 'daten'), heute = heuteBerlin(), config = lesenJson(join(WURZEL, 'config.json')) } = {}) {
  const funde = lesenJson(join(ordner, 'funde.json'));
  const planPfad = join(ordner, 'plan.json');
  const plan = existsSync(planPfad) ? lesenJson(planPfad) : {};
  const verlauf = lesenVerlauf(join(ordner, 'verlauf.jsonl'));
  const ergebnis = planen({ funde, plan, verlauf, config, heute });
  schreibenJson(planPfad, ergebnis.plan);
  return ergebnis;
}

function argWert(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ordner = resolve(argWert('--daten') ?? join(WURZEL, 'daten'));
  const heute = argWert('--heute') ?? heuteBerlin();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(heute)) { console.error('--heute braucht JJJJ-MM-TT'); process.exit(1); }
  const { plan, vorrat } = laufen({ ordner, heute });
  const titel = new Map(lesenJson(join(ordner, 'funde.json')).map((f) => [f.id, f.titel]));
  for (let n = 0; n < lesenJson(join(WURZEL, 'config.json')).planung_tage_voraus; n++) {
    const d = plusTage(heute, n);
    const e = plan[d];
    const text = !e ? '(leer)' : e.art === 'rueckblick' ? 'Wochenrückblick' : `${e.fund} ${titel.get(e.fund) || ''}${e.ton ? ` · ${e.ton}/${e.format}` : ''}`;
    console.log(`${d}  ${text}`);
  }
  console.log(`vorrat_tage: ${vorrat}`);
}
