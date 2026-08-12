/**
 * Hochrechnung: wann ist ein Ziel bei gegebener Sparrate erreicht?
 * Reine Funktionen — keine Uhr, kein DOM.
 *
 * ANNAHME: lineares Sparen ohne Rendite. Ein ETF-Depot wächst auch durch Kurse,
 * aber jede Renditeannahme wäre geraten und würde ein Datum vorgaukeln, das
 * niemand halten kann. Lieber eine Zahl, die stimmt, wenn nichts dazukommt.
 */

export interface Hochrechnung {
  /** Was noch fehlt. 0, wenn das Ziel schon erreicht ist. */
  restCent: number;
  /** Volle Monate bis zum Ziel. null, wenn die Rate 0 oder negativ ist. */
  monate: number | null;
  /** Zielmonat, ausgehend vom übergebenen Startmonat. null wie oben. */
  zielJahr: number | null;
  zielMonat: number | null;
  erreicht: boolean;
}

export function hochrechnung(
  standCent: number,
  zielCent: number,
  rateProMonatCent: number,
  abJahr: number,
  abMonat: number,
): Hochrechnung {
  const rest = Math.max(0, Math.round(zielCent) - Math.round(standCent));
  if (rest === 0) {
    return { restCent: 0, monate: 0, zielJahr: abJahr, zielMonat: abMonat, erreicht: true };
  }

  const rate = Math.round(rateProMonatCent);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { restCent: rest, monate: null, zielJahr: null, zielMonat: null, erreicht: false };
  }

  const monate = Math.ceil(rest / rate);
  // Sicherheitsnetz gegen absurde Laufzeiten (Rate 1 Cent auf 10.000 €).
  if (!Number.isFinite(monate) || monate > 12000) {
    return { restCent: rest, monate: null, zielJahr: null, zielMonat: null, erreicht: false };
  }

  const gesamt = abJahr * 12 + (abMonat - 1) + monate;
  return {
    restCent: rest,
    monate,
    zielJahr: Math.floor(gesamt / 12),
    zielMonat: (((gesamt % 12) + 12) % 12) + 1,
    erreicht: false,
  };
}
