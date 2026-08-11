/**
 * Auswertung der erfassten Monate — pro Monat und pro Jahr.
 * Reine Funktionen: kein DOM, kein Storage, keine Uhr.
 *
 * Grundlage ist immer die **Veränderung des Vermögens** (ETF-Depot + Tagesgeld)
 * gegenüber dem vorherigen erfassten Monat. Das ist bewusst nicht dasselbe wie
 * die geplante Sparrate aus der Verteilungsrechnung: hier steht, was tatsächlich
 * passiert ist, inklusive Kursbewegungen des Depots.
 */

import type { AppDaten, Monatseintrag } from './types';
import { ganzzahlig } from './geld';
import { sortierteMonate, vermoegenCent } from './etappen';

export interface MonatsDetail {
  eintrag: Monatseintrag;
  vermoegenCent: number;
  /** Veränderung gegenüber dem vorherigen erfassten Monat. null beim ersten. */
  veraenderungCent: number | null;
  etfVeraenderungCent: number | null;
  tagesgeldVeraenderungCent: number | null;
  sonderausgabeCent: number;
  sondereinnahmeCent: number;
  /**
   * Anteil der Vermögensveränderung am monatlichen Einkommen. null, wenn kein
   * Vormonat vorliegt oder kein Einkommen hinterlegt ist. Kann über 1 liegen
   * (Kursgewinn) und negativ sein (Verlust oder Entnahme).
   */
  quote: number | null;
}

export interface Jahresstatistik {
  jahr: number;
  /** Anzahl erfasster Monate in diesem Jahr. */
  anzahlMonate: number;
  /** Summe aller Monatsveränderungen des Jahres. */
  zuwachsCent: number;
  /** Zuwachs geteilt durch die Anzahl der Monate mit Veränderung. */
  schnittProMonatCent: number;
  bester: { monat: number; veraenderungCent: number } | null;
  schlechtester: { monat: number; veraenderungCent: number } | null;
  sonderausgabenCent: number;
  sondereinnahmenCent: number;
  /** Vermögen am Ende des letzten erfassten Monats dieses Jahres. */
  endVermoegenCent: number;
}

/**
 * Alle erfassten Monate mit ihren Veränderungen, chronologisch aufsteigend.
 *
 * `monatsEinkommenCent` ist das Einkommen, gegen das die Quote gerechnet wird —
 * üblicherweise `berechneVerteilung(daten).einkommenCent`. Wird es weggelassen
 * oder ist es 0, bleibt `quote` null statt durch null zu teilen.
 */
export function monatsDetails(
  daten: Readonly<AppDaten>,
  monatsEinkommenCent = 0,
): MonatsDetail[] {
  const monate = sortierteMonate(daten);
  const einkommen = ganzzahlig(monatsEinkommenCent);

  return monate.map((eintrag, index) => {
    const vorher = index > 0 ? monate[index - 1] : undefined;
    const jetzt = vermoegenCent(eintrag);
    const veraenderungCent = vorher ? jetzt - vermoegenCent(vorher) : null;

    return {
      eintrag,
      vermoegenCent: jetzt,
      veraenderungCent,
      etfVeraenderungCent: vorher
        ? ganzzahlig(eintrag.etfDepotCent) - ganzzahlig(vorher.etfDepotCent)
        : null,
      tagesgeldVeraenderungCent: vorher
        ? ganzzahlig(eintrag.tagesgeldCent) - ganzzahlig(vorher.tagesgeldCent)
        : null,
      sonderausgabeCent: ganzzahlig(eintrag.sonderausgabeCent ?? 0),
      sondereinnahmeCent: ganzzahlig(eintrag.sondereinnahmeCent ?? 0),
      quote: veraenderungCent !== null && einkommen > 0 ? veraenderungCent / einkommen : null,
    };
  });
}

/**
 * Eine Statistik je Kalenderjahr, aufsteigend sortiert.
 *
 * Ein Monat zählt zu dem Jahr, in dem er erfasst wurde. Der Zuwachs eines Jahres
 * ist die Summe der Monatsveränderungen — der erste erfasste Monat überhaupt hat
 * keine Veränderung und geht deshalb mit 0 ein, nicht mit seinem vollen Vermögen.
 * Sonst sähe das erste Jahr künstlich gut aus.
 */
export function jahresstatistik(
  daten: Readonly<AppDaten>,
  monatsEinkommenCent = 0,
): Jahresstatistik[] {
  const details = monatsDetails(daten, monatsEinkommenCent);
  const nachJahr = new Map<number, MonatsDetail[]>();

  for (const detail of details) {
    const jahr = detail.eintrag.jahr;
    const liste = nachJahr.get(jahr);
    if (liste) liste.push(detail);
    else nachJahr.set(jahr, [detail]);
  }

  const jahre = [...nachJahr.keys()].sort((a, b) => a - b);

  return jahre.map((jahr) => {
    const liste = nachJahr.get(jahr) as MonatsDetail[];
    const mitVeraenderung = liste.filter((d) => d.veraenderungCent !== null);

    let zuwachsCent = 0;
    let bester: Jahresstatistik['bester'] = null;
    let schlechtester: Jahresstatistik['schlechtester'] = null;

    for (const d of mitVeraenderung) {
      const wert = d.veraenderungCent as number;
      zuwachsCent += wert;
      if (!bester || wert > bester.veraenderungCent) {
        bester = { monat: d.eintrag.monat, veraenderungCent: wert };
      }
      if (!schlechtester || wert < schlechtester.veraenderungCent) {
        schlechtester = { monat: d.eintrag.monat, veraenderungCent: wert };
      }
    }

    let sonderausgabenCent = 0;
    let sondereinnahmenCent = 0;
    for (const d of liste) {
      sonderausgabenCent += d.sonderausgabeCent;
      sondereinnahmenCent += d.sondereinnahmeCent;
    }

    const letzter = liste[liste.length - 1] as MonatsDetail;

    return {
      jahr,
      anzahlMonate: liste.length,
      zuwachsCent,
      schnittProMonatCent:
        mitVeraenderung.length > 0 ? Math.round(zuwachsCent / mitVeraenderung.length) : 0,
      bester,
      schlechtester,
      sonderausgabenCent,
      sondereinnahmenCent,
      endVermoegenCent: letzter.vermoegenCent,
    };
  });
}
