// Gemeinsame Hilfsfunktionen der Amazon-Engine.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ZEITZONE = 'Europe/Berlin';

export function lesenJson(pfad) {
  return JSON.parse(readFileSync(pfad, 'utf8').replace(/^﻿/, ''));
}

export function schreibenJson(pfad, daten) {
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, JSON.stringify(daten, null, 2).replace(/\r\n/g, '\n') + '\n', 'utf8');
}

function teileBerlin(datum = new Date()) {
  const f = new Intl.DateTimeFormat('de-DE', {
    timeZone: ZEITZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const t = Object.fromEntries(f.formatToParts(datum).map((p) => [p.type, p.value]));
  return t;
}

// JJJJ-MM-TT in Europe/Berlin
export function heuteBerlin(datum = new Date()) {
  const t = teileBerlin(datum);
  return `${t.year}-${t.month}-${t.day}`;
}

// TT.MM.JJJJ HH:MM in Europe/Berlin
export function zeitBerlin(datum = new Date()) {
  const t = teileBerlin(datum);
  return `${t.day}.${t.month}.${t.year} ${t.hour}:${t.minute}`;
}

export function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const FUELLWOERTER = new Set(['der', 'die', 'das', 'ein', 'eine', 'als', 'im', 'in', 'mit', 'für', 'fuer', 'und']);

// Vergleichsschlüssel für Dubletten: Füllwörter raus, Wörter sortiert.
export function schluessel(titel) {
  return slug(titel)
    .split('-')
    .filter((w) => w && !FUELLWOERTER.has(w))
    .sort()
    .join('-');
}

// Suchlink nach config.link_muster. maxCent > 0 fügt den Preisfilter vor &tag= ein.
export function amazonLink(suchbegriff, kennung, maxCent = 0, config = null) {
  const cfg = config ?? lesenJson(join(WURZEL, 'config.json'));
  const plus = String(suchbegriff).trim().split(/\s+/).map(encodeURIComponent).join('+');
  let link = cfg.link_muster.replace('{suchbegriff_plus}', plus);
  const filter = maxCent > 0 ? `&rh=p_36%3A-${Math.round(maxCent)}` : '';
  if (cfg.kennung_aktiv === false) {
    link = link.replace(/&tag=\{kennung\}$/, '');
    return link + filter;
  }
  return link.replace('&tag={kennung}', `${filter}&tag=${kennung}`);
}
