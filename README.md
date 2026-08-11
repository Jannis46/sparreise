# Sparreise

Private Budget- und Sparziel-App als PWA. Läuft offline, ohne Backend, ohne Konto.
Alle Daten bleiben auf dem Gerät.

Gebaut für die Nutzung am iPhone: einhändig, unterwegs, in Eile.

## Was sie kann

- **Fixkosten** verwalten und live die monatliche Verteilung berechnen:
  `Verfügbar = Einkommen − (Fixkosten + Studiengebühren)`, davon Freizeit-Budget
  und ETF-Sparrate, der Rest geht aufs Tagesgeld. Warnung bei Unterdeckung.
- **Monatswerte erfassen** — ETF-Depotwert, Tagesgeld, optionale Sonderausgabe.
  Nachträglich änder- und löschbar.
- **Fortschritt** über Etappen bei 1.000 / 3.000 / 6.000 / 10.000 €, mit
  Verlaufsdiagramm für ETF und Tagesgeld getrennt.
- **Export und Import** als JSON-Datei — das ist die Sicherung.

## Datenschutz

Die Startdaten enthalten **nur Kategorienamen, keine Beträge**. Eigene Zahlen trägt
man beim ersten Start ein oder importiert sie über „Daten → Wiederherstellen". Sie
werden ausschließlich lokal gespeichert und verlassen das Gerät nie.

## Speicherung

IndexedDB als primäre Stufe, localStorage als Rückfallebene, Arbeitsspeicher als
letzte Stufe — dann mit sichtbarer Warnung, dass die Daten beim Schließen verloren
gehen. Jeder Schreibvorgang wird zurückgelesen und verglichen; stimmt er nicht,
wird einmal wiederholt und danach eine Stufe herabgestuft.

> **Auf dem iPhone wichtig:** Safari löscht die Daten von Websites nach sieben Tagen
> ohne Nutzung. Zum Home-Bildschirm hinzugefügte Web-Apps sind davon ausgenommen.
> „Zum Home-Bildschirm hinzufügen" ist deshalb kein Komfort, sondern Teil der
> Datensicherheit — zusätzlich regelmäßig exportieren.

## Technik

Vanilla TypeScript + Vite, **keine Runtime-Abhängigkeiten**. Diagramme als
handgeschriebenes SVG, Service Worker handgeschrieben. Beträge intern durchgehend
als Cent-Integer, nie als Fließkomma-Euro. Build-Ziel ist iOS Safari 15.

```bash
npm install
npm run dev        # Entwicklungsserver
npm test           # Unit-Tests
npm run typecheck
npm run build      # statischer Build nach dist/
```

Für ein Unterverzeichnis (z. B. GitHub Pages):

```bash
SPARREISE_BASE=/sparreise/ npm run build
```

## Prüfung

Neben den Unit-Tests liegen unter `pruefung/` eigenständige Prüfläufe gegen die
gebaute App in WebKit — derselben Engine wie iOS Safari:

| Ordner | Prüft |
|---|---|
| `pruefung/fachlogik/` | Rechnung unabhängig nachgerechnet, Erwartungswerte von Hand |
| `pruefung/iphone/` | Touch-Ziele ≥ 44 px, Schriftgrößen ≥ 16 px, kein horizontales Scrollen, Kontraste — bei 390 px und 320 px, hell und dunkel |
| `pruefung/adversarial/` | XSS, kaputter Speicherinhalt, manipulierte Import-Dateien, voller Speicher |
| `pruefung/regression/` | vollständige Nutzerflüsse end-to-end |

```bash
npx vite preview --port 4173
node pruefung/iphone/messung.mjs
```

Die Mobil-Messung lässt sich gegenprüfen — mit angehobener Schwelle muss sie
anschlagen, sonst misst sie nichts:

```bash
MIN_ZIEL=60 node pruefung/iphone/messung.mjs
```
