/**
 * Tests für die Stufenwahl und die Herabstufung.
 * Wichtigster Punkt: beim Herabstufen dürfen die bisherigen Daten nicht verloren gehen.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startDaten, type AppDaten } from '../domain/types';
import { adapterWaehlen, herabstufen, speicherstufenZuruecksetzen } from './tiering';

/** Minimaler Storage-Fake, damit die Stufe 'localstorage' im Test überhaupt existiert. */
class FakeStorage {
  private readonly inhalt = new Map<string, string>();
  get length(): number {
    return this.inhalt.size;
  }
  clear(): void {
    this.inhalt.clear();
  }
  getItem(k: string): string | null {
    const w = this.inhalt.get(k);
    return w === undefined ? null : w;
  }
  key(i: number): string | null {
    return Array.from(this.inhalt.keys())[i] ?? null;
  }
  removeItem(k: string): void {
    this.inhalt.delete(k);
  }
  setItem(k: string, w: string): void {
    this.inhalt.set(k, w);
  }
}

function localStorageSetzen(speicher: FakeStorage | null): void {
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

beforeEach(() => speicherstufenZuruecksetzen());
afterEach(() => {
  localStorageSetzen(null);
  speicherstufenZuruecksetzen();
});

describe('adapterWaehlen', () => {
  it('landet ohne IndexedDB und ohne localStorage auf memory — und wirft nicht', async () => {
    const adapter = await adapterWaehlen();
    expect(adapter.tier).toBe('memory');
  });

  it('nimmt localStorage, wenn IndexedDB fehlt', async () => {
    localStorageSetzen(new FakeStorage());
    const adapter = await adapterWaehlen();
    expect(adapter.tier).toBe('localstorage');
  });
});

describe('herabstufen', () => {
  it('übernimmt die zuletzt bekannten Daten in die neue Stufe', async () => {
    localStorageSetzen(new FakeStorage());
    const oben = await adapterWaehlen();
    expect(oben.tier).toBe('localstorage');

    const daten: AppDaten = startDaten();
    daten.monate.push({
      id: 'm1',
      jahr: 2026,
      monat: 8,
      etfDepotCent: 512345,
      tagesgeldCent: 210000,
      erfasstAm: 1754000000000,
    });
    await oben.speichern(daten);

    const unten = await herabstufen(new Error('Schreiben fehlgeschlagen'), 'localstorage');
    expect(unten?.tier).toBe('memory');
    // Kein Datenverlust: der alte Stand steht bereits in der neuen Stufe.
    expect(await unten?.laden()).toEqual(daten);
  });

  it('überspringt eine unbrauchbare Zwischenstufe', async () => {
    // Kein localStorage vorhanden → von indexeddb direkt auf memory.
    const unten = await herabstufen(new Error('x'), 'indexeddb');
    expect(unten?.tier).toBe('memory');
  });

  it('liefert null, wenn unterhalb der aktuellen Stufe nichts mehr kommt', async () => {
    expect(await herabstufen(new Error('x'), 'memory')).toBeNull();
  });

  it('bleibt bei leerer Quelle stumm und liefert trotzdem eine Stufe', async () => {
    localStorageSetzen(new FakeStorage());
    await adapterWaehlen(); // localstorage initialisiert, aber noch nie geschrieben
    const unten = await herabstufen(new Error('x'), 'localstorage');
    expect(unten?.tier).toBe('memory');
    expect(await unten?.laden()).toBeNull();
  });
});
