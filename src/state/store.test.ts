import { describe, expect, it } from 'vitest';
import { FIXKOSTEN_START_ANZAHL, startDaten, type AppDaten } from '../domain/types';
import { SpeicherFehler, type StorageAdapter, type StorageTier } from '../storage/adapter';
import { Store } from './store';

/** Test-Adapter: zählt Schreibvorgänge und erkennt Überlappungen. */
class TestAdapter implements StorageAdapter {
  readonly tier: StorageTier;
  schreibvorgaenge: AppDaten[] = [];
  gleichzeitig = 0;
  maxGleichzeitig = 0;
  scheitertBis = 0;
  private readonly verzoegerung: number;

  constructor(tier: StorageTier = 'indexeddb', verzoegerung = 5) {
    this.tier = tier;
    this.verzoegerung = verzoegerung;
  }

  async init(): Promise<void> {}
  async laden(): Promise<AppDaten | null> {
    return null;
  }
  async loeschen(): Promise<void> {}

  async speichern(daten: AppDaten): Promise<void> {
    this.gleichzeitig += 1;
    this.maxGleichzeitig = Math.max(this.maxGleichzeitig, this.gleichzeitig);
    await new Promise((r) => setTimeout(r, this.verzoegerung));
    this.gleichzeitig -= 1;
    if (this.scheitertBis > 0) {
      this.scheitertBis -= 1;
      throw new SpeicherFehler(this.tier, 'Testfehler beim Speichern.');
    }
    this.schreibvorgaenge.push(JSON.parse(JSON.stringify(daten)) as AppDaten);
  }
}

describe('Store', () => {
  it('schreibt nie zwei Vorgänge gleichzeitig und coalesced Folgeeingaben', async () => {
    const adapter = new TestAdapter();
    const store = new Store(adapter, startDaten());

    // 20 schnelle Mutationen ohne await dazwischen
    for (let i = 0; i < 20; i++) {
      void store.einstellungenSetzen({ freizeitCent: 30000 + i });
    }
    await store.flush();

    expect(adapter.maxGleichzeitig).toBe(1);
    // kein Schreiben pro Mutation, aber mindestens einer
    expect(adapter.schreibvorgaenge.length).toBeGreaterThan(0);
    expect(adapter.schreibvorgaenge.length).toBeLessThan(20);
    // der letzte geschriebene Stand ist der neueste
    const letzter = adapter.schreibvorgaenge[adapter.schreibvorgaenge.length - 1];
    expect(letzter?.einstellungen.freizeitCent).toBe(30019);
    expect(store.getStatus().letzterFehler).toBeNull();
    expect(store.getStatus().letzterSpeicherzeitpunkt).not.toBeNull();
  });

  it('meldet Schreibfehler sichtbar im Status statt zu werfen', async () => {
    const adapter = new TestAdapter();
    adapter.scheitertBis = 99;
    const store = new Store(adapter, startDaten());

    await store.einstellungenSetzen({ freizeitCent: 1 });

    expect(store.getStatus().letzterFehler).toBe('Testfehler beim Speichern.');
    expect(store.getStatus().speichertGerade).toBe(false);
  });

  it('stuft bei Schreibfehler herab und schreibt mit dem Ersatzadapter', async () => {
    const kaputt = new TestAdapter('indexeddb');
    kaputt.scheitertBis = 99;
    const ersatz = new TestAdapter('memory');
    const store = new Store(kaputt, startDaten(), {
      herabstufen: async () => ersatz,
    });

    await store.einstellungenSetzen({ freizeitCent: 42 });

    expect(store.getStatus().tier).toBe('memory');
    expect(ersatz.schreibvorgaenge).toHaveLength(1);
    expect(store.getStatus().letzterFehler).toContain('Arbeitsspeicher');
  });

  it('benachrichtigt Abonnenten und meldet sie sauber ab', async () => {
    const store = new Store(new TestAdapter(), startDaten());
    let treffer = 0;
    const ab = store.subscribe(() => {
      treffer += 1;
    });
    await store.fixkostenHinzufuegen('Test', 100);
    expect(treffer).toBeGreaterThan(0);
    const stand = treffer;
    ab();
    await store.fixkostenHinzufuegen('Test 2', 100);
    expect(treffer).toBe(stand);
    expect(store.getDaten().fixkosten).toHaveLength(FIXKOSTEN_START_ANZAHL + 2);
  });

  it('fixkostenVerschieben behält alle Posten', async () => {
    const store = new Store(new TestAdapter(), startDaten());
    const id = store.getDaten().fixkosten[FIXKOSTEN_START_ANZAHL - 1]?.id as string;
    await store.fixkostenVerschieben(id, 0);
    expect(store.getDaten().fixkosten).toHaveLength(FIXKOSTEN_START_ANZAHL);
    expect(store.getDaten().fixkosten[0]?.name).toBe('Friseur');
  });
});
