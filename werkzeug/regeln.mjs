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
// kanal / social = fertig zusammengesetzte Texte (bauen.mjs); *_mitte = Mittelteile in daten/funde.json (STIL.md).
const ARTEN = ['web_h', 'web_p', 'kanal', 'social', 'kanal_mitte', 'social_mitte'];
const LAENGE = { web_h: 'web_h', web_p: 'web_p', kanal_mitte: 'kanal', social_mitte: 'social' };
// STIL.md Regel 10
export const ERLAUBTE_HASHTAGS = ['#funddestages', '#geschenkidee', '#kurios', '#wichteln', '#wichtelgeschenk', '#lustigegeschenke', '#gibteswirklich', '#papillon'];

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

// art: web_h | web_p | kanal_mitte | social_mitte (Texte in funde.json) | kanal | social (fertige Texte)
export function pruefeText(text, art, config) {
  const f = [];
  if (!ARTEN.includes(art)) return [`unbekannte Textart '${art}'`];
  if (typeof text !== 'string') return [`${art}: Text fehlt oder ist kein Text`];
  const p = config.pflichttexte;
  if (LAENGE[art]) {
    const max = config.textlaengen[LAENGE[art]];
    if ([...text].length > max) f.push(`${art}: zu lang (${[...text].length} > ${max} Zeichen)`);
    // STIL.md Regel 5
    const emojis = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
    if (emojis > 1) f.push(`${art}: mehr als ein Emoji (${emojis})`);
    const ausrufe = (text.match(/!/g) || []).length;
    if (ausrufe > 1) f.push(`${art}: mehr als ein Ausrufezeichen (${ausrufe})`);
  }
  if (art === 'kanal_mitte' || art === 'social_mitte') {
    // STIL.md Regel 4: im Mittelteil kein Amazon, kein Link, keine Hashtags
    if (/amazon/i.test(text)) f.push(`${art}: Wort 'Amazon' im Mittelteil`);
    if (/https?:\/\/|www\.|\.(de|com)\b/i.test(text)) f.push(`${art}: Link im Mittelteil`);
    if (/#[\p{L}\p{N}_]/u.test(text)) f.push(`${art}: Hashtag im Mittelteil`);
  }
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
        // Kanal-Fassung: { format, ton, text } – nur Mittelteil
        t.kanal.forEach((e, i) => {
          if (!e || typeof e !== 'object' || typeof e.text !== 'string') { f.push(`kanal[${i}]: braucht format, ton und text`); return; }
          if (!config.formate.includes(e.format)) f.push(`kanal[${i}]: format '${e.format}' nicht erlaubt`);
          if (!config.toene.includes(e.ton)) f.push(`kanal[${i}]: ton '${e.ton}' nicht erlaubt`);
          f.push(...pruefeText(e.text, 'kanal_mitte', config).map((x) => `kanal[${i}] ${x}`));
        });
        // STIL.md Regel 9: verschiedene Formate und Töne je Fund
        const formate = t.kanal.map((e) => e && e.format);
        const toene = t.kanal.map((e) => e && e.ton);
        if (new Set(formate).size !== formate.length) f.push('kanal: Formate der Fassungen nicht verschieden');
        if (new Set(toene).size !== toene.length) f.push('kanal: Töne der Fassungen nicht verschieden');
        // Social-Fassung: { text, hashtags } – Mittelteil, Hashtags im eigenen Feld
        t.social.forEach((e, i) => {
          if (!e || typeof e !== 'object' || typeof e.text !== 'string' || typeof e.hashtags !== 'string') { f.push(`social[${i}]: braucht text und hashtags`); return; }
          f.push(...pruefeText(e.text, 'social_mitte', config).map((x) => `social[${i}] ${x}`));
          const tags = e.hashtags.trim().split(/\s+/).filter(Boolean);
          if (tags.length < 3 || tags.length > config.textlaengen.hashtags_max) f.push(`social[${i}]: ${tags.length} Hashtags (erlaubt 3 bis ${config.textlaengen.hashtags_max})`);
          if (!tags.includes('#funddestages')) f.push(`social[${i}]: #funddestages fehlt`);
          for (const tag of tags) if (!ERLAUBTE_HASHTAGS.includes(tag)) f.push(`social[${i}]: Hashtag ${tag} nicht in der Liste`);
        });
      }
    }
  }
  return f;
}
