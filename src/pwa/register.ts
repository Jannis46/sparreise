/**
 * Service-Worker-Registrierung (Agent PWA).
 *
 * Gegenstück zu `public/sw.js`. Kein Workbox, keine Abhängigkeiten.
 *
 * Grundregeln:
 *  - `serviceWorkerRegistrieren()` wirft NIE. Fehler landen als deutscher Satz in
 *    `optionen.beiFehler` (main.ts zeigt ihn als Banner) — nicht nur in der Konsole.
 *  - Alle Pfade relativ: GitHub Pages läuft unter /sparreise/. `register('./sw.js')`
 *    wird gegen die Dokument-URL aufgelöst, `/sw.js` wäre dort falsch.
 *  - Nur in `production`. Im Dev-Server stört ein SW massiv (alte Assets).
 *  - Fehlt `navigator.serviceWorker` komplett (iOS Safari Private Mode), ist das
 *    kein Fehlerfall, sondern eine Umgebung ohne Offline-Fähigkeit → still zurück.
 */

export interface SwOptionen {
  /** Wird mit einem anzeigbaren deutschen Text gerufen, wenn etwas schiefging. */
  beiFehler?: (text: string) => void;
  /** Wird gerufen, wenn eine neue Version bereitsteht. */
  beiUpdate?: () => void;
}

interface SwNachricht {
  typ?: unknown;
}

let registrierung: ServiceWorkerRegistration | null = null;
let updateGemeldet = false;
let neuladenErwartet = false;

export async function serviceWorkerRegistrieren(optionen: SwOptionen = {}): Promise<void> {
  try {
    if (!import.meta.env.PROD) return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    await speicherDauerhaftAnfordern();

    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    registrierung = reg;

    const melden = (): void => {
      if (updateGemeldet) return;
      updateGemeldet = true;
      optionen.beiUpdate?.();
    };

    // Fall 1: beim Start wartet bereits eine neue Version.
    if (reg.waiting && navigator.serviceWorker.controller) melden();

    // Fall 2: während der Sitzung wird eine neue Version installiert.
    reg.addEventListener('updatefound', () => {
      const neu = reg.installing;
      if (!neu) return;
      neu.addEventListener('statechange', () => {
        // controller gesetzt = es lief schon eine Version → echtes Update,
        // nicht die Erstinstallation.
        if (neu.state === 'installed' && navigator.serviceWorker.controller) melden();
      });
    });

    // Fall 3: der SW meldet sich selbst (siehe SPARREISE_UPDATE_BEREIT in sw.js).
    navigator.serviceWorker.addEventListener('message', (ereignis: MessageEvent) => {
      const daten = ereignis.data as SwNachricht | null;
      if (daten && daten.typ === 'SPARREISE_UPDATE_BEREIT') melden();
    });

    // Nach SKIP_WARTEN übernimmt der neue SW → genau einmal neu laden.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!neuladenErwartet) return;
      neuladenErwartet = false;
      location.reload();
    });
  } catch (fehler) {
    optionen.beiFehler?.(
      'Der Offline-Modus konnte nicht eingerichtet werden. Sparreise funktioniert normal weiter, ' +
        'braucht aber eine Internetverbindung zum Laden. Grund: ' +
        fehlerText(fehler),
    );
  }
}

/**
 * Übernimmt die wartende Version: schickt `SKIP_WARTEN` an den wartenden SW.
 * Die Seite lädt sich danach automatisch einmal neu (controllerchange).
 * Für den Button "Neue Version verfügbar — neu laden" in der UI.
 */
export function neueVersionUebernehmen(): void {
  const wartend = registrierung?.waiting ?? null;
  if (!wartend) {
    // Kein wartender SW (z.B. schon übernommen) — dann tut ein simples Neuladen dasselbe.
    location.reload();
    return;
  }
  neuladenErwartet = true;
  wartend.postMessage({ typ: 'SKIP_WARTEN' });
}

/**
 * Bittet den Browser, den Speicher als dauerhaft zu markieren (schützt vor
 * automatischem Aufräumen). Darf nie werfen, gibt es längst nicht überall.
 *
 * iOS: Safari kennt `persist()` erst neuerdings und entscheidet selbst, ohne
 * Nachfrage — der Aufruf schadet nicht, ersetzt aber NICHT "zum Home-Bildschirm
 * hinzufügen". Nur installierte PWAs sind von der 7-Tage-Löschregel ausgenommen.
 */
async function speicherDauerhaftAnfordern(): Promise<void> {
  try {
    const speicher = navigator.storage;
    if (!speicher || typeof speicher.persist !== 'function') return;
    await speicher.persist();
  } catch (fehler) {
    // Kein Nutzerfehler: das Speichern selbst funktioniert weiterhin.
    console.warn('Sparreise: dauerhafter Speicher nicht anforderbar:', fehler);
  }
}

function fehlerText(fehler: unknown): string {
  if (fehler instanceof Error) return `${fehler.name}: ${fehler.message}`;
  return String(fehler);
}
