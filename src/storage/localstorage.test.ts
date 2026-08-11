/**
 * Tests für den localStorage-Adapter. Ohne jsdom — der Fake bildet nur `Storage` nach.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { startDaten, type AppDaten } from '../domain/types';
import { SpeicherFehler } from './adapter';
import { LOCALSTORAGE_SCHLUESSEL, LocalStorageAdapter, istQuotaFehler } from './localstorage';

function quotaFehler(): Error {
  const f = new Error('Speicher voll');
  f.name = 'QuotaExceededError';
  return f;
}

class FakeStorage {
  private readonly inhalt = new Map<string, string>();
  /** Wenn gesetzt, wirft `setItem` diesen Fehler (iOS Private Mode). */
  wirftBeimSchreiben: unknown = null;
  /** Wenn true, meldet `setItem` Erfolg, speichert aber nichts (stiller Datenverlust). */
  schluckt = false;
  setzAufrufe = 0;

  get length(): number {
    return this.inhalt.size;
  }
  clear(): void {
    this.inhalt.clear();
  }
  getItem(schluessel: string): string | null {
    const wert = this.inhalt.get(schluessel);
    return wert === undefined ? null : wert;
  }
  key(index: number): string | null {
    return Array.from(this.inhalt.keys())[index] ?? null;
  }
  removeItem(schluessel: string): void {
    this.inhalt.delete(schluessel);
  }
  setItem(schluessel: string, wert: string): void {
    this.setzAufrufe += 1;
    if (this.wirftBeimSchreiben) throw this.wirftBeimSchreiben;
    if (this.schluckt) return;
    this.inhalt.set(schluessel, wert);
  }
}

function installiere(speicher: FakeStorage | null): void {
  if (speicher === null) {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    return;
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: speicher,
    configurable: true,
    writable: true,
  });
}

afterEach(() => installiere(null));

describe('istQuotaFehler', () => {
  it('erkennt die Browser-Varianten eines vollen Speichers', () => {
    expect(istQuotaFehler(quotaFehler())).toBe(true);
    expect(istQuotaFehler({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(istQuotaFehler({ code: 22 })).toBe(true);
    expect(istQuotaFehler(new Error('irgendwas'))).toBe(false);
    expect(istQuotaFehler(null)).toBe(false);
    expect(istQuotaFehler('voll')).toBe(false);
  });
});

describe('LocalStorageAdapter', () => {
  it('speichert und lädt einen vollständigen Datensatz', async () => {
    const speicher = new FakeStorage();
    installiere(speicher);
    const adapter = new LocalStorageAdapter();

    await adapter.init();
    expect(await adapter.laden()).toBeNull();

    const daten = startDaten();
    await adapter.speichern(daten);
    expect(await adapter.laden()).toEqual(daten);
    expect(speicher.getItem(LOCALSTORAGE_SCHLUESSEL)).not.toBeNull();
  });

  it('räumt den Probeschlüssel aus init() wieder weg', async () => {
    const speicher = new FakeStorage();
    installiere(speicher);
    await new LocalStorageAdapter().init();
    expect(speicher.length).toBe(0);
  });

  it('erkennt den iOS-Private-Mode: localStorage da, Schreiben wirft', async () => {
    const speicher = new FakeStorage();
    speicher.wirftBeimSchreiben = quotaFehler();
    installiere(speicher);

    const fehler = await new LocalStorageAdapter()
      .init()
      .then(() => null)
      .catch((f: unknown) => f);
    expect(fehler).toBeInstanceOf(SpeicherFehler);
    expect((fehler as SpeicherFehler).nutzerText).toContain('privaten Modus');
    expect((fehler as SpeicherFehler).tier).toBe('localstorage');
  });

  it('übersetzt QuotaExceededError beim Speichern in einen SpeicherFehler mit nutzerText', async () => {
    const speicher = new FakeStorage();
    installiere(speicher);
    const adapter = new LocalStorageAdapter();
    await adapter.init();

    speicher.wirftBeimSchreiben = quotaFehler();
    const fehler = await adapter.speichern(startDaten()).catch((f: unknown) => f);
    expect(fehler).toBeInstanceOf(SpeicherFehler);
    expect((fehler as SpeicherFehler).nutzerText.length).toBeGreaterThan(0);
    expect((fehler as SpeicherFehler).nutzerText).toContain('exportiere');
  });

  it('erkennt stillen Datenverlust beim Zurücklesen und versucht genau einmal erneut', async () => {
    const speicher = new FakeStorage();
    installiere(speicher);
    const adapter = new LocalStorageAdapter();
    await adapter.init();

    speicher.schluckt = true;
    speicher.setzAufrufe = 0;
    await expect(adapter.speichern(startDaten())).rejects.toBeInstanceOf(SpeicherFehler);
    expect(speicher.setzAufrufe).toBe(2);
  });

  it('erkennt abweichende Daten beim Zurücklesen', async () => {
    const speicher = new FakeStorage();
    installiere(speicher);
    const adapter = new LocalStorageAdapter();
    await adapter.init();

    const daten = startDaten();
    // Der Speicher liefert konsequent etwas anderes zurück als geschrieben wurde.
    const abweichend: AppDaten = { ...daten, einstellungen: { ...daten.einstellungen, einkommenCent: 1 } };
    speicher.setItem(LOCALSTORAGE_SCHLUESSEL, JSON.stringify(abweichend));
    speicher.schluckt = true;

    await expect(adapter.speichern(daten)).rejects.toBeInstanceOf(SpeicherFehler);
  });

  it('wirft beim Laden beschädigter Daten, statt still Startwerte zu liefern', async () => {
    const speicher = new FakeStorage();
    installiere(speicher);
    const adapter = new LocalStorageAdapter();
    await adapter.init();
    speicher.setItem(LOCALSTORAGE_SCHLUESSEL, '{kaputt');

    await expect(adapter.laden()).rejects.toBeInstanceOf(SpeicherFehler);
  });

  it('wirft in init(), wenn localStorage gar nicht vorhanden ist', async () => {
    installiere(null);
    await expect(new LocalStorageAdapter().init()).rejects.toBeInstanceOf(SpeicherFehler);
  });

  it('löscht den Datensatz', async () => {
    const speicher = new FakeStorage();
    installiere(speicher);
    const adapter = new LocalStorageAdapter();
    await adapter.init();

    await adapter.speichern(startDaten());
    await adapter.loeschen();
    expect(await adapter.laden()).toBeNull();
  });
});
