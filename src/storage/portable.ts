/**
 * Export/Import als JSON. Ohne Backend ist das die einzige Sicherung des Nutzers.
 * Deshalb: lesbar eingerückt (notfalls von Hand reparierbar) und beim Import erst
 * vollständig prüfen, dann zurückgeben — nie eine halb importierte Datenlage.
 */

import type { AppDaten } from '../domain/types';
import { SpeicherFehler } from './adapter';
import { migriere } from './migrate';

const TEXT_KEIN_JSON =
  'Die Datei konnte nicht gelesen werden — sie ist keine gültige Sparreise-Sicherung (kein lesbares JSON).';
const TEXT_UNBRAUCHBAR =
  'Die Datei ist keine gültige Sparreise-Sicherung oder stammt aus einer neueren Version der App. Es wurde nichts geändert.';

/** Serialisiert die Daten als lesbares JSON (2 Leerzeichen Einrückung). */
export function exportierenAlsJson(daten: Readonly<AppDaten>): string {
  return JSON.stringify(daten, null, 2);
}

/** Dateiname für den Download, z.B. "sparreise-2026-08-10.json". */
export function exportDateiname(jetzt: Date = new Date()): string {
  const d = Number.isFinite(jetzt.getTime()) ? jetzt : new Date();
  const zwei = (n: number): string => String(n).padStart(2, '0');
  return `sparreise-${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}.json`;
}

/**
 * Liest JSON-Text ein und validiert/migriert ihn über `migriere()`.
 * Wirft `SpeicherFehler` mit deutschem `nutzerText`, wenn der Text unbrauchbar ist.
 *
 * Der Tier 'memory' im Fehler ist eine Konvention: ein Import gehört zu keiner
 * Speicherstufe, angezeigt wird ohnehin nur `nutzerText`.
 */
export function importierenAusJson(text: string): AppDaten {
  let roh: unknown;
  try {
    roh = JSON.parse(text) as unknown;
  } catch (ursache) {
    // Technische Ursache bleibt in `ursache` erhalten, dem Nutzer zeigen wir den Klartext.
    throw new SpeicherFehler('memory', TEXT_KEIN_JSON, ursache);
  }

  const daten = migriere(roh);
  if (daten === null) throw new SpeicherFehler('memory', TEXT_UNBRAUCHBAR, roh);
  return daten;
}
