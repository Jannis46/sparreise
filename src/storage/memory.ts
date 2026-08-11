/**
 * Letzte Speicherstufe: hält die Daten nur im Arbeitsspeicher.
 * Funktioniert immer, überlebt aber keinen Reload — die UI MUSS `tier === 'memory'`
 * sichtbar melden (`StoreStatus.tier`, Text in `TIER_TEXT`).
 *
 * Hier liegen zusätzlich die drei Bausteine, die sich alle drei Adapter teilen:
 * `klon`, `tiefGleich` und `schreibenMitPruefung`. Bewusst in dieser Datei statt in
 * einem eigenen Modul, weil der Persistenz-Agent nur die vorgegebenen Dateien
 * anlegen darf. memory.ts ist die unterste Stufe und importiert nichts von den
 * Geschwister-Modulen — dadurch entsteht kein Import-Zyklus.
 */

import type { AppDaten } from '../domain/types';
import { SpeicherFehler, type StorageAdapter, type StorageTier } from './adapter';

/** Anzahl der Schreibversuche pro `speichern()`: erster Versuch + genau 1 Retry. */
export const SCHREIB_VERSUCHE = 2;

/**
 * Tiefe Kopie ohne `structuredClone` (auf iOS Safari < 15.4 nicht vorhanden).
 * Die Daten sind reines JSON — das trägt.
 */
export function klon<T>(wert: T): T {
  return JSON.parse(JSON.stringify(wert)) as T;
}

/**
 * Strukturvergleich. Bewusst KEIN naives `JSON.stringify`-Vergleichen: die
 * Schlüsselreihenfolge darf keine Rolle spielen.
 * Schlüssel mit dem Wert `undefined` werden auf beiden Seiten ignoriert, weil ein
 * JSON-Umlauf sie entfernt (`sonderausgabeCent?: undefined`) — das ist kein Datenverlust.
 */
export function tiefGleich(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;

  const aIstArray = Array.isArray(a);
  if (aIstArray !== Array.isArray(b)) return false;

  if (aIstArray) {
    const av = a as unknown[];
    const bv = b as unknown[];
    if (av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i++) {
      if (!tiefGleich(av[i], bv[i])) return false;
    }
    return true;
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aSchluessel = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bSchluessel = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (aSchluessel.length !== bSchluessel.length) return false;
  for (const k of aSchluessel) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!tiefGleich(ao[k], bo[k])) return false;
  }
  return true;
}

/**
 * Der verbindliche Schreibvertrag aus adapter.ts, einmal implementiert:
 * schreiben → zurücklesen → tief vergleichen → bei Abweichung genau 1 Retry →
 * bei erneutem Fehlschlag `SpeicherFehler`.
 *
 * `textFuer` übersetzt die technische Ursache in einen deutschen Satz für die Nutzerin.
 */
export async function schreibenMitPruefung(
  tier: StorageTier,
  daten: AppDaten,
  schreiben: (daten: AppDaten) => Promise<void>,
  zurueckLesen: () => Promise<unknown>,
  textFuer: (ursache: unknown) => string,
): Promise<void> {
  let letzteUrsache: unknown = null;

  for (let versuch = 0; versuch < SCHREIB_VERSUCHE; versuch++) {
    try {
      await schreiben(daten);
      const zurueck = await zurueckLesen();
      if (tiefGleich(zurueck, daten)) return;
      letzteUrsache = new Error(
        'Der Speicher hat nach dem Schreiben andere Daten zurückgeliefert als geschrieben wurden.',
      );
    } catch (ursache) {
      // Nicht schlucken: die Ursache wird beim endgültigen Fehlschlag mitgegeben.
      letzteUrsache = ursache;
    }
  }

  throw new SpeicherFehler(tier, textFuer(letzteUrsache), letzteUrsache);
}

const TEXT_MEMORY_FEHLER =
  'Die Daten konnten nicht einmal im Arbeitsspeicher gesichert werden. Bitte lade die App neu und exportiere deine Daten.';

export class MemoryAdapter implements StorageAdapter {
  readonly tier: StorageTier = 'memory';

  /** Als JSON-Text, damit `laden()` echte Kopien liefert und niemand von außen mutieren kann. */
  private inhalt: string | null = null;

  /** Diese Stufe ist immer nutzbar — deshalb wirft `init()` nie. */
  async init(): Promise<void> {
    return;
  }

  async laden(): Promise<AppDaten | null> {
    if (this.inhalt === null) return null;
    try {
      return JSON.parse(this.inhalt) as AppDaten;
    } catch (ursache) {
      throw new SpeicherFehler(this.tier, TEXT_MEMORY_FEHLER, ursache);
    }
  }

  speichern(daten: AppDaten): Promise<void> {
    return schreibenMitPruefung(
      this.tier,
      daten,
      async (d) => {
        this.inhalt = JSON.stringify(d);
      },
      () => this.laden(),
      () => TEXT_MEMORY_FEHLER,
    );
  }

  async loeschen(): Promise<void> {
    this.inhalt = null;
  }
}
