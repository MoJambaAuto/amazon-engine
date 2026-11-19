// Regel-Prüfer der Amazon-Engine. Reine Funktionen: jede liefert eine Liste von Fehlertexten.
// Kein Aufruf von amazon.de – Links werden nur nach ihrer Form geprüft.

export const SCHEMA = {
  pflicht: ['id', 'titel', 'gattung', 'suchbegriff', 'haendler', 'kategorie', 'preisklasse', 'anlaesse',
    'zielgruppe', 'notiz', 'quelle', 'kriterien', 'score', 'status', 'paket', 'texte', 'freigabe',
    'angelegt', 'geaendert'],
  optional: ['asin', 'wichtel_max_cent', 'kriterien_begruendung'],
  status: ['vorschlag', 'freigegeben', 'gesperrt', 'verworfen'],
  preisklasse: ['bis_40', '40_bis_80', 'ueber_80'],
  haendler: ['amazon'],
  kriterien: ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'n1', 'n2', 'n3', 'p3'],
  sperre: ['', 'ausgeschlossene-ware', 'erotik-waffen', 'gesundheit', 'kinder-ansprache', 'fremde-marke', 'herabwuerdigend'],
  score: ['kurios', 'nachfrage', 'kauf', 'grund'],
};

// Kein Bezug zu Mos anderen Geschäften (harte Regel).
const FREMDE_BEZUEGE = ['mojamba', 'interfloh', 'alaner', 'bmw-alfter'];

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const ARTEN = ['web_h', 'web_p', 'kanal', 'social'];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Treffer, wenn das Sperr-Wort am Wortanfang steht (davor kein Buchstabe).
export function sperrTreffer(text, config) {
  const t = String(text ?? '');
  return config.sperr_woerter.filter((w) => new RegExp(`(?<!\\p{L})${escapeRe(w)}`, 'iu').test(t));
}

export function musterTreffer(text, config) {
  const t = String(text ?? '');
  return config.verbotene_muster.filter((m) => new RegExp(m, 'iu').test(t));
}

function fremdTreffer(text) {
  const t = String(text ?? '').toLowerCase();
  return FREMDE_BEZUEGE.filter((w) => t.includes(w));
}

// Zerlegt einen Social-Text in Inhalt und angehängte Hashtags.
function trenneHashtags(text) {
  const m = String(text).match(/^([\s\S]*?)((?:\s*#[\p{L}\p{N}_]+)*)\s*$/u);
  const tags = (m[2].match(/#[\p{L}\p{N}_]+/gu) || []);
  return { inhalt: m[1].trimEnd(), tags };
}

function textVon(eintrag) {
  if (typeof eintrag === 'string') return eintrag;
  if (eintrag && typeof eintrag === 'object' && typeof eintrag.text === 'string') return eintrag.text;
  return null;
}

// art: web_h | web_p | kanal | social
export function pruefeText(text, art, config) {
  const f = [];
  if (!ARTEN.includes(art)) return [`unbekannte Textart '${art}'`];
  if (typeof text !== 'string') return [`${art}: Text fehlt oder ist kein Text`];
  const p = config.pflichttexte;
  const max = config.textlaengen[art];
  if ([...text].length > max) f.push(`${art}: zu lang (${[...text].length} > ${max} Zeichen)`);
  for (const w of sperrTreffer(text, config)) f.push(`${art}: Sperr-Wort '${w}'`);
  for (const m of musterTreffer(text, config)) f.push(`${art}: verbotenes Muster /${m}/`);
  for (const w of fremdTreffer(text)) f.push(`${art}: Bezug zu '${w}' nicht erlaubt`);
  if (art === 'kanal') {
    if (!text.startsWith(p.anfang_kanal) && !text.startsWith(p.anfang_rueckblick)) {
      f.push(`kanal: beginnt nicht mit '${p.anfang_kanal}' oder '${p.anfang_rueckblick}'`);
    }
    if (!text.trimEnd().endsWith(p.ende)) f.push(`kanal: endet nicht mit dem Pflichtsatz`);
  }
  if (art === 'social') {
    if (!text.startsWith(p.anfang_social)) f.push(`social: beginnt nicht mit '${p.anfang_social}'`);
    const { inhalt, tags } = trenneHashtags(text);
    if (!inhalt.endsWith(p.ende)) f.push('social: Pflichtsatz fehlt am Ende (danach nur Hashtags erlaubt)');
    if (tags.length > config.textlaengen.hashtags_max) {
      f.push(`social: zu viele Hashtags (${tags.length} > ${config.textlaengen.hashtags_max})`);
    }
  }
  return f;
}

export function linkRegex(config) {
  const kennungen = [...new Set(Object.values(config.kennungen))].map(escapeRe).join('|');
  const [vor, nach] = config.link_muster.split('{suchbegriff_plus}');
  const filter = '(?:&rh=p_36%3A-\\d+)?';
  let rest;
  if (config.kennung_aktiv === false) {
    rest = filter;
  } else {
    rest = escapeRe(nach.replace('&tag={kennung}', '')) + filter + escapeRe('&tag=') + `(?:${kennungen})`;
  }
  return new RegExp('^' + escapeRe(vor) + '[A-Za-z0-9%+\\-_.!~*\'()]+' + rest + '$');
}

export function pruefeLink(link, config) {
  if (typeof link !== 'string' || !link) return ['Link fehlt'];
  if (!linkRegex(config).test(link)) return [`Link passt nicht auf link_muster: ${link}`];
  return [];
}

function istListeAus(wert, erlaubt) {
  return Array.isArray(wert) && wert.length > 0 && wert.every((x) => (erlaubt ? erlaubt.includes(x) : typeof x === 'string' && x.trim() !== ''));
}

export function pruefeFund(fund, config) {
  const f = [];
  if (!fund || typeof fund !== 'object') return ['Fund ist kein Objekt'];
  for (const feld of SCHEMA.pflicht) {
    if (!(feld in fund)) f.push(`Pflichtfeld '${feld}' fehlt`);
  }
  for (const feld of Object.getOwnPropertyNames(fund)) {
    if (!SCHEMA.pflicht.includes(feld) && !SCHEMA.optional.includes(feld)) f.push(`unbekanntes Feld '${feld}'`);
  }
  if ('id' in fund && !/^f-\d{4}$/.test(fund.id)) f.push(`id '${fund.id}' hat nicht die Form f-0001`);
  if ('status' in fund && !SCHEMA.status.includes(fund.status)) f.push(`status '${fund.status}' nicht erlaubt`);
  if ('preisklasse' in fund && !SCHEMA.preisklasse.includes(fund.preisklasse)) f.push(`preisklasse '${fund.preisklasse}' nicht erlaubt`);
  if ('haendler' in fund && !SCHEMA.haendler.includes(fund.haendler)) f.push(`haendler '${fund.haendler}' nicht erlaubt`);
  if ('kategorie' in fund && !(fund.kategorie in config.provision_prozent)) f.push(`kategorie '${fund.kategorie}' nicht erlaubt`);
  if ('paket' in fund && !/^(start|KW-\d{4}-\d{2})$/.test(fund.paket)) f.push(`paket '${fund.paket}' hat nicht die Form start oder KW-JJJJ-WW`);
  if ('anlaesse' in fund && !istListeAus(fund.anlaesse)) f.push('anlaesse muss eine nicht leere Liste sein');
  if ('zielgruppe' in fund && !istListeAus(fund.zielgruppe)) f.push('zielgruppe muss eine nicht leere Liste sein');
  for (const feld of ['titel', 'gattung', 'suchbegriff', 'notiz']) {
    if (feld in fund && (typeof fund[feld] !== 'string' || fund[feld].trim() === '')) f.push(`${feld} ist leer`);
  }
  for (const feld of ['angelegt', 'geaendert']) {
    if (feld in fund && !DATUM.test(fund[feld])) f.push(`${feld} ist kein Datum JJJJ-MM-TT`);
  }
  if ('asin' in fund && fund.asin !== null && !/^[A-Z0-9]{10}$/.test(fund.asin)) f.push(`asin '${fund.asin}' ungültig`);
  if ('wichtel_max_cent' in fund && !(Number.isInteger(fund.wichtel_max_cent) && fund.wichtel_max_cent >= 0)) f.push('wichtel_max_cent muss eine ganze Zahl ab 0 sein');

  if (typeof fund.titel === 'string' && /amazon/i.test(fund.titel)) f.push("titel enthält 'Amazon'");
  for (const feld of ['titel', 'suchbegriff', 'notiz']) {
    for (const w of sperrTreffer(fund[feld], config)) f.push(`${feld}: Sperr-Wort '${w}'`);
    for (const w of fremdTreffer(fund[feld])) f.push(`${feld}: Bezug zu '${w}' nicht erlaubt`);
  }

  if (fund.quelle !== undefined) {
    const q = fund.quelle;
    if (!q || typeof q !== 'object' || typeof q.art !== 'string' || typeof q.url !== 'string' || !DATUM.test(q.gesehen_am ?? '')) {
      f.push('quelle braucht art, url und gesehen_am (JJJJ-MM-TT)');
    }
  }
  if (fund.kriterien !== undefined) {
    const k = fund.kriterien;
    if (!k || typeof k !== 'object') f.push('kriterien fehlen');
    else {
      for (const name of SCHEMA.kriterien) if (typeof k[name] !== 'boolean') f.push(`kriterien.${name} muss true oder false sein`);
      if (!SCHEMA.sperre.includes(k.sperre)) f.push(`kriterien.sperre '${k.sperre}' nicht erlaubt`);
    }
  }
  if (fund.score !== undefined) {
    const s = fund.score;
    if (!s || typeof s !== 'object' || !SCHEMA.score.every((n) => typeof s[n] === 'number')) f.push('score braucht kurios, nachfrage, kauf, grund als Zahlen');
  }

  if (fund.texte !== undefined) {
    const t = fund.texte;
    if (!t || typeof t !== 'object' || !t.web || !Array.isArray(t.kanal) || !Array.isArray(t.social)) {
      f.push('texte braucht web {h, p}, kanal [] und social []');
    } else {
      const leer = !t.web.h && !t.web.p && t.kanal.length === 0 && t.social.length === 0;
      if (fund.status === 'freigegeben' && (!t.web.h || !t.web.p || t.kanal.length === 0)) {
        f.push('freigegebener Fund braucht web.h, web.p und mindestens eine Kanal-Fassung');
      }
      if (!leer) {
        if (t.web.h) f.push(...pruefeText(t.web.h, 'web_h', config));
        if (t.web.p) f.push(...pruefeText(t.web.p, 'web_p', config));
        t.kanal.forEach((e, i) => {
          const s = textVon(e);
          if (s === null) f.push(`kanal[${i}]: kein Text`);
          else f.push(...pruefeText(s, 'kanal', config).map((x) => `kanal[${i}] ${x}`));
        });
        t.social.forEach((e, i) => {
          const s = textVon(e);
          if (s === null) f.push(`social[${i}]: kein Text`);
          else f.push(...pruefeText(s, 'social', config).map((x) => `social[${i}] ${x}`));
        });
      }
    }
  }
  return f;
}
