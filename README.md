# Schlaftagebuch

Lokale Web-App zum Führen eines Schlaftagebuchs, komplett ohne Backend. Die Daten werden ausschließlich im `localStorage` des Browsers gespeichert.

## Funktionen

- Täglicher Schlaftagebuch-Eintrag
- Automatische Berechnung von Schlafdauer und effektiver Schlafdauer
- Schlafqualität auf einer Skala von 1–5
- Verlauf mit Bearbeiten und Löschen
- Statistik der letzten 14 Kalendertage
- Effektive Schlafdauer als Diagramm in der Statistik und im PDF-Bericht
- Konfigurierbares Standard-Schlaffenster
- JSON-Export und -Import zur Datensicherung
- Direkter PDF-Export im A4-Querformat, unabhängig vom mobilen Druckdialog
- Kurze Einführung beim ersten Besuch mit lokal gespeicherter Anzeigeoption
- Benutzeroberfläche und PDF-Bericht auf Deutsch, Französisch oder Englisch
- Sprachauswahl lokal gespeichert und unabhängig von Schlafdaten und Sicherungen

## Entwicklung

Voraussetzung: Node.js `^20.19.0` oder `>=22.12.0`.

```sh
npm install
npm run dev       # Entwicklungsserver
npm test          # Regressionstests
npm run build     # Produktions-Build nach dist/
npm run preview   # Build lokal ansehen
```

## Lizenz

[MIT](LICENSE)
