# Amazon-Engine – „Papillons Fund des Tages“

Die Engine sammelt kuriose Geschenkideen („Funde“) für schmetterlingsfutter.de.
Jeder Fund wird nach festen Ja/Nein-Kriterien bewertet und nur nach Freigabe veröffentlicht.
Links führen immer auf eine Amazon-Suche mit Partner-Kennung – nie gekürzt, nie weitergeleitet.
Texte nennen keine Preise, Sterne, Rezensionen oder Lieferzusagen und tragen die Pflichthinweise.
Kein Programm ruft amazon.de ab; Links prüft ein Mensch durch Antippen.

## Stand

Paket AE-03: Einstellungen (`config.json`), 30 Funde der Startliste als Vorschläge (`daten/funde.json`),
Regel-Prüfer mit Tests. Bewerten, Planen, Texte und der tägliche Lauf folgen in späteren Paketen.

## Befehle

```bash
node werkzeug/pruefen.mjs   # prüft alle Funde, Ausgabe "ok: 30 Funde"
node --test test/           # Tests des Regel-Prüfers
```

Voraussetzung: Node.js 20 oder neuer, keine weiteren Pakete.

## Aufbau

| Datei | Inhalt |
|---|---|
| `config.json` | Marke, Partner-Kennung, Link-Muster, Pflichttexte, Sperr-Wörter, Schwellen |
| `daten/funde.json` | alle Funde (Schema siehe `werkzeug/regeln.mjs`, `SCHEMA`) |
| `daten/plan.json` | geplante Tage (noch leer) |
| `daten/verlauf.jsonl` | veröffentlichte Tage (noch leer) |
| `werkzeug/lib.mjs` | JSON lesen/schreiben, Datum Berlin, `slug`, `schluessel`, `amazonLink` |
| `werkzeug/regeln.mjs` | `pruefeFund`, `pruefeText`, `pruefeLink` |
| `werkzeug/pruefen.mjs` | prüft alle Funde, Dubletten von id, Schlüssel und ASIN |
| `werkzeug/protokoll.mjs` | hängt Protokollzeilen an `protokoll/<JJJJ-MM>.jsonl` an |

Die Planung liegt lokal und ist nicht Teil dieses Repos.

Als Amazon-Partner verdienen wir an qualifizierten Verkäufen.
