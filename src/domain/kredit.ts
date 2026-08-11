/**
 * Kreditlaufzeit und Sondertilgung. Reine Funktionen — kein DOM, kein Storage.
 *
 * ANNAHME: zinsfrei. Die Gesamtsumme ist Rate × Laufzeit; jede gezahlte Rate und
 * jede Sondertilgung senkt die Restschuld eins zu eins. Für einen verzinsten Kredit
 * bräuchte es den effektiven Jahreszins und einen Tilgungsplan — ohne hinterlegten
 * Zins wäre jede Zinsformel geraten, und eine geratene Zahl ist schlechter als keine.
 */

import type { Fixkostenposten, Kredit } from './types';
import { ganzzahlig } from './geld';

export interface Kreditstand {
  /** Rate × Laufzeit, ohne Sondertilgung. */
  gesamtCent: number;
  /** Bereits fällig gewordene reguläre Raten. */
  gezahlteRaten: number;
  gezahltCent: number;
  sondertilgungCent: number;
  /** Was noch offen ist. Nie negativ. */
  restschuldCent: number;
  /** Volle Raten, die noch kommen. 0, wenn abbezahlt. */
  verbleibendeRaten: number;
  /** Letzte Rate nach Sondertilgung — kann kleiner als die normale Rate sein. */
  letzteRateCent: number;
  /** Monat der voraussichtlich letzten Rate. null, wenn bereits abbezahlt. */
  endeJahr: number | null;
  endeMonat: number | null;
  /** Wie viele Monate die Sondertilgung die Laufzeit verkürzt. */
  ersparteMonate: number;
  /** true, sobald nichts mehr offen ist. */
  abbezahlt: boolean;
  /** true, solange die erste Rate noch nicht fällig war. */
  nochNichtGestartet: boolean;
}

/** Monate von (aJahr, aMonat) bis (bJahr, bMonat), positiv wenn b später liegt. */
export function monatsAbstand(aJahr: number, aMonat: number, bJahr: number, bMonat: number): number {
  return (bJahr - aJahr) * 12 + (bMonat - aMonat);
}

/** Datum nach n Monaten. n darf negativ sein. */
export function plusMonate(jahr: number, monat: number, n: number): { jahr: number; monat: number } {
  const gesamt = jahr * 12 + (monat - 1) + n;
  return { jahr: Math.floor(gesamt / 12), monat: (((gesamt % 12) + 12) % 12) + 1 };
}

function gueltig(k: Kredit | undefined): k is Kredit {
  return (
    !!k &&
    Number.isFinite(k.laufzeitMonate) &&
    k.laufzeitMonate > 0 &&
    Number.isFinite(k.startJahr) &&
    Number.isFinite(k.startMonat) &&
    k.startMonat >= 1 &&
    k.startMonat <= 12
  );
}

/**
 * Rechnet den Stand eines Kredits zu einem Stichmonat.
 *
 * `heuteJahr`/`heuteMonat` werden übergeben statt aus `Date` gelesen, damit die
 * Funktion rein und testbar bleibt.
 *
 * `sondertilgungUeberschreibung` erlaubt das Durchspielen: „Was, wenn ich X tilge?"
 * — ohne den gespeicherten Wert anzufassen.
 */
export function kreditstand(
  posten: Readonly<Fixkostenposten>,
  heuteJahr: number,
  heuteMonat: number,
  sondertilgungUeberschreibung?: number,
): Kreditstand | null {
  const k = posten.kredit;
  if (!gueltig(k)) return null;

  const rateCent = Math.abs(ganzzahlig(posten.betragCent));
  const laufzeit = Math.floor(k.laufzeitMonate);
  const gesamtCent = rateCent * laufzeit;

  const sonder = Math.max(
    0,
    ganzzahlig(sondertilgungUeberschreibung ?? k.sondertilgungCent ?? 0),
  );
  const sondertilgungCent = Math.min(sonder, gesamtCent);

  // Wie viele reguläre Raten sind bis einschließlich Stichmonat fällig geworden?
  const seitStart = monatsAbstand(k.startJahr, k.startMonat, heuteJahr, heuteMonat);
  const nochNichtGestartet = seitStart < 0;
  const gezahlteRaten = Math.min(laufzeit, Math.max(0, seitStart + 1));
  const gezahltCent = gezahlteRaten * rateCent;

  const restschuldCent = Math.max(0, gesamtCent - gezahltCent - sondertilgungCent);
  const abbezahlt = restschuldCent === 0;

  // Bei Rate 0 gäbe es keine sinnvolle Restlaufzeit — dann bleibt es bei der Laufzeit.
  const verbleibendeRaten = rateCent > 0 ? Math.ceil(restschuldCent / rateCent) : 0;
  const letzteRateCent =
    verbleibendeRaten > 0 ? restschuldCent - (verbleibendeRaten - 1) * rateCent : 0;

  let endeJahr: number | null = null;
  let endeMonat: number | null = null;
  if (!abbezahlt && verbleibendeRaten > 0) {
    // Die nächste fällige Rate ist Nummer `gezahlteRaten` (0-basiert ab Start).
    const naechsterIndex = Math.max(gezahlteRaten, nochNichtGestartet ? 0 : gezahlteRaten);
    const ende = plusMonate(k.startJahr, k.startMonat, naechsterIndex + verbleibendeRaten - 1);
    endeJahr = ende.jahr;
    endeMonat = ende.monat;
  }

  // Ohne Sondertilgung liefe der Kredit bis zur letzten regulären Rate.
  const ohneSonder = rateCent > 0 ? Math.ceil(Math.max(0, gesamtCent - gezahltCent) / rateCent) : 0;
  const ersparteMonate = Math.max(0, ohneSonder - verbleibendeRaten);

  return {
    gesamtCent,
    gezahlteRaten,
    gezahltCent,
    sondertilgungCent,
    restschuldCent,
    verbleibendeRaten,
    letzteRateCent,
    endeJahr,
    endeMonat,
    ersparteMonate,
    abbezahlt,
    nochNichtGestartet,
  };
}
