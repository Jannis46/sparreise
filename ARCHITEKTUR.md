# Sparreise — Architektur

Private Budget- und Sparziel-PWA. Deutschsprachig, iPhone-first, offline, kein Backend.
Vite + Vanilla TypeScript, keine Runtime-Dependencies.

---

## 1. Eigentumskarte (verbindlich)

Vier Agents arbeiten **parallel an disjunkten Ordnern**. Wer eine fremde Datei ändert,
erzeugt einen Konflikt. Im Zweifel: nachfragen, nicht anfassen.

| Datei / Ordner | Eigentümer | Status |
| --- | --- | --- |
| `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore` | **ARCHITEKT** | fertig — nicht ändern |
| `index.html` | **ARCHITEKT** | fertig — nicht ändern |
| `src/main.ts` | **ARCHITEKT** | fertig — nicht ändern |
| `src/domain/types.ts` (+ `types.test.ts`) | **ARCHITEKT** | fertig — nicht ändern |
| `src/storage/adapter.ts` | **ARCHITEKT** | fertig — nicht ändern |
| `src/state/store.ts` (+ `store.test.ts`) | **ARCHITEKT** | fertig — nicht ändern |
| `ARCHITEKTUR.md` | **ARCHITEKT** | fertig |
| `src/domain/geld.ts` | Agent **Fachlogik** | Stub |
| `src/domain/verteilung.ts` | Agent **Fachlogik** | Stub |
| `src/domain/etappen.ts` | Agent **Fachlogik** | Stub |
| `src/storage/indexeddb.ts` | Agent **Persistenz** | Stub |
| `src/storage/localstorage.ts` | Agent **Persistenz** | Stub |
| `src/storage/memory.ts` | Agent **Persistenz** | Stub |
| `src/storage/tiering.ts` | Agent **Persistenz** | Stub |
| `src/storage/migrate.ts` | Agent **Persistenz** | Stub |
| `src/storage/portable.ts` | Agent **Persistenz** | Stub |
| `src/ui/app.ts`, `src/ui/screens/**`, `src/ui/components/**` | Agent **UI** | Stub |
| `src/chart/chart.ts` | Agent **UI** | Stub |
| `src/pwa/register.ts` | Agent **PWA** | Stub |
| `public/**` (manifest, `sw.js`, Icons) | Agent **PWA** | leer |

Eigene Dateien darf jeder Agent in seinem Ordner beliebig anlegen (inkl. `*.test.ts`
und CSS-Dateien, die aus dem eigenen Ordner importiert werden). Neue Abhängigkeiten
sind verboten — auch Dev-Dependencies nur nach Rücksprache.

---

## 2. Harte Regeln

1. **Geld ist immer Cent-Integer.** Nie Float-Euro, nie `parseFloat` auf Beträge.
   Feldnamen tragen das Suffix `Cent`. Formatieren und Parsen ausschließlich über
   `src/domain/geld.ts`.
2. **Fehler sind immer für die Nutzerin sichtbar.** `console.error` allein ist ein Bug.
   Speicherfehler tragen `SpeicherFehler.nutzerText` (deutscher Satz), landen im
   `StoreStatus.letzterFehler` und müssen von der UI dargestellt werden.
3. **Kein Datenverlust bei App-Wechsel.** Kein Debounce beim Speichern.
4. **Keine Runtime-Dependencies.** Charts sind handgeschriebenes SVG, der Service Worker
   ist handgeschrieben (kein Workbox).
5. **Build-Target `['es2020','safari15']`.** Siehe iOS-Regeln unten.

---

## 3. Datenmodell (`src/domain/types.ts`)

```ts
SCHEMA_VERSION = 1

Fixkostenposten { id, name, betragCent }
Monatseintrag   { id, jahr, monat, etfDepotCent, tagesgeldCent,
                  sonderausgabeCent?, sonderausgabeNotiz?, erfasstAm }
Einstellungen   { einkommenCent, studiumCent, freizeitCent,
                  etfZusatzCent, etfInFixkostenCent }
AppDaten        { schemaVersion, fixkosten[], einstellungen, monate[] }
```

Exporte: `startDaten()`, `neueId()`, `SCHEMA_VERSION`, `EINSTELLUNGEN_START`,
`FIXKOSTEN_START_ANZAHL`.

**Startwerte — bewusst ohne Beträge.** 17 Fixkostenkategorien in fachlich fester
Reihenfolge (Miete … Friseur), **alle Beträge 0**; Einkommen und Studiengebühren
ebenfalls 0. Grund: Dieses Repository ist öffentlich (GitHub Pages veröffentlicht auf
dem kostenlosen Plan nur aus öffentlichen Repos), echte Beträge im Quellcode wären
dauerhaft lesbar — auch nach dem Löschen noch über die Git-Historie.
Eigene Zahlen trägt man beim ersten Start ein oder importiert sie über
„Daten → Wiederherstellen"; sie liegen dann ausschließlich auf dem Gerät.

Allgemeine Vorgabewerte (keine Personendaten): Freizeit 30000, ETF zusätzlich 5000,
ETF-Anteil in Fixkosten 10000 — alles in Cent.

`neueId()` nutzt `crypto.randomUUID()`, fällt auf `crypto.getRandomValues()` zurück und
zuletzt auf Zeitstempel + Zähler. `randomUUID` gibt es erst ab iOS 15.4 **und** nur in
Secure Contexts — der Fallback ist Pflicht, nicht Deko.

---

## 4. Storage-Vertrag (`src/storage/adapter.ts`)

```ts
type StorageTier = 'indexeddb' | 'localstorage' | 'memory'

interface StorageAdapter {
  readonly tier: StorageTier
  init(): Promise<void>              // wirft, wenn Tier auf diesem Gerät unbrauchbar
  laden(): Promise<AppDaten | null>
  speichern(daten: AppDaten): Promise<void>
  loeschen(): Promise<void>
}

class SpeicherFehler extends Error { tier, ursache: unknown, nutzerText: string }
```

**Schreibvertrag, verbindlich für jede Implementierung:**

```
write → read-back → deep-compare
  ↳ Abweichung → genau 1 Retry (write → read-back → deep-compare)
      ↳ erneut Abweichung/Fehler → SpeicherFehler werfen
          ↳ Store ruft herabstufen() → nächstschlechterer Tier
              ↳ Nutzerin sieht die Warnung im UI
```

Deep-Compare darf **nicht** naiv `JSON.stringify` vergleichen (Schlüsselreihenfolge).
`structuredClone` ist verboten.

Fallstricke, die `init()` aktiv prüfen muss:
- iOS Safari privat: `localStorage` existiert, wirft aber beim Schreiben → Probeschreiben.
- iOS Safari: IndexedDB-`open` kann ohne Fehler hängen → Timeout (`IDB_TIMEOUT_MS = 3000`).

---

## 5. Store (`src/state/store.ts`)

Einzige Wahrheit und **einzige Stelle**, die `adapter.speichern()` aufruft.

- **Serielle Schreibkette:** jeder Schreibvorgang hängt an einer Promise-Kette.
  Zwei gleichzeitige `speichern()` sind strukturell unmöglich (per Test abgesichert).
- **Coalescing:** treffen während eines laufenden Schreibvorgangs mehrere Mutationen ein,
  wird danach **genau einmal** der dann aktuelle Stand geschrieben.
- **Sofortiges Speichern** bei jeder Mutation. Kein Debounce.
- **Sicherheitsnetz:** `ereignisNetzAktivieren()` hängt sich an `visibilitychange`
  und `pagehide`. **Nicht** `beforeunload` — feuert auf iOS unzuverlässig.
- **Herabstufung:** schlägt ein Schreibvorgang fehl, ruft der Store `herabstufen(fehler, tier)`
  aus `tiering.ts`, tauscht den Adapter und versucht es genau einmal erneut.
- **Listener:** einfaches Array + `subscribe()` mit Abmelde-Funktion. Kein `EventTarget`.
- **DI:** Adapter kommt per Konstruktor → testbar ohne Browser.

Status für die UI:

```ts
StoreStatus { tier, speichertGerade, letzterSpeicherzeitpunkt, letzterFehler }
```

`letzterFehler` ist ein fertiger deutscher Satz. Ist er gesetzt, **muss** die UI ihn zeigen.

Mutationen (alle geben `Promise<void>` zurück, das nach dem Speichern auflöst):
`aktualisieren`, `einstellungenSetzen`, `fixkostenHinzufuegen`, `fixkostenAendern`,
`fixkostenEntfernen`, `fixkostenVerschieben`, `monatHinzufuegen`, `monatAendern`,
`monatEntfernen`, `ersetzen`, `flush`.

Mutatoren in `aktualisieren()` müssen **rein** sein: neues Objekt zurückgeben, das alte
nicht verändern.

---

## 6. iOS-Safari-Kompatibilität

- **Kein `structuredClone`** (erst iOS 15.4). Klonen über Spread / `JSON.parse(JSON.stringify())`.
- **Kein `Array.prototype.at`**, kein `Object.hasOwn`, kein Top-Level-`await`.
- **`crypto.randomUUID` nur mit Fallback** — siehe `neueId()`.
- **`pagehide` statt `beforeunload`.** `visibilitychange` zusätzlich.
- **`viewport-fit=cover`** ist gesetzt; Layouts müssen `env(safe-area-inset-*)` nutzen
  (CSS-Variablen `--safe-oben/-unten/-links/-rechts` liegen bereit).
- **Kein `user-scalable=no`.** Zoom bleibt erlaubt (Accessibility).
- **Eingabefelder mindestens `16px`** Schriftgröße, sonst zoomt Safari beim Fokus.
- **Keine Hover-abhängige Bedienung.** Touch-Ziele mindestens 44×44 px.
- **`100vh` vermeiden** (Adressleiste); `100dvh` mit Fallback oder Flex-Layout nutzen.
- Build-Target ist `['es2020','safari15']` — esbuild transpiliert, aber **polyfillt nichts**.

---

## 7. Scripts

```
npm run dev        Entwicklungsserver
npm run build      tsc && vite build   (Ausgabe: dist/)
npm run preview    dist/ lokal servieren
npm test           vitest run
npm run typecheck  tsc --noEmit
```

GitHub Pages: `SPARREISE_BASE=/<repo>/ npm run build` setzt den base-Pfad.
Alle Asset-Referenzen in `index.html` sind relativ (`./…`), damit das trägt.
