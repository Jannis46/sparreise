/**
 * Wählt den besten nutzbaren Adapter und stuft bei Schreibfehlern herab.
 * Signaturen sind vom ARCHITEKT festgelegt (main.ts und store.ts hängen daran).
 *
 * Grundsatz: hier wird NIE geworfen. Am Ende der Kette steht immer der MemoryAdapter —
 * lieber flüchtige Daten plus sichtbare Warnung als eine App, die gar nicht startet.
 */

import type { Herabstufen } from '../state/store';
import { TIER_REIHENFOLGE, type StorageAdapter, type StorageTier } from './adapter';
import { IndexedDbAdapter } from './indexeddb';
import { LocalStorageAdapter } from './localstorage';
import { MemoryAdapter } from './memory';

const BAUER: Readonly<Record<StorageTier, () => StorageAdapter>> = {
  indexeddb: () => new IndexedDbAdapter(),
  localstorage: () => new LocalStorageAdapter(),
  memory: () => new MemoryAdapter(),
};

/**
 * Bereits erfolgreich initialisierte Adapter. Zweck: beim Herabstufen kennen wir die
 * höhere Stufe noch und können ihren letzten Stand in die neue Stufe übernehmen.
 */
const bekannt = new Map<StorageTier, StorageAdapter>();

/** Nur für Tests: verwirft die gemerkten Adapter. */
export function speicherstufenZuruecksetzen(): void {
  bekannt.clear();
}

async function initialisiert(tier: StorageTier): Promise<StorageAdapter | null> {
  const vorhanden = bekannt.get(tier);
  if (vorhanden) return vorhanden;

  const adapter = BAUER[tier]();
  try {
    await adapter.init();
  } catch (ursache) {
    // Bewusst verworfen: eine unbrauchbare Stufe ist der Normalfall (Private Mode,
    // kein IndexedDB). Der Nutzer erfährt davon über StoreStatus.tier + TIER_TEXT.
    console.warn(`Speicherstufe "${tier}" ist nicht nutzbar`, ursache);
    return null;
  }
  bekannt.set(tier, adapter);
  return adapter;
}

/**
 * Probiert TIER_REIHENFOLGE durch: `init()` aufrufen, erster Erfolg gewinnt.
 * Wirft nur, wenn selbst 'memory' nicht initialisierbar ist (praktisch unmöglich).
 */
export async function adapterWaehlen(): Promise<StorageAdapter> {
  for (const tier of TIER_REIHENFOLGE) {
    const adapter = await initialisiert(tier);
    if (adapter) return adapter;
  }
  // Gürtel zum Hosenträger: TIER_REIHENFOLGE endet auf 'memory', dessen init() nie wirft.
  const ersatz = new MemoryAdapter();
  await ersatz.init();
  bekannt.set('memory', ersatz);
  return ersatz;
}

/**
 * Übernimmt den zuletzt bekannten Stand der ausgefallenen Stufe in die neue.
 * Ohne das stünde die neue Stufe leer da, bis der Store das nächste Mal schreibt.
 */
async function datenUebernehmen(vonTier: StorageTier, ziel: StorageAdapter): Promise<void> {
  const quelle = bekannt.get(vonTier);
  if (!quelle) return;
  try {
    const daten = await quelle.laden();
    if (daten !== null) await ziel.speichern(daten);
  } catch (ursache) {
    // Bewusst verworfen: die Übernahme ist nur die Rettung des ALTEN Standes. Der Store
    // schreibt unmittelbar nach dem Herabstufen ohnehin den aktuellen Stand in die neue
    // Stufe und meldet einen Fehlschlag dort sichtbar über StoreStatus.letzterFehler.
    console.warn('Übernahme des bisherigen Standes in die neue Speicherstufe fehlgeschlagen', ursache);
  }
}

/**
 * Liefert den nächstschlechteren initialisierten Adapter unterhalb von `aktuellerTier`,
 * oder null, wenn keiner mehr übrig ist. Wird vom Store bei Schreibfehlern gerufen.
 */
export const herabstufen: Herabstufen = async (
  _fehler: unknown,
  aktuellerTier: StorageTier,
): Promise<StorageAdapter | null> => {
  const start = TIER_REIHENFOLGE.indexOf(aktuellerTier);
  if (start < 0) return null;

  for (let i = start + 1; i < TIER_REIHENFOLGE.length; i++) {
    const tier = TIER_REIHENFOLGE[i];
    if (!tier) continue;
    const neu = await initialisiert(tier);
    if (!neu) continue;
    await datenUebernehmen(aktuellerTier, neu);
    return neu;
  }
  return null;
};
