/**
 * Datenmodell der Sparreise-App. Eigentümer: ARCHITEKT (nicht von Bau-Agents ändern).
 *
 * REGEL: Alle Geldbeträge sind Cent-Integer (ganzzahliger `number`), niemals Float-Euro.
 * Feldnamen tragen konsequent das Suffix `Cent`.
 */

export const SCHEMA_VERSION = 1;

export interface Fixkostenposten {
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
  erfasstAm: number; // Date.now()
}

export interface Einstellungen {
  einkommenCent: number; // Netto
  studiumCent: number; // Studiengebühren
  freizeitCent: number; // fixes Freizeit-Budget, Default 30000
  etfZusatzCent: number; // ETF zusätzlich, Default 5000
  etfInFixkostenCent: number; // Default 10000 — Teil der ETF-Sparrate, der bereits in den Fixkosten steckt
}

export interface AppDaten {
  schemaVersion: number;
  fixkosten: Fixkostenposten[];
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
  ['ETF-Sparplan Ftse All-World', 0],
  ['SV Sparkassenversicherung', 0],
  ['Friseur', 0],
];

/** Anzahl der vorgegebenen Fixkostenkategorien. Testanker. */
export const FIXKOSTEN_START_ANZAHL = 17;

/**
 * Startwerte der Einstellungen. Einkommen und Studiengebühren sind 0 — siehe
 * Datenschutzhinweis oben. Freizeit-Budget, ETF-Zusatz und der in den Fixkosten
 * enthaltene ETF-Anteil sind allgemeine Vorgabewerte der App, keine Personendaten.
 */
export const EINSTELLUNGEN_START: Readonly<Einstellungen> = {
  einkommenCent: 0,
  studiumCent: 0,
  freizeitCent: 30000,
  etfZusatzCent: 5000,
  etfInFixkostenCent: 10000,
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
