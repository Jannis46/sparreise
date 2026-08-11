/**
 * Bevorzugte Speicherstufe: IndexedDB.
 *
 * Zwei Fallen, die hier bewusst behandelt werden:
 *  1. Auf iOS Safari kann `indexedDB.open()` ohne Fehler NIE zurückkehren. Deshalb hat
 *     jede Operation einen Timeout (`IDB_TIMEOUT_MS`) — sonst hängt der App-Start ewig.
 *  2. `request.onsuccess` bedeutet NICHT "geschrieben". Erst `transaction.oncomplete`
 *     heißt committed. Wir warten ausschließlich auf `oncomplete`.
 *
 * Vertrag: siehe adapter.ts (write → read-back → deep-compare → 1 Retry → SpeicherFehler).
 */

import type { AppDaten } from '../domain/types';
import { SpeicherFehler, type StorageAdapter, type StorageTier } from './adapter';
import { istQuotaFehler } from './localstorage';
import { schreibenMitPruefung } from './memory';

export const IDB_NAME = 'sparreise';
export const IDB_VERSION = 1;
export const IDB_STORE = 'daten';
export const IDB_SCHLUESSEL = 'app';
/** Nach dieser Zeit gilt eine Operation als gescheitert (iOS-Hänger). */
export const IDB_TIMEOUT_MS = 3000;

const TEXT_NICHT_NUTZBAR =
  'Die dauerhafte Datenbank des Browsers (IndexedDB) ist nicht nutzbar. Sparreise weicht auf einen einfacheren Speicher aus.';
const TEXT_SCHREIBEN =
  'Die Daten konnten nicht dauerhaft in der Datenbank gespeichert werden. Bitte exportiere deine Daten zur Sicherheit.';
const TEXT_VOLL =
  'Der Gerätespeicher ist voll — die Daten konnten nicht gespeichert werden. Bitte schaffe Platz und exportiere deine Daten zur Sicherheit.';
const TEXT_LESEN = 'Die gespeicherten Daten konnten nicht aus der Datenbank gelesen werden.';
const TEXT_LOESCHEN = 'Die Daten konnten nicht aus der Datenbank gelöscht werden.';

/**
 * Sicherheitsgurt gegen hängende IndexedDB-Aufrufe. Die zugrunde liegende Anfrage
 * lässt sich nicht abbrechen — sie läuft ins Leere, ihr Ergebnis wird verworfen.
 */
function mitTimeout<T>(versprechen: Promise<T>, ms: number, was: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const uhr = setTimeout(() => {
      reject(new Error(`Zeitüberschreitung nach ${ms} ms: ${was}`));
    }, ms);
    versprechen.then(
      (wert) => {
        clearTimeout(uhr);
        resolve(wert);
      },
      (fehler: unknown) => {
        clearTimeout(uhr);
        reject(fehler);
      },
    );
  });
}

/** Liefert die IndexedDB-Fabrik oder null. Der Zugriff selbst kann werfen (Storage gesperrt). */
function fabrik(): IDBFactory | null {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null ? indexedDB : null;
  } catch (ursache) {
    // Bewusst verworfen: "nicht zugreifbar" ist hier dasselbe wie "nicht vorhanden".
    // Sichtbar wird das über den SpeicherFehler aus init() und die Herabstufung.
    console.warn('IndexedDB ist nicht zugreifbar', ursache);
    return null;
  }
}

export class IndexedDbAdapter implements StorageAdapter {
  readonly tier: StorageTier = 'indexeddb';

  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    try {
      await this.oeffnen();
      // Probelesen: erkennt sofort, ob Transaktionen auf diesem Gerät überhaupt laufen.
      await this.rohLesen();
    } catch (ursache) {
      throw new SpeicherFehler(this.tier, TEXT_NICHT_NUTZBAR, ursache);
    }
  }

  async laden(): Promise<AppDaten | null> {
    try {
      const wert = await this.rohLesen();
      return wert === undefined || wert === null ? null : (wert as AppDaten);
    } catch (ursache) {
      throw new SpeicherFehler(this.tier, TEXT_LESEN, ursache);
    }
  }

  speichern(daten: AppDaten): Promise<void> {
    return schreibenMitPruefung(
      this.tier,
      daten,
      async (d) => {
        await this.transaktion('readwrite', (speicher) => speicher.put(d, IDB_SCHLUESSEL));
      },
      () => this.rohLesen(),
      (ursache) => (istQuotaFehler(ursache) ? TEXT_VOLL : TEXT_SCHREIBEN),
    );
  }

  async loeschen(): Promise<void> {
    try {
      await this.transaktion('readwrite', (speicher) => speicher.delete(IDB_SCHLUESSEL));
    } catch (ursache) {
      throw new SpeicherFehler(this.tier, TEXT_LOESCHEN, ursache);
    }
  }

  /** Rohes Lesen ohne Übersetzung — für den Read-back-Vergleich und für init(). */
  private rohLesen(): Promise<unknown> {
    return this.transaktion<unknown>(
      'readonly',
      (speicher) => speicher.get(IDB_SCHLUESSEL) as IDBRequest<unknown>,
    );
  }

  private oeffnen(): Promise<IDBDatabase> {
    const vorhanden = this.db;
    if (vorhanden) return Promise.resolve(vorhanden);

    const idb = fabrik();
    if (!idb) {
      return Promise.reject(new Error('IndexedDB steht in dieser Umgebung nicht zur Verfügung.'));
    }

    const oeffnung = new Promise<IDBDatabase>((resolve, reject) => {
      let anfrage: IDBOpenDBRequest;
      try {
        anfrage = idb.open(IDB_NAME, IDB_VERSION);
      } catch (ursache) {
        reject(ursache);
        return;
      }

      anfrage.onupgradeneeded = () => {
        const db = anfrage.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      // Ein anderer Tab hält noch eine alte Version offen — nicht ignorieren, sonst wartet
      // der Nutzer vor einem leeren Bildschirm, bis er den anderen Tab schließt.
      anfrage.onblocked = () => {
        reject(new Error('Die Datenbank wird von einem anderen geöffneten Tab blockiert.'));
      };
      anfrage.onerror = () => {
        reject(anfrage.error ?? new Error('Die Datenbank konnte nicht geöffnet werden.'));
      };
      anfrage.onsuccess = () => {
        const db = anfrage.result;
        // Ein anderer Tab will die Version wechseln: Verbindung freigeben, sonst blockieren
        // wir ihn dauerhaft. Beim nächsten Zugriff wird neu geöffnet.
        db.onversionchange = () => {
          db.close();
          if (this.db === db) this.db = null;
        };
        db.onclose = () => {
          if (this.db === db) this.db = null;
        };
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.close();
          reject(new Error(`Der Objektspeicher "${IDB_STORE}" fehlt in der Datenbank.`));
          return;
        }
        resolve(db);
      };
    });

    return mitTimeout(oeffnung, IDB_TIMEOUT_MS, 'Öffnen der Datenbank').then((db) => {
      this.db = db;
      return db;
    });
  }

  private async transaktion<T>(
    modus: IDBTransactionMode,
    arbeit: (speicher: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.oeffnen();

    const lauf = new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(IDB_STORE, modus);
      } catch (ursache) {
        reject(ursache);
        return;
      }

      let ergebnis: T | undefined;
      let anfrage: IDBRequest<T>;
      try {
        anfrage = arbeit(tx.objectStore(IDB_STORE));
      } catch (ursache) {
        reject(ursache);
        return;
      }

      anfrage.onsuccess = () => {
        // NUR merken. Erfolg gemeldet wird erst bei oncomplete — vorher ist nichts committed.
        ergebnis = anfrage.result;
      };
      anfrage.onerror = () => {
        reject(anfrage.error ?? new Error('Die Datenbankanfrage ist fehlgeschlagen.'));
      };
      tx.oncomplete = () => resolve(ergebnis as T);
      tx.onabort = () => reject(tx.error ?? new Error('Die Datenbank-Transaktion wurde abgebrochen.'));
      tx.onerror = () => reject(tx.error ?? new Error('Die Datenbank-Transaktion ist fehlgeschlagen.'));
    });

    return mitTimeout(lauf, IDB_TIMEOUT_MS, `Datenbankzugriff (${modus})`).catch((fehler: unknown) => {
      // Nach Timeout/Abbruch kann die Verbindung tot sein: verwerfen, damit der Retry
      // aus schreibenMitPruefung mit einer frischen Verbindung arbeitet.
      this.db = null;
      throw fehler;
    });
  }
}
