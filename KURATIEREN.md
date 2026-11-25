# Wochen-Sitzung der Amazon-Engine (Paket AE-11)

Diesen Ablauf führt die geplante Claude-Aufgabe `amazon-engine-woche` jeden Sonntag um 10:00 Uhr aus. Jede KI kann ihn ausführen. Ohne vidIQ und OpenRush entfallen die Schritte 4b und 4c; n2 und n3 sind dann Nein.

1. Im Ordner `C:/Users/zabai/Documents/amazon-engine`: `git pull`. `docs/status.json`, die neueste Datei unter `daten/signale/` und `daten/anlass-kalender.json` lesen.
2. Hive-Tab Freigaben lesen (Spalten A bis N). Für jede Zeile, deren Bezug mit `AE|KW-` beginnt:
   - Status `freigegeben` und Spalte L = `Mo über Freigabe-Seite` und Spalte N leer: `node werkzeug/freigeben.mjs <Paket> --bezug <Karten-ID>` (nennt Mo in Spalte M Funde, die nicht passen: mit `--ohne`), `node werkzeug/taeglich.mjs`, commit, push. Dann Spalte N = „Zeit, Agent, was getan“, Spalte J = `erledigt`.
   - Status `abgelehnt` und Spalte N leer: `node werkzeug/freigeben.mjs <Paket> --bezug <Karten-ID> --abgelehnt` (alle Funde des Pakets auf `verworfen`), commit, push, Spalte N füllen.
   - Status `Rückfrage`: in Spalte O antworten, nichts ändern.
3. Ist eine Karte mit Bezug `AE|KW-` noch `offen`, oder zeigt `status.json` mindestens 21 Tage Vorrat: Sitzung hier beenden (weiter bei Schritt 8).
4. Zehn neue Funde anlegen, Paket `KW-<Jahr>-<Kalenderwoche des kommenden Montags>`:
   a. Themen aus den Anlässen der nächsten 45 Tage und aus den Signalen wählen.
   b. Höchstens 2 vidIQ-Suchen (`vidiq_instagram_tiktok_outlier_search`, deutsch, letzte 30 Tage) nach Produkt- und Geschenk-Videos. Ein Treffer zum Thema macht n2 zu Ja.
   c. Höchstens 5 OpenRush-Abfragen (`inspect_keyword`, Germany, German) zum Kernbegriff. Ab 1.000 Suchen pro Monat ist n3 Ja.
   d. Je Fund alle Felder nach `fund_schema` füllen (Pflicht- und Zusatzfelder in `werkzeug/regeln.mjs` SCHEMA, Erklärung je Feld in `C:/Users/zabai/Documents/MoJamba Redesign/amazon-engine/bauplan.yaml`; Vorbild: ein vorhandener Fund in `daten/funde.json`). Neue Funde bekommen status `vorschlag` und freigabe leer. `notiz` in eigenen Worten, 1 bis 2 Sätze, höchstens 160 Zeichen. Jedes Kriterium k1 bis k6, n1 bis n3, p3 mit Ja oder Nein beantworten und in `kriterien_begruendung` je einen Satz Begründung ablegen. `sperre` setzen, wenn eine Sperre zutrifft.
   e. Keine Dubletten: Gattungen, die in den letzten 30 Tagen veröffentlicht oder geplant sind, vermeiden.
   f. amazon.de nie öffnen. Die Suchbegriffe so wählen, dass der Fund ohne Markennamen gefunden wird.
5. Texte nach `STIL.md` schreiben (1 Web-Text, 3 Kanal-Fassungen, 2 Social-Fassungen). Dann `node werkzeug/bewerten.mjs`, `node werkzeug/pruefen.mjs`. Fehler beheben, bis der Prüfer `ok` meldet.
6. `node werkzeug/bauen.mjs --vorschau <Paket>`, commit, push.
7. Genau eine Freigabe-Karte anlegen: A `F-AE-<JJJJMMTT>` · B Zeit · C Agent · D `geplante Aufgabe amazon-engine-woche` · E `Außen` · F `Fund des Tages: neue Funde für <Paket> freigeben` · G `Nach Ja erscheinen die Funde der Vorschau einzeln, einer pro Tag, auf schmetterlingsfutter.de/funde und als Kopiertext für den WhatsApp-Kanal. Bitte Funde nennen, die nicht passen. Vorschau: https://mojambaauto.github.io/amazon-engine/vorschau/<Paket>/` · H `Ja, freigeben` · I `AE|<Paket>` · J `offen`.
8. Hive-Tab Automatiken, Zeile `gh:amazon-engine`: Letzter Lauf und Stand aus `status.json` eintragen; steht dort eine Warnung, in „Letzter Fehler“ schreiben.
9. Eine Zeile im Änderungsprotokoll und eine Notiz in Obsidian `mojamba/Amazon-Engine/` anhängen.
