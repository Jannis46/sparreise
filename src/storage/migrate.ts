/**
 * Prüft und migriert rohe Daten auf SCHEMA_VERSION.
 *
 * Das hier ist die Vertrauensgrenze der App: die Eingabe kommt entweder aus dem
 * Browserspeicher (kann beschädigt sein) oder aus einer vom Nutzer importierten Datei
 * (kann beliebig manipuliert sein). Deshalb gilt:
 *  - jedes Feld einzeln prüfen, nichts durchreichen
 *  - die Rückgabe ist IMMER ein frisch gebautes Objekt
 *  - diese Funktion wirft NIE — im Zweifel `null`
 *
 * Rettungsprinzip bei Listen: eine kaputte Einzelposition wird übersprungen, nicht der
 * ganze Datensatz verworfen — Datenverlust ist hier das größere Übel. Ist dagegen in einer
 * nicht leeren Liste KEIN Eintrag brauchbar, ist die Eingabe insgesamt Müll → `null`.
 */

import {
  EINSTELLUNGEN_START,
  SCHEMA_VERSION,
  neueId,
  type AppDaten,
  type Einstellungen,
  type Fixkostenposten,
  type Kredit,
  type Monatseintrag,
} from '../domain/types';

export const MAX_NAME_LAENGE = 200;
export const MAX_NOTIZ_LAENGE = 1000;
/** 1 Milliarde Euro in Cent. Alles darüber ist Unsinn oder Angriff. */
export const MAX_CENT = 100_000_000_000;
export const MAX_FIXKOSTEN = 500;
export const MAX_MONATE = 5000;
const MIN_JAHR = 1970;
const MAX_JAHR = 2200;
/** Tiefer verschachtelte Eingaben gelten als Angriff (Stack-Überlauf beim Prüfen). */
const MAX_TIEFE = 12;

const GEFAEHRLICHE_SCHLUESSEL: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/**
 * Migrationsschritte für spätere Schemaversionen: `[von] => Daten der Version von+1`.
 */
type Migration = (daten: Record<string, unknown>) => Record<string, unknown>;
const MIGRATIONEN = new Map<number, Migration>();

// v1 → v2: Fixkostenposten können optional Kreditangaben tragen (Laufzeit,
// Startmonat, Sondertilgung). Alte Datensätze haben schlicht keine — es ist
// nichts umzurechnen, nur die Version anzuheben.
MIGRATIONEN.set(1, (d) => ({ ...d, schemaVersion: 2 }));

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === 'object' && wert !== null && !Array.isArray(wert);
}

/**
 * Prototype-Pollution-Schutz: `JSON.parse` legt `__proto__` als echte eigene Eigenschaft
 * an. Wir bauen zwar nur Whitelist-Felder neu auf, verwerfen solche Eingaben aber
 * grundsätzlich — wer das mitschickt, meint es nicht gut.
 */
function enthaeltGefaehrlicheSchluessel(wert: unknown, tiefe: number): boolean {
  if (tiefe > MAX_TIEFE) return true;
  if (Array.isArray(wert)) {
    return wert.some((e) => enthaeltGefaehrlicheSchluessel(e, tiefe + 1));
  }
  if (!istObjekt(wert)) return false;
  for (const schluessel of Object.keys(wert)) {
    if (GEFAEHRLICHE_SCHLUESSEL.indexOf(schluessel) >= 0) return true;
    if (enthaeltGefaehrlicheSchluessel(wert[schluessel], tiefe + 1)) return true;
  }
  return false;
}

function ganzzahl(wert: unknown, min: number, max: number): number | null {
  if (typeof wert !== 'number' || !Number.isSafeInteger(wert) || wert < min || wert > max) {
    return null;
  }
  return wert;
}

function text(wert: unknown, maxLaenge: number): string | null {
  if (typeof wert !== 'string') return null;
  return wert.length > maxLaenge ? wert.slice(0, maxLaenge) : wert;
}

function cent(wert: unknown): number | null {
  return ganzzahl(wert, -MAX_CENT, MAX_CENT);
}

/**
 * Kreditangaben eines Postens prüfen. Alles Unplausible führt dazu, dass der Posten
 * einfach **kein** Kredit ist — nie dazu, dass der ganze Posten verworfen wird.
 */
function kreditPruefen(roh: unknown): Kredit | undefined {
  if (!istObjekt(roh)) return undefined;
  const laufzeitMonate = ganzzahl(roh['laufzeitMonate'], 1, 1200); // max. 100 Jahre
  const startJahr = ganzzahl(roh['startJahr'], MIN_JAHR, MAX_JAHR);
  const startMonat = ganzzahl(roh['startMonat'], 1, 12);
  if (laufzeitMonate === null || startJahr === null || startMonat === null) return undefined;

  const sonder = cent(roh['sondertilgungCent']);
  return {
    laufzeitMonate,
    startJahr,
    startMonat,
    sondertilgungCent: sonder === null || sonder < 0 ? 0 : sonder,
  };
}

function fixkostenPruefen(roh: unknown, vergebeneIds: Set<string>): Fixkostenposten | null {
  if (!istObjekt(roh)) return null;
  const betragCent = cent(roh['betragCent']);
  if (betragCent === null) return null; // ohne Betrag ist der Posten wertlos
  const name = text(roh['name'], MAX_NAME_LAENGE);
  const posten: Fixkostenposten = {
    id: idPruefen(roh['id'], vergebeneIds),
    name: name === null || name === '' ? 'Unbenannt' : name,
    betragCent,
  };
  const kredit = kreditPruefen(roh['kredit']);
  if (kredit) posten.kredit = kredit;
  return posten;
}

/** Ungültige oder doppelte IDs werden ersetzt — doppelte IDs würden die UI verwirren. */
function idPruefen(roh: unknown, vergebeneIds: Set<string>): string {
  const id = text(roh, MAX_NAME_LAENGE);
  const gueltig = id !== null && id !== '' && !vergebeneIds.has(id) ? id : neueId();
  vergebeneIds.add(gueltig);
  return gueltig;
}

function monatPruefen(roh: unknown, vergebeneIds: Set<string>): Monatseintrag | null {
  if (!istObjekt(roh)) return null;
  const jahr = ganzzahl(roh['jahr'], MIN_JAHR, MAX_JAHR);
  const monat = ganzzahl(roh['monat'], 1, 12);
  const etfDepotCent = cent(roh['etfDepotCent']);
  const tagesgeldCent = cent(roh['tagesgeldCent']);
  if (jahr === null || monat === null || etfDepotCent === null || tagesgeldCent === null) {
    return null;
  }

  const eintrag: Monatseintrag = {
    id: idPruefen(roh['id'], vergebeneIds),
    jahr,
    monat,
    etfDepotCent,
    tagesgeldCent,
    erfasstAm: ganzzahl(roh['erfasstAm'], 0, 8.64e15) ?? Date.now(),
  };

  const sonderausgabeCent = cent(roh['sonderausgabeCent']);
  if (sonderausgabeCent !== null) eintrag.sonderausgabeCent = sonderausgabeCent;
  const notiz = text(roh['sonderausgabeNotiz'], MAX_NOTIZ_LAENGE);
  if (notiz !== null && notiz !== '') eintrag.sonderausgabeNotiz = notiz;

  return eintrag;
}

/** Einzelne kaputte Einstellung fällt auf den Startwert zurück, statt alles zu verwerfen. */
function einstellungenPruefen(roh: unknown): Einstellungen {
  const quelle = istObjekt(roh) ? roh : {};
  const feld = (name: keyof Einstellungen): number => cent(quelle[name]) ?? EINSTELLUNGEN_START[name];
  return {
    einkommenCent: feld('einkommenCent'),
    studiumCent: feld('studiumCent'),
    freizeitCent: feld('freizeitCent'),
    etfZusatzCent: feld('etfZusatzCent'),
    etfInFixkostenCent: feld('etfInFixkostenCent'),
  };
}

/**
 * Prüft eine Liste. Einzelne kaputte Einträge werden übersprungen (Rettungsprinzip),
 * eine Liste, in der KEIN einziger Eintrag gültig ist, gilt dagegen als Müll → null.
 */
function listePruefen<T>(roh: readonly unknown[], pruefer: (eintrag: unknown) => T | null): T[] | null {
  const ergebnis: T[] = [];
  for (const eintrag of roh) {
    const geprueft = pruefer(eintrag);
    if (geprueft !== null) ergebnis.push(geprueft);
  }
  if (roh.length > 0 && ergebnis.length === 0) return null;
  return ergebnis;
}

function migriereIntern(roh: unknown): AppDaten | null {
  if (!istObjekt(roh)) return null;
  if (enthaeltGefaehrlicheSchluessel(roh, 0)) return null;

  const version = ganzzahl(roh['schemaVersion'], 1, Number.MAX_SAFE_INTEGER);
  if (version === null) return null;
  // Datei aus einer neueren App-Version: nicht raten, lieber ehrlich scheitern.
  if (version > SCHEMA_VERSION) return null;

  let daten: Record<string, unknown> = roh;
  for (let v = version; v < SCHEMA_VERSION; v++) {
    const schritt = MIGRATIONEN.get(v);
    if (!schritt) return null; // Lücke im Migrationspfad
    const naechste = schritt(daten);
    if (!istObjekt(naechste)) return null;
    daten = naechste;
  }

  const rohFixkosten = daten['fixkosten'];
  const rohMonate = daten['monate'];
  if (!Array.isArray(rohFixkosten) || !Array.isArray(rohMonate)) return null;
  if (rohFixkosten.length > MAX_FIXKOSTEN || rohMonate.length > MAX_MONATE) return null;

  const vergebeneIds = new Set<string>();
  const fixkosten = listePruefen(rohFixkosten, (e) => fixkostenPruefen(e, vergebeneIds));
  const monate = listePruefen(rohMonate, (e) => monatPruefen(e, vergebeneIds));
  if (fixkosten === null || monate === null) return null;

  return {
    schemaVersion: SCHEMA_VERSION,
    fixkosten,
    einstellungen: einstellungenPruefen(daten['einstellungen']),
    monate,
  };
}

/**
 * Validiert `roh` strukturell und migriert es auf die aktuelle SCHEMA_VERSION.
 * Gibt `null` zurück, wenn die Daten unbrauchbar sind — dann startet die App mit
 * `startDaten()` UND die UI muss sichtbar darauf hinweisen (Daten nicht lesbar).
 * Darf niemals werfen.
 */
export function migriere(roh: unknown): AppDaten | null {
  try {
    return migriereIntern(roh);
  } catch (ursache) {
    // Letztes Netz: keine Eingabe darf die App zum Absturz bringen. Der Aufrufer
    // (main.ts bzw. portable.ts) macht aus `null` eine sichtbare Meldung.
    console.warn('Gespeicherte Daten konnten nicht gelesen werden', ursache);
    return null;
  }
}
