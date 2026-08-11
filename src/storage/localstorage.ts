/**
 * Mittlere Speicherstufe: localStorage.
 *
 * Falle: im privaten Modus älterer iOS-Safari-Versionen EXISTIERT `localStorage`,
 * wirft aber beim ersten `setItem` einen `QuotaExceededError`. Ein Typcheck reicht
 * deshalb nicht — `init()` schreibt, liest und löscht aktiv einen Probewert.
 *
 * Vertrag: siehe adapter.ts (write → read-back → deep-compare → 1 Retry → SpeicherFehler).
 */

import type { AppDaten } from '../domain/types';
import { SpeicherFehler, type StorageAdapter, type StorageTier } from './adapter';
import { schreibenMitPruefung } from './memory';

export const LOCALSTORAGE_SCHLUESSEL = 'sparreise.daten.v1';
/** Schlüssel des Probeschreibens in `init()`. Wird sofort wieder entfernt. */
export const LOCALSTORAGE_PROBE_SCHLUESSEL = 'sparreise.probe';

const TEXT_NICHT_VORHANDEN =
  'Dieser Browser stellt keinen lokalen Speicher zur Verfügung. Sparreise weicht auf den Arbeitsspeicher aus.';
const TEXT_VOLL =
  'Der Browser lässt kein Speichern zu — entweder ist der Speicher voll oder du surfst im privaten Modus. Bitte exportiere deine Daten und beende den privaten Modus.';
const TEXT_SCHREIBEN =
  'Die Daten konnten nicht im Browserspeicher gesichert werden. Bitte exportiere deine Daten zur Sicherheit.';
const TEXT_LESEN =
  'Die gespeicherten Daten konnten nicht gelesen werden — sie sind beschädigt oder unvollständig.';
const TEXT_LOESCHEN = 'Die Daten konnten nicht aus dem Browserspeicher gelöscht werden.';

/**
 * Erkennt einen vollen bzw. gesperrten Speicher. Die Namen und Codes unterscheiden sich
 * je nach Browser; `code 22`/`1014` sind die alten Safari- bzw. Firefox-Varianten.
 * Wird auch vom IndexedDB-Adapter genutzt.
 */
export function istQuotaFehler(fehler: unknown): boolean {
  if (fehler === null || typeof fehler !== 'object') return false;
  const f = fehler as { name?: unknown; code?: unknown };
  return (
    f.name === 'QuotaExceededError' ||
    f.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    f.code === 22 ||
    f.code === 1014
  );
}

/** Liefert den Speicher oder null. Der Zugriff selbst kann werfen (Cookies gesperrt). */
function speicherOderNull(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null ? localStorage : null;
  } catch (ursache) {
    // Bewusst verworfen: "nicht zugreifbar" ist hier dasselbe wie "nicht vorhanden".
    // Sichtbar wird das über den SpeicherFehler aus init() und die Herabstufung.
    console.warn('localStorage ist nicht zugreifbar', ursache);
    return null;
  }
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly tier: StorageTier = 'localstorage';

  async init(): Promise<void> {
    const speicher = speicherOderNull();
    if (!speicher) throw new SpeicherFehler(this.tier, TEXT_NICHT_VORHANDEN);

    // Aktiver Probelauf: schreiben, zurücklesen, löschen.
    const probe = `probe-${Date.now()}`;
    try {
      speicher.setItem(LOCALSTORAGE_PROBE_SCHLUESSEL, probe);
      const zurueck = speicher.getItem(LOCALSTORAGE_PROBE_SCHLUESSEL);
      speicher.removeItem(LOCALSTORAGE_PROBE_SCHLUESSEL);
      if (zurueck !== probe) {
        throw new Error('Der Probewert kam verändert zurück.');
      }
    } catch (ursache) {
      throw new SpeicherFehler(
        this.tier,
        istQuotaFehler(ursache) ? TEXT_VOLL : TEXT_NICHT_VORHANDEN,
        ursache,
      );
    }
  }

  async laden(): Promise<AppDaten | null> {
    const wert = this.rohLesen();
    if (wert === null) return null;
    try {
      return JSON.parse(wert) as AppDaten;
    } catch (ursache) {
      throw new SpeicherFehler(this.tier, TEXT_LESEN, ursache);
    }
  }

  speichern(daten: AppDaten): Promise<void> {
    return schreibenMitPruefung(
      this.tier,
      daten,
      async (d) => {
        const speicher = speicherOderNull();
        if (!speicher) throw new Error('localStorage steht nicht mehr zur Verfügung.');
        speicher.setItem(LOCALSTORAGE_SCHLUESSEL, JSON.stringify(d));
      },
      async () => {
        const wert = this.rohLesen();
        // Rohes Lesen: kaputtes JSON wirft hier und löst damit Retry bzw. SpeicherFehler aus.
        return wert === null ? null : (JSON.parse(wert) as unknown);
      },
      (ursache) => (istQuotaFehler(ursache) ? TEXT_VOLL : TEXT_SCHREIBEN),
    );
  }

  async loeschen(): Promise<void> {
    const speicher = speicherOderNull();
    if (!speicher) return;
    try {
      speicher.removeItem(LOCALSTORAGE_SCHLUESSEL);
    } catch (ursache) {
      throw new SpeicherFehler(this.tier, TEXT_LOESCHEN, ursache);
    }
  }

  private rohLesen(): string | null {
    const speicher = speicherOderNull();
    if (!speicher) throw new SpeicherFehler(this.tier, TEXT_NICHT_VORHANDEN);
    try {
      return speicher.getItem(LOCALSTORAGE_SCHLUESSEL);
    } catch (ursache) {
      throw new SpeicherFehler(this.tier, TEXT_LESEN, ursache);
    }
  }
}
