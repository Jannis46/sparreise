/**
 * Tests für den IndexedDB-Adapter.
 * Es gibt kein jsdom/fake-indexeddb im Projekt — die Fakes hier sind bewusst minimal
 * und bilden nur nach, was der Adapter tatsächlich benutzt.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDaten, type AppDaten } from '../domain/types';
import { SpeicherFehler } from './adapter';
import { IDB_SCHLUESSEL, IDB_TIMEOUT_MS, IndexedDbAdapter } from './indexeddb';

type Ruf = (() => void) | null;

class FakeAnfrage {
  result: unknown = undefined;
  error: Error | null = null;
  onsuccess: Ruf = null;
  onerror: Ruf = null;
}

class FakeOeffnung extends FakeAnfrage {
  onupgradeneeded: Ruf = null;
  onblocked: Ruf = null;
}

class FakeTx {
  oncomplete: Ruf = null;
  onabort: Ruf = null;
  onerror: Ruf = null;
  error: Error | null = null;

  private readonly aufgaben: Array<() => void> = [];
  private readonly beimCommit: Array<() => void> = [];
  private beendet = false;

  constructor(
    private readonly db: FakeDb,
    private readonly modus: string,
  ) {
    setTimeout(() => this.lauf(), 0);
  }

  plane(aufgabe: () => void, beimCommit?: () => void): void {
    this.aufgaben.push(aufgabe);
    if (beimCommit) this.beimCommit.push(beimCommit);
  }

  objectStore(): FakeStore {
    return new FakeStore(this, this.db);
  }

  abbrechen(fehler: Error): void {
    if (this.beendet) return;
    this.beendet = true;
    this.error = fehler;
    if (this.onabort) this.onabort();
  }

  private lauf(): void {
    for (const aufgabe of this.aufgaben) {
      if (this.beendet) return;
      aufgabe();
    }
    if (this.beendet) return;
    if (this.modus === 'readwrite' && this.db.commitScheitert) {
      // Genau der gefährliche Fall: die Anfrage meldete Erfolg, der Commit scheitert.
      this.abbrechen(new Error('Commit fehlgeschlagen'));
      return;
    }
    this.beendet = true;
    for (const schritt of this.beimCommit) schritt();
    if (this.oncomplete) this.oncomplete();
  }
}

class FakeStore {
  constructor(
    private readonly tx: FakeTx,
    private readonly db: FakeDb,
  ) {}

  get(schluessel: string): FakeAnfrage {
    const anfrage = new FakeAnfrage();
    this.tx.plane(() => {
      const roh = this.db.inhalt.get(schluessel);
      anfrage.result = this.db.verfaelschen && roh !== undefined ? this.db.verfaelschen(roh) : roh;
      if (anfrage.onsuccess) anfrage.onsuccess();
    });
    return anfrage;
  }

  put(wert: unknown, schluessel: string): FakeAnfrage {
    const anfrage = new FakeAnfrage();
    this.db.putAufrufe += 1;
    const kopie = JSON.parse(JSON.stringify(wert)) as unknown;
    this.tx.plane(
      () => {
        anfrage.result = schluessel;
        if (anfrage.onsuccess) anfrage.onsuccess();
      },
      () => this.db.inhalt.set(schluessel, kopie),
    );
    return anfrage;
  }

  delete(schluessel: string): FakeAnfrage {
    const anfrage = new FakeAnfrage();
    this.tx.plane(
      () => {
        if (anfrage.onsuccess) anfrage.onsuccess();
      },
      () => this.db.inhalt.delete(schluessel),
    );
    return anfrage;
  }
}

class FakeDb {
  readonly inhalt = new Map<string, unknown>();
  readonly objectStoreNames = { contains: (): boolean => true };
  commitScheitert = false;
  verfaelschen: ((wert: unknown) => unknown) | null = null;
  putAufrufe = 0;
  onversionchange: Ruf = null;
  onclose: Ruf = null;

  transaction(_name: string, modus: string): FakeTx {
    return new FakeTx(this, modus);
  }
  close(): void {
    /* nichts zu tun im Fake */
  }
  createObjectStore(): void {
    /* nichts zu tun im Fake */
  }
}

class FakeFabrik {
  oeffnungen = 0;
  constructor(
    readonly db: FakeDb,
    private readonly modus: 'ok' | 'haengt' | 'fehler' | 'blockiert' = 'ok',
  ) {}

  open(): FakeOeffnung {
    this.oeffnungen += 1;
    const anfrage = new FakeOeffnung();
    if (this.modus === 'haengt') return anfrage; // meldet sich nie zurück (iOS-Bug)
    setTimeout(() => {
      if (this.modus === 'fehler') {
        anfrage.error = new Error('open fehlgeschlagen');
        if (anfrage.onerror) anfrage.onerror();
        return;
      }
      if (this.modus === 'blockiert') {
        if (anfrage.onblocked) anfrage.onblocked();
        return;
      }
      anfrage.result = this.db;
      if (anfrage.onsuccess) anfrage.onsuccess();
    }, 0);
    return anfrage;
  }
}

function installiere(fabrik: FakeFabrik | null): void {
  if (fabrik === null) {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    return;
  }
  Object.defineProperty(globalThis, 'indexedDB', {
    value: fabrik,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  installiere(null);
  vi.useRealTimers();
});

describe('IndexedDbAdapter', () => {
  it('speichert und lädt einen vollständigen Datensatz', async () => {
    const fabrik = new FakeFabrik(new FakeDb());
    installiere(fabrik);
    const adapter = new IndexedDbAdapter();

    await adapter.init();
    expect(await adapter.laden()).toBeNull();

    const daten = startDaten();
    await adapter.speichern(daten);

    const zurueck = (await adapter.laden()) as AppDaten;
    expect(zurueck).toEqual(daten);
    expect(fabrik.db.inhalt.has(IDB_SCHLUESSEL)).toBe(true);
  });

  it('meldet Erfolg erst nach dem Commit, nicht schon bei request.onsuccess', async () => {
    const db = new FakeDb();
    db.commitScheitert = true;
    installiere(new FakeFabrik(db));
    const adapter = new IndexedDbAdapter();
    await adapter.init();

    await expect(adapter.speichern(startDaten())).rejects.toBeInstanceOf(SpeicherFehler);
    // Der Commit ist nie durchgelaufen — es darf auch nichts in der Datenbank liegen.
    expect(db.inhalt.size).toBe(0);
    expect(db.putAufrufe).toBe(2); // erster Versuch + genau 1 Retry
  });

  it('erkennt abweichende Daten beim Zurücklesen und wirft nach dem Retry', async () => {
    const db = new FakeDb();
    db.verfaelschen = (wert) => {
      const kopie = JSON.parse(JSON.stringify(wert)) as AppDaten;
      kopie.einstellungen.einkommenCent = 1;
      return kopie;
    };
    installiere(new FakeFabrik(db));
    const adapter = new IndexedDbAdapter();
    await adapter.init();

    const fehler = await adapter.speichern(startDaten()).catch((f: unknown) => f);
    expect(fehler).toBeInstanceOf(SpeicherFehler);
    expect((fehler as SpeicherFehler).nutzerText.length).toBeGreaterThan(0);
    expect((fehler as SpeicherFehler).tier).toBe('indexeddb');
    expect(db.putAufrufe).toBe(2);
  });

  it('bricht ein hängendes open nach IDB_TIMEOUT_MS ab, statt ewig zu warten', async () => {
    vi.useFakeTimers();
    installiere(new FakeFabrik(new FakeDb(), 'haengt'));
    const adapter = new IndexedDbAdapter();

    const erwartung = expect(adapter.init()).rejects.toBeInstanceOf(SpeicherFehler);
    await vi.advanceTimersByTimeAsync(IDB_TIMEOUT_MS + 50);
    await erwartung;
  });

  it('wirft in init(), wenn IndexedDB gar nicht vorhanden ist', async () => {
    installiere(null);
    await expect(new IndexedDbAdapter().init()).rejects.toBeInstanceOf(SpeicherFehler);
  });

  it('wirft in init(), wenn open() einen Fehler meldet', async () => {
    installiere(new FakeFabrik(new FakeDb(), 'fehler'));
    await expect(new IndexedDbAdapter().init()).rejects.toBeInstanceOf(SpeicherFehler);
  });

  it('behandelt onblocked, statt hängen zu bleiben', async () => {
    installiere(new FakeFabrik(new FakeDb(), 'blockiert'));
    await expect(new IndexedDbAdapter().init()).rejects.toBeInstanceOf(SpeicherFehler);
  });

  it('löscht den Datensatz', async () => {
    const fabrik = new FakeFabrik(new FakeDb());
    installiere(fabrik);
    const adapter = new IndexedDbAdapter();
    await adapter.init();

    await adapter.speichern(startDaten());
    await adapter.loeschen();
    expect(await adapter.laden()).toBeNull();
  });
});
