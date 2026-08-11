/**
 * Verteilungsrechnung: Was passiert monatlich mit dem Nettoeinkommen?
 * Eigentümer: Agent "Fachlogik". Reine Funktionen — kein DOM, kein Storage.
 */

import type { AppDaten } from './types';
import { ganzzahlig } from './geld';

/**
 * Ergebnis der Monatsverteilung. Alle Werte Cent-Integer.
 * Invariante (per Test abgesichert):
 *   fixkostenCent + studiumCent + freizeitCent + etfZusatzCent + uebrigCent === einkommenCent
 */
export interface Verteilung {
  /** Netto-Gehalt plus alle festen Zusatzeinnahmen. Basis der gesamten Rechnung. */
  einkommenCent: number;
  /** Nur das Netto-Gehalt, ohne Zusatzeinnahmen. */
  gehaltCent: number;
  /** Summe der festen Zusatzeinnahmen. 0, wenn keine hinterlegt sind. */
  weitereEinnahmenCent: number;
  /** Summe aller Fixkostenposten. */
  fixkostenCent: number;
  studiumCent: number;
  /**
   * Einkommen − (Fixkosten + Studium). Die Kennzahl, die der Nutzer im Kopf hat.
   * Bewusst ein eigenes Feld statt einer Ableitung: sie steht so in der Anforderung
   * ("Verfügbar 560,00 €") und darf nicht an zwei Stellen unterschiedlich gerechnet werden.
   */
  verfuegbarCent: number;
  freizeitCent: number;
  /** ETF-Sparrate zusätzlich zu dem Teil, der schon in den Fixkosten steckt. */
  etfZusatzCent: number;
  /** etfInFixkostenCent + etfZusatzCent — die tatsächliche ETF-Gesamtsparrate. */
  etfGesamtCent: number;
  /** Rest, der aufs Tagesgeld geht. Kann negativ sein (Unterdeckung). */
  uebrigCent: number;
  /** true, wenn uebrigCent < 0. */
  unterdeckung: boolean;
}

// `ganzzahlig` kommt aus geld.ts — eine Implementierung für alle Domain-Module.

export function berechneVerteilung(daten: Readonly<AppDaten>): Verteilung {
  const e = daten.einstellungen;

  const gehaltCent = ganzzahlig(e.einkommenCent);

  // Defensiv wie bei den Fixkosten: `einnahmen` fehlt in Sicherungen vor Schema 3.
  let weitereEinnahmenCent = 0;
  if (Array.isArray(daten.einnahmen)) {
    for (const posten of daten.einnahmen) {
      if (posten) weitereEinnahmenCent += ganzzahlig(posten.betragCent);
    }
  }

  const einkommenCent = gehaltCent + weitereEinnahmenCent;
  const studiumCent = ganzzahlig(e.studiumCent);
  const freizeitCent = ganzzahlig(e.freizeitCent);
  const etfZusatzCent = ganzzahlig(e.etfZusatzCent);

  // Defensiv: bei Altdaten oder einer manipulierten Import-Datei kann `fixkosten`
  // fehlen oder kein Array sein. Die Verteilung darf davon nicht abstürzen.
  let fixkostenCent = 0;
  if (Array.isArray(daten.fixkosten)) {
    for (const posten of daten.fixkosten) {
      if (posten) fixkostenCent += ganzzahlig(posten.betragCent);
    }
  }

  // Verfügbar = Einkommen − (Fixkosten + Studium); davon gehen Freizeit und ETF-Zusatz ab.
  const verfuegbarCent = einkommenCent - (fixkostenCent + studiumCent);
  const uebrigCent = verfuegbarCent - freizeitCent - etfZusatzCent; // = Tagesgeld

  return {
    einkommenCent,
    gehaltCent,
    weitereEinnahmenCent,
    fixkostenCent,
    studiumCent,
    verfuegbarCent,
    freizeitCent,
    etfZusatzCent,
    etfGesamtCent: ganzzahlig(e.etfInFixkostenCent) + etfZusatzCent,
    uebrigCent,
    unterdeckung: uebrigCent < 0,
  };
}

/**
 * Monatliche Sparquote als Anteil 0..1: (ETF gesamt + Tagesgeld-Rest) / Einkommen.
 * Bei Einkommen <= 0 → 0 (keine Division durch null). Ergebnis ist auf 0..1 geklemmt,
 * damit die UI es direkt als Fortschritt zeichnen kann; eine Unterdeckung erkennt sie
 * an `Verteilung.unterdeckung`, nicht an einer negativen Quote.
 */
export function sparquote(verteilung: Verteilung): number {
  const { einkommenCent, etfGesamtCent, uebrigCent } = verteilung;
  if (!Number.isFinite(einkommenCent) || einkommenCent <= 0) return 0;
  const quote = (etfGesamtCent + uebrigCent) / einkommenCent;
  if (!Number.isFinite(quote)) return 0;
  return Math.min(1, Math.max(0, quote));
}
