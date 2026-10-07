# Schlaftagebuch

Lokale Web-App zum Führen eines Schlaftagebuchs, komplett ohne Backend. Die Daten werden ausschließlich im `localStorage` des Browsers gespeichert.

## Funktionen

- Täglicher Schlaftagebuch-Eintrag
- Automatische Berechnung von Schlafdauer und effektiver Schlafdauer
- Schlafqualität auf einer Skala von 1–5
- Verlauf mit Bearbeiten und Löschen
- Statistik der letzten 7 Nächte
- Konfigurierbares Standard-Schlaffenster
- JSON-Export

## Entwicklung

Voraussetzung: Node.js `^20.19.0` oder `>=22.12.0`.

```sh
npm install
npm run dev       # Entwicklungsserver
npm run build     # Produktions-Build nach dist/
npm run preview   # Build lokal ansehen
```

## Lizenz

[MIT](LICENSE)
