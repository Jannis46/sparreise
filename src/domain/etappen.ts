/**
 * Etappen-/Fortschrittslogik der "Sparreise".
 * Eigentümer: Agent "Fachlogik". Reine Funktionen — kein DOM, kein Storage.
 */

import type { AppDaten, Monatseintrag } from './types';
import { ganzzahlig } from './geld';

export interface Etappe {
  id: string;
  name: string;
  zielCent: number;
  erreichtCent: number;
  /** 0..1, bei 1 abgeschlossen. */
  anteil: number;
  erreicht: boolean;
}

/** Zielmarken der Sparreise in Cent: 0 / 1.000 / 3.000 / 6.000 / 10.000 €. */
export const ETAPPEN_SCHWELLEN_CENT: readonly number[] = [0, 100_000, 300_000, 600_000, 1_000_000];

/** Kurze, ruhige Namen — max. 18 Zeichen, damit sie bei 390px nicht umbrechen. */
const ETAPPEN_NAMEN: readonly string[] = [
  'Aufbruch', // 0 €
  'Erste Rücklage', // 1.000 €
  'Sicheres Polster', // 3.000 €
  'Halbe Strecke', // 6.000 €
  'Ziel erreicht', // 10.000 €
];

// `ganzzahlig` kommt aus geld.ts — eine Implementierung für alle Domain-Module.

/** Gesamtvermögen eines Monatseintrags: ETF-Depot + Tagesgeld. */
export function vermoegenCent(eintrag: Readonly<Monatseintrag>): number {
  return ganzzahlig(eintrag.etfDepotCent) + ganzzahlig(eintrag.tagesgeldCent);
}

/**
 * Monate chronologisch aufsteigend. Mutiert das Eingabe-Array nicht (`slice` vor `sort`).
 *
 * ENTSCHEIDUNG zu doppelten Monatseinträgen (gleiches Jahr/Monat): sie werden nicht
 * zusammengefasst und nicht verworfen — beide bleiben erhalten. Damit die Reihenfolge
 * unabhängig von der Sortier-Implementierung deterministisch ist, entscheidet bei
 * Gleichstand `erfasstAm` aufsteigend, danach die `id` lexikografisch. Der zuletzt
 * erfasste Eintrag steht also hinten und gilt als der aktuelle Stand.
 */
export function sortierteMonate(daten: Readonly<AppDaten>): Monatseintrag[] {
  // Defensiv: bei Altdaten oder manipulierter Import-Datei kann `monate` fehlen.
  if (!Array.isArray(daten.monate)) return [];
  return daten.monate.slice().sort((a, b) => {
    if (a.jahr !== b.jahr) return a.jahr - b.jahr;
    if (a.monat !== b.monat) return a.monat - b.monat;
    if (a.erfasstAm !== b.erfasstAm) return a.erfasstAm - b.erfasstAm;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Vermögen des jüngsten Monatseintrags. Ohne Einträge: 0. */
export function aktuellesVermoegenCent(daten: Readonly<AppDaten>): number {
  const monate = sortierteMonate(daten);
  const letzter = monate.length > 0 ? monate[monate.length - 1] : undefined;
  return letzter ? vermoegenCent(letzter) : 0;
}

/**
 * Höchstes je erfasstes Vermögen (Bestmarke). Ohne Einträge: 0.
 *
 * ENTSCHEIDUNG: Die Etappen richten sich nach dieser Bestmarke, nicht nach dem
 * aktuellen Stand. Ein ETF-Depot schwankt; eine erreichte Etappe soll deshalb
 * nicht wieder auf „nicht erreicht" zurückfallen, nur weil der Kurs nachgibt.
 * Der aktuelle Stand bleibt über `aktuellesVermoegenCent` sichtbar — die
 * Übersicht zeigt beides, wenn sie auseinanderlaufen.
 */
export function hoechstesVermoegenCent(daten: Readonly<AppDaten>): number {
  let hoechst = 0;
  for (const eintrag of sortierteMonate(daten)) {
    const wert = vermoegenCent(eintrag);
    if (wert > hoechst) hoechst = wert;
  }
  return hoechst;
}

/**
 * Etappenliste inklusive Fortschritt, bezogen auf die **Bestmarke** (siehe oben).
 * `anteil` ist der Fortschritt innerhalb der jeweiligen Etappe (von der vorherigen
 * Schwelle bis `zielCent`), geklemmt auf 0..1 — nie NaN, nie Infinity.
 * Ohne Monatseinträge steht alles auf 0 (nur die Startetappe bei 0 € gilt als erreicht).
 */
export function etappen(daten: Readonly<AppDaten>): Etappe[] {
  const vermoegen = hoechstesVermoegenCent(daten);

  return ETAPPEN_SCHWELLEN_CENT.map((zielCent, index) => {
    const vorherCent = index > 0 ? (ETAPPEN_SCHWELLEN_CENT[index - 1] as number) : 0;
    const spanne = zielCent - vorherCent;
    const erreicht = vermoegen >= zielCent;

    const anteil =
      spanne <= 0
        ? erreicht
          ? 1
          : 0
        : Math.min(1, Math.max(0, (vermoegen - vorherCent) / spanne));

    return {
      id: `etappe-${zielCent}`,
      name: ETAPPEN_NAMEN[index] ?? `Etappe ${index + 1}`,
      zielCent,
      erreichtCent: Math.max(0, Math.min(vermoegen, zielCent)),
      anteil,
      erreicht,
    };
  });
}

/**
 * Veränderung des Gesamtvermögens: jüngster Eintrag gegenüber dem davorliegenden.
 * `null`, wenn weniger als zwei Einträge vorliegen. Bei doppelten Monatseinträgen
 * werden schlicht die letzten beiden Einträge der sortierten Liste verglichen.
 */
export function veraenderungCent(daten: Readonly<AppDaten>): number | null {
  const monate = sortierteMonate(daten);
  if (monate.length < 2) return null;
  const letzter = monate[monate.length - 1] as Monatseintrag;
  const vorletzter = monate[monate.length - 2] as Monatseintrag;
  return vermoegenCent(letzter) - vermoegenCent(vorletzter);
}
