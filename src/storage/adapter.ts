/**
 * Storage-Vertrag. Eigentümer: ARCHITEKT (nicht von Bau-Agents ändern).
 * Implementierungen: Agent "Persistenz" in indexeddb.ts / localstorage.ts / memory.ts.
 */

import type { AppDaten } from '../domain/types';

export type StorageTier = 'indexeddb' | 'localstorage' | 'memory';

/** Reihenfolge der Degradation: bester Tier zuerst. */
export const TIER_REIHENFOLGE: readonly StorageTier[] = ['indexeddb', 'localstorage', 'memory'];

/** Für die UI: menschenlesbare Bezeichnung des Tiers. */
export const TIER_TEXT: Readonly<Record<StorageTier, string>> = {
  indexeddb: 'Dauerhaft gespeichert (IndexedDB)',
  localstorage: 'Eingeschränkt gespeichert (localStorage)',
  memory: 'NUR IM ARBEITSSPEICHER — Daten gehen beim Schließen verloren!',
};

/**
 * Vertrag für jede Implementierung:
 *
 * 1. `init()` prüft aktiv, ob dieser Tier auf diesem Gerät nutzbar ist (Safari Private Mode
 *    kennt localStorage, wirft aber beim Schreiben; IndexedDB kann blockiert sein).
 *    Nicht nutzbar → `SpeicherFehler` werfen. Die Tiering-Schicht stuft dann herab.
 *
 * 2. `speichern(daten)` ist NICHT "fire and forget". Ablauf, verbindlich:
 *      a) schreiben
 *      b) zurücklesen
 *      c) Deep-Compare gegen `daten`
 *      d) bei Abweichung: genau 1 Retry (a–c erneut)
 *      e) bei erneutem Fehlschlag: `SpeicherFehler` werfen
 *    Ein geworfener `SpeicherFehler` führt dazu, dass die Tiering-Schicht eine Stufe
 *    herabstuft UND der Store den Fehler im Status sichtbar an die UI meldet.
 *
 * 3. Fehler landen NIEMALS nur in der Konsole. Jeder `SpeicherFehler` trägt `nutzerText`,
 *    einen deutschsprachigen Satz, der so wie er ist im UI angezeigt werden kann.
 *
 * 4. Deep-Compare darf `JSON.stringify` nicht naiv nutzen (Schlüsselreihenfolge!).
 *    Empfehlung: strukturelles Vergleichen oder kanonisches Serialisieren.
 *    `structuredClone` ist verboten (iOS Safari < 15.4).
 *
 * 5. Alle Methoden sind reentranzfrei zu betrachten: der Store serialisiert die Aufrufe,
 *    es läuft nie mehr als ein `speichern()` gleichzeitig.
 */
export interface StorageAdapter {
  readonly tier: StorageTier;
  /** Initialisiert; wirft, wenn dieser Tier auf diesem Gerät nicht nutzbar ist. */
  init(): Promise<void>;
  laden(): Promise<AppDaten | null>;
  /** MUSS nach dem Schreiben zurücklesen und vergleichen. Wirft bei Abweichung. */
  speichern(daten: AppDaten): Promise<void>;
  loeschen(): Promise<void>;
}

/**
 * Fehler der Speicherschicht. `nutzerText` ist Pflicht und wird der Nutzerin angezeigt.
 */
export class SpeicherFehler extends Error {
  readonly tier: StorageTier;
  readonly ursache: unknown;
  readonly nutzerText: string;

  constructor(tier: StorageTier, nutzerText: string, ursache?: unknown) {
    super(`[${tier}] ${nutzerText}`);
    this.name = 'SpeicherFehler';
    this.tier = tier;
    this.nutzerText = nutzerText;
    this.ursache = ursache;
    // Nötig, weil das Build-Target ES2020 Klassen-Vererbung korrekt abbildet,
    // ältere Downlevel-Pfade den Prototyp aber verlieren können.
    Object.setPrototypeOf(this, SpeicherFehler.prototype);
  }
}

/** Hilfsfunktion für die UI: aus beliebigem Fehler einen anzeigbaren deutschen Text machen. */
export function nutzerTextAus(fehler: unknown): string {
  if (fehler instanceof SpeicherFehler) return fehler.nutzerText;
  if (fehler instanceof Error) return `Unerwarteter Fehler: ${fehler.message}`;
  return 'Unerwarteter Fehler beim Speichern.';
}
