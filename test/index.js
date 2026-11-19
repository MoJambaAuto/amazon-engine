// Einstieg für `node --test test/`.
// Node ab Version 22 liest Argumente von --test als Muster statt als Ordner und lädt dann test/index.js.
// Diese Datei lädt alle *.test.mjs im Ordner. Läuft sie selbst als Testdatei (node --test ohne Argument),
// tut sie nichts, damit keine Tests doppelt laufen.
'use strict';
const { readdirSync } = require('node:fs');
const { basename } = require('node:path');

if (basename(process.argv[1] || '') !== 'index.js') {
  for (const datei of readdirSync(__dirname).filter((n) => n.endsWith('.test.mjs')).sort()) {
    import('./' + datei);
  }
}
