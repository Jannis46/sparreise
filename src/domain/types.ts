/**
 * Datenmodell der Sparreise-App. Eigentümer: ARCHITEKT (nicht von Bau-Agents ändern).
 *
 * REGEL: Alle Geldbeträge sind Cent-Integer (ganzzahliger `number`), niemals Float-Euro.
 * Feldnamen tragen konsequent das Suffix `Cent`.
 */

export const SCHEMA_VERSION = 5;

/**
 * Kreditangaben zu einem Fixkostenposten. Optional — die meisten Posten sind
 * Daueraufträge ohne Ende.
 *
 * ANNAHME: zinsfrei. Restschuld = Rate × Laufzeit − gezahlte Raten − Sondertilgung.
 * Für einen verzinsten Kredit bräuchte es den effektiven Jahreszins und eine
 * Tilgungsplan-Rechnung; solange keiner hinterlegt ist, wäre jede Zinsformel geraten.
 */
export interface Kredit {
  /** Gesamtzahl der Raten, z. B. 60. */
  laufzeitMonate: number;
  /** Monat der ersten Rate. Der Tag im Monat ist für die Monatszählung ohne Belang. */
  startJahr: number;
  startMonat: number; // 1..12
  /** Bereits geleistete oder geplante Sondertilgung. 0, wenn keine. */
  sondertilgungCent: number;
}

export interface Fixkostenposten {
  id: string;
  name: string;
  betragCent: number;
  /** Gesetzt, wenn dieser Posten ein Kredit mit Laufzeitende ist. */
  kredit?: Kredit;
}

/**
 * Feste monatliche Einnahme neben dem Netto-Gehalt — Nebenjob, Kindergeld, BAföG.
 * Zählt in jedem Monat gleich mit ins Verfügbare.
 */
export interface Einnahmeposten {
  id: string;
  name: string;
  betragCent: number;
}

export interface Monatseintrag {
  id: string;
  jahr: number; // z.B. 2026
  monat: number; // 1..12
  etfDepotCent: number; // Trade Republic Depotwert
  tagesgeldCent: number; // Tagesgeld gesamt
  sonderausgabeCent?: number;
  sonderausgabeNotiz?: string;
  /** Einmalige Einnahme in diesem Monat — Bonus, Steuerrückzahlung, Verkauf. */
  sondereinnahmeCent?: number;
  sondereinnahmeNotiz?: string;
  erfasstAm: number; // Date.now()
}

/**
 * Investitionsposten — was monatlich in Anlage fließt statt in Verbrauch.
 *
 * Bewusst getrennt von den Fixkosten: Ein ETF-Sparplan ist keine Ausgabe im
 * Sinne von „weg", sondern verschobenes Vermögen. In einer Liste mit Miete und
 * Strom zu stehen verzerrt den Blick auf die eigene Kostenstruktur.
 */
export interface Investposten {
  id: string;
  name: string;
  betragCent: number;
}

/**
 * Sparposten — feste monatliche Rücklage auf Konten, aus denen wieder entnommen
 * wird: Tagesgeld, Notgroschen, Urlaubskasse.
 *
 * Getrennt von `Investposten`, weil die Absicht eine andere ist: Invest wird
 * angelegt und liegen gelassen, Sparen ist Geld für später, aber greifbar.
 * Beide gehen vom Verfügbaren ab, beide sind kein Verbrauch.
 */
export interface Sparposten {
  id: string;
  name: string;
  betragCent: number;
}

export interface Einstellungen {
  einkommenCent: number; // Netto
  studiumCent: number; // Studiengebühren
  freizeitCent: number; // fixes Freizeit-Budget, Default 30000
}

export interface AppDaten {
  schemaVersion: number;
  fixkosten: Fixkostenposten[];
  /** Feste Einnahmen zusätzlich zum Netto-Gehalt. Leer, solange es keine gibt. */
  einnahmen: Einnahmeposten[];
  /** Monatliche Anlage. Geht vom Verfügbaren ab wie das Freizeit-Budget. */
  invest: Investposten[];
  /** Feste monatliche Rücklage. Was nach Freizeit, Invest und Sparen bleibt, ist nicht verplant. */
  sparen: Sparposten[];
  einstellungen: Einstellungen;
  monate: Monatseintrag[];
}

/**
 * Startwerte der Fixkosten: nur die Positionsnamen, **alle Beträge 0**.
 *
 * DATENSCHUTZ — bewusste Entscheidung: Dieses Repository ist öffentlich (GitHub Pages
 * veröffentlicht auf dem kostenlosen Plan nur aus öffentlichen Repos). Echte Beträge
 * im Quellcode wären damit dauerhaft für jeden lesbar, auch nach einem späteren
 * Löschen noch über die Git-Historie. Deshalb stehen hier nur die Kategorien.
 *
 * Die eigenen Zahlen trägt man beim ersten Start ein oder importiert sie über
 * "Daten → Wiederherstellen". Sie liegen dann ausschließlich auf dem Gerät.
 */
const FIXKOSTEN_START: ReadonlyArray<readonly [name: string, betragCent: number]> = [
  ['Miete', 0],
  ['PrepMyMeal', 0],
  ['Zusätzl. Lebensmittel', 0],
  ['Berufsunfähigkeitsversicherung', 0],
  ['Strom', 0],
  ['Internet O2', 0],
  ['Privatkredit Eltern', 0],
  // Ersetzt 'Kredit Consors Finanz'. Laufzeit 60 Monate — Startmonat noch offen,
  // deshalb aktuell kein Enddatum im Modell. Siehe HANDOFF.md, offene Punkte.
  ['Anyfin', 0],
  ['Claude-Abo', 0],
  ['Rechtsschutzversicherung', 0],
  ['Microsoft 365', 0],
  ['Handyversicherung', 0],
  ['iCloud', 0],
  ['Bankgebühren', 0],
  ['Friseur', 0],
];

/**
 * Startwerte der Anlage. Was hier steht, ist keine Ausgabe, sondern verschobenes
 * Vermögen — deshalb eigene Liste statt einer Zeile in den Fixkosten.
 */
const INVEST_START: ReadonlyArray<readonly [name: string, betragCent: number]> = [
  ['ETF-Sparplan Ftse All-World', 0],
  ['SV Sparkassenversicherung', 0],
  ['ETF zusätzlich', 0],
];

/**
 * Startwerte der Rücklage. Wie beim Invest nur die Kategorien, keine Beträge.
 */
const SPAREN_START: ReadonlyArray<readonly [name: string, betragCent: number]> = [
  ['Tagesgeld (Rücklage)', 0],
  ['Urlaub', 0],
];

/** Anzahl der vorgegebenen Fixkostenkategorien. Testanker. */
export const FIXKOSTEN_START_ANZAHL = 15;
/** Anzahl der vorgegebenen Investpositionen. Testanker. */
export const INVEST_START_ANZAHL = 3;

/**
 * Startwerte der Einstellungen. Einkommen und Studiengebühren sind 0 — siehe
 * Datenschutzhinweis oben. Das Freizeit-Budget ist ein allgemeiner Vorgabewert
 * der App, keine Personendatum.
 */
export const EINSTELLUNGEN_START: Readonly<Einstellungen> = {
  einkommenCent: 0,
  studiumCent: 0,
  freizeitCent: 30000,
};

/** Frischer Datensatz für den ersten App-Start (oder nach "Alles löschen"). */
export function startDaten(): AppDaten {
  return {
    schemaVersion: SCHEMA_VERSION,
    fixkosten: FIXKOSTEN_START.map(([name, betragCent]) => ({
      id: neueId(),
      name,
      betragCent,
    })),
    einnahmen: [],
    invest: INVEST_START.map(([name, betragCent]) => ({ id: neueId(), name, betragCent })),
    sparen: SPAREN_START.map(([name, betragCent]) => ({ id: neueId(), name, betragCent })),
    einstellungen: { ...EINSTELLUNGEN_START },
    monate: [],
  };
}

let idZaehler = 0;

/**
 * ID-Generator mit iOS-Fallback-Kette.
 * `crypto.randomUUID` gibt es erst ab iOS 15.4 und nur in Secure Contexts (https / localhost).
 * Deshalb: randomUUID → getRandomValues → Zeitstempel+Zähler.
 */
export function neueId(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += (bytes[i] as number).toString(16).padStart(2, '0');
    }
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }
  idZaehler += 1;
  return `id-${Date.now().toString(36)}-${idZaehler.toString(36)}`;
}
