/**
 * Geldarithmetik und -formatierung. Eigentümer: Agent "Fachlogik".
 * Reine Funktionen — kein DOM, kein Storage, keine Seiteneffekte.
 *
 * REGEL: Geld ist immer Cent-Integer. Kein Float-Euro, nirgends.
 */

/** Größter zulässiger Betrag: 999.999.999,99 € in Cent. Alles darüber gilt als Tippfehler. */
const MAX_CENT = 99_999_999_999;

/** Kaufmännisch runden: 0,5 wird vom Nullpunkt weg gerundet (Math.round rundet -2,5 auf -2). */
function kaufmaennisch(wert: number): number {
  return wert < 0 ? -Math.round(-wert) : Math.round(wert);
}

/**
 * Zwingt einen Wert defensiv auf Cent-Integer. Nicht-endliche Werte (NaN, ±Infinity)
 * dürfen nie in einen Betrag geraten.
 *
 * Bewusst exportiert: `verteilung.ts` und `etappen.ts` rechnen ebenfalls mit
 * importierten oder migrierten Daten und brauchen dieselbe Normalisierung.
 * Eine Implementierung, damit ein Fix hier überall wirkt.
 */
export function ganzzahlig(cent: number): number {
  // `+ 0` normalisiert negative Null: -0 + 0 === +0. Ohne das formatiert Intl
  // Werte wie -0,4 Cent als "-0,00 €", was der Nutzer als Fehler liest.
  return Number.isFinite(cent) ? kaufmaennisch(cent) + 0 : 0;
}

/**
 * Ganzteil ohne Punkt, oder mit Punkten als Tausendertrenner in exakten 3er-Gruppen.
 * Die erste Gruppe darf keine führende Null haben: "0.000" ist keine Tausenderzahl,
 * sondern eine mehrdeutige Eingabe.
 */
function gueltigerGanzteil(text: string): boolean {
  if (text === '') return false;
  if (text.indexOf('.') === -1) return /^[0-9]+$/.test(text);
  return /^[1-9][0-9]{0,2}(\.[0-9]{3})+$/.test(text);
}

/**
 * Parst eine Nutzereingabe zu Cent-Integer. **Trust Boundary** — hier tippt der Nutzer
 * auf einer iOS-Tastatur hinein, also wird alles geprüft und nichts geraten.
 *
 * Akzeptiert: `1.234,56` · `1234,56` · `1234.56` · `1234` · `-50,00` · ` 1 234,56 € `
 * Toleriert: `€`, beliebigen Leerraum (auch ` ` / ` `), Unicode-Minus `−`,
 * typografische Kommas, führendes `+`, fehlenden Ganzteil (`,50`).
 *
 * Gibt `null` zurück (nie 0, nie eine Exception), wenn die Eingabe nicht eindeutig
 * als Betrag lesbar ist — `null` heißt „konnte ich nicht lesen".
 *
 * ENTSCHEIDUNG zur Mehrdeutigkeit von `"1.234"`:
 * Ein Punkt mit **genau 3** Folgeziffern und **ohne Komma** im String gilt als
 * Tausendertrenner → `"1.234"` = 123400 Cent = 1.234,00 €. Begründung: die App ist
 * deutschsprachig und einhändig-mobil; wer 1,234 € meint, tippt hier ein Komma.
 * `"1.23"` und `"1.2345"` bleiben Dezimalpunkt (`1234.56` muss weiter funktionieren).
 * Mehrere Punkte müssen durchgehend saubere 3er-Gruppen sein, sonst `null`
 * (`"1.2.3"`, `"1.2.3,45"` sind mehrdeutig → `null`).
 */
export function parseEuroZuCent(text: string): number | null {
  if (typeof text !== 'string') return null;

  let s = text
    .replace(/\s/g, '') // \s deckt in JS auch  ,  ,  , ﻿ ab
    .replace(/[−–—]/g, '-') // Unicode-Minus, En-/Em-Dash
    .replace(/[‚，،]/g, ',') // typografische / fullwidth Kommas
    .replace(/[․．]/g, '.')
    // Das €-Zeichen wird NUR am Anfang oder Ende entfernt. Würde es überall
    // gestrichen, verschmölze "5€5" still zu "55" — eine Fehleingabe würde
    // unbemerkt zu einem falschen Betrag. Innenliegendes € muss `null` ergeben.
    .replace(/^€+|€+$/g, '');

  if (s === '') return null;

  let vorzeichen = 1;
  if (s.charAt(0) === '-') {
    vorzeichen = -1;
    s = s.slice(1);
  } else if (s.charAt(0) === '+') {
    s = s.slice(1);
  }

  // Ab hier sind nur noch Ziffern, Punkt und Komma erlaubt.
  // Das erschlägt "abc", "1e5", "Infinity", "NaN", "--5", "1-2".
  if (!/^[0-9.,]+$/.test(s)) return null;

  const kommas = s.split(',').length - 1;
  if (kommas > 1) return null; // "1,2,3"

  let ganzteil: string;
  let bruchteil: string;

  if (kommas === 1) {
    const i = s.indexOf(',');
    ganzteil = s.slice(0, i);
    bruchteil = s.slice(i + 1);
    if (ganzteil === '' && bruchteil === '') return null; // nur ","
    if (ganzteil === '') ganzteil = '0'; // ",50"
    if (!gueltigerGanzteil(ganzteil)) return null;
    if (!/^[0-9]*$/.test(bruchteil)) return null; // "1,23.4"
  } else {
    const punkte = s.split('.').length - 1;
    if (punkte === 1) {
      const i = s.indexOf('.');
      const links = s.slice(0, i);
      const rechts = s.slice(i + 1);
      if (!/^[0-9]*$/.test(links) || !/^[0-9]+$/.test(rechts)) return null;
      // Führende Null schließt den Tausendertrenner aus: "0.005" ist kein
      // Betrag von 5 €, sondern eine Dezimalzahl (→ 1 Cent, kaufmännisch gerundet).
      if (links !== '' && links.charAt(0) !== '0' && rechts.length === 3) {
        ganzteil = links + rechts; // Tausendertrenner — siehe Doku oben
        bruchteil = '';
      } else {
        ganzteil = links === '' ? '0' : links;
        bruchteil = rechts;
      }
    } else {
      if (!gueltigerGanzteil(s)) return null;
      ganzteil = s;
      bruchteil = '';
    }
  }

  let euro = Number(ganzteil.replace(/\./g, ''));
  if (!Number.isFinite(euro)) return null;

  let restCent: number;
  if (bruchteil === '') {
    restCent = 0;
  } else if (bruchteil.length <= 2) {
    restCent = Number(bruchteil.padEnd(2, '0'));
  } else {
    // Mehr als 2 Nachkommastellen: kaufmännisch auf Cent runden.
    restCent = Number(bruchteil.slice(0, 2)) + (bruchteil.charAt(2) >= '5' ? 1 : 0);
  }
  if (restCent >= 100) {
    restCent -= 100;
    euro += 1;
  }

  const cent = euro * 100 + restCent;
  if (!Number.isSafeInteger(cent) || cent > MAX_CENT) return null;
  return cent === 0 ? 0 : vorzeichen * cent; // nie -0
}

const WAEHRUNG_FORMAT = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
});

const ROH_FORMAT = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Vereinheitlicht die Intl-Ausgabe, damit sie plattformunabhängig testbar ist:
 * ältere iOS-Versionen liefern vor dem € ein schmales geschütztes Leerzeichen
 * (U+202F) statt U+00A0, manche ICU-Builds ein Unicode-Minus.
 */
function normalisiere(text: string): string {
  return text.replace(/\s/g, ' ').replace(/−/g, '-');
}

/** Formatiert Cent als `1.234,56 €` (negativ als `-1.234,56 €`, nicht in Klammern). */
export function formatCent(cent: number): string {
  return normalisiere(WAEHRUNG_FORMAT.format(ganzzahlig(cent) / 100));
}

/** Formatiert Cent als `1.234,56` — ohne Währungszeichen, z.B. für Input-Felder. */
export function formatCentRoh(cent: number): string {
  return normalisiere(ROH_FORMAT.format(ganzzahlig(cent) / 100));
}

/** Summiert Cent-Beträge. Ergebnis ist garantiert ganzzahlig; kaputte Werte zählen als 0. */
export function summeCent(werte: readonly number[]): number {
  let summe = 0;
  for (const wert of werte) summe += ganzzahlig(wert);
  return summe;
}

/**
 * Multipliziert einen Cent-Betrag mit einem Faktor, kaufmännisch auf Cent gerundet.
 * (Für Anteile/Prozentsätze — niemals über Float-Euro rechnen.)
 */
export function malFaktor(cent: number, faktor: number): number {
  return ganzzahlig(cent * faktor);
}
