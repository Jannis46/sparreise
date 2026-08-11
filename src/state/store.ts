/**
 * Zentraler Store. Eigentümer: ARCHITEKT (nicht von Bau-Agents ändern).
 *
 * Hält genau eine Wahrheit (`AppDaten`) und ist die EINZIGE Stelle, die
 * `StorageAdapter.speichern()` aufruft. Dadurch kann es strukturell keine zwei
 * gleichzeitigen Schreibvorgänge geben.
 *
 * Schreibverhalten:
 *  - jede Mutation stößt SOFORT einen Speichervorgang an (kein Debounce — auf iOS
 *    kann die App jederzeit eingefroren werden)
 *  - Schreibvorgänge hängen an einer Promise-Kette, laufen also strikt nacheinander
 *  - Coalescing: treffen während eines laufenden Schreibvorgangs mehrere Mutationen ein,
 *    wird danach GENAU EINMAL der dann aktuelle Stand geschrieben
 *  - schlägt ein Schreibvorgang fehl, wird (falls konfiguriert) herabgestuft und einmal
 *    mit dem neuen Adapter erneut versucht; danach steht der Fehler sichtbar im Status
 */

import type { AppDaten, Einstellungen, Fixkostenposten, Monatseintrag } from '../domain/types';
import { neueId } from '../domain/types';
import type { StorageAdapter, StorageTier } from '../storage/adapter';
import { nutzerTextAus } from '../storage/adapter';

export interface StoreStatus {
  /** Aktuell genutzter Speicher-Tier. */
  tier: StorageTier;
  /** true, solange ein Schreibvorgang läuft. */
  speichertGerade: boolean;
  /** Date.now() des letzten erfolgreichen Schreibvorgangs, sonst null. */
  letzterSpeicherzeitpunkt: number | null;
  /** Deutschsprachiger, direkt anzeigbarer Fehlertext. null = alles in Ordnung. */
  letzterFehler: string | null;
}

export type StoreListener = (daten: Readonly<AppDaten>, status: Readonly<StoreStatus>) => void;

/**
 * Wird von der Tiering-Schicht (Agent "Persistenz", src/storage/tiering.ts) geliefert.
 * Bekommt den fehlgeschlagenen Adapter und den Fehler; liefert einen schlechteren,
 * aber funktionierenden Adapter zurück — oder null, wenn keiner mehr übrig ist.
 */
export type Herabstufen = (
  fehler: unknown,
  aktuellerTier: StorageTier,
) => Promise<StorageAdapter | null>;

export interface StoreOptionen {
  herabstufen?: Herabstufen;
}

export class Store {
  private daten: AppDaten;
  private adapter: StorageAdapter;
  private readonly herabstufen: Herabstufen | undefined;
  private readonly listener: StoreListener[] = [];

  private status: StoreStatus;

  /** Ende der seriellen Schreibkette. Reißt nie ab (Fehler werden abgefangen). */
  private schreibKette: Promise<void> = Promise.resolve();
  /** true, wenn seit dem letzten Schreibvorgang wieder etwas zu schreiben ist. */
  private schreibenGeplant = false;
  /** true, solange der Schreibläufer aktiv ist (inklusive laufendem Adapter-Aufruf). */
  private schreibtGerade = false;

  constructor(adapter: StorageAdapter, startwerte: AppDaten, optionen: StoreOptionen = {}) {
    this.adapter = adapter;
    this.daten = startwerte;
    this.herabstufen = optionen.herabstufen;
    this.status = {
      tier: adapter.tier,
      speichertGerade: false,
      letzterSpeicherzeitpunkt: null,
      letzterFehler: null,
    };
  }

  // ---------------------------------------------------------------- Lesen

  getDaten(): Readonly<AppDaten> {
    return this.daten;
  }

  getStatus(): Readonly<StoreStatus> {
    return this.status;
  }

  /** Registriert einen Listener; Rückgabewert meldet ihn wieder ab. */
  subscribe(fn: StoreListener): () => void {
    this.listener.push(fn);
    return () => {
      const i = this.listener.indexOf(fn);
      if (i >= 0) this.listener.splice(i, 1);
    };
  }

  // ------------------------------------------------------------ Mutationen

  /**
   * Basis aller Mutationen. `mutator` MUSS ein neues Objekt zurückgeben und darf
   * das übergebene nicht verändern. Speichert sofort.
   */
  aktualisieren(mutator: (alt: Readonly<AppDaten>) => AppDaten): Promise<void> {
    this.daten = mutator(this.daten);
    this.benachrichtigen();
    return this.speichernAnstossen();
  }

  einstellungenSetzen(teil: Partial<Einstellungen>): Promise<void> {
    return this.aktualisieren((d) => ({
      ...d,
      einstellungen: { ...d.einstellungen, ...teil },
    }));
  }

  fixkostenHinzufuegen(name: string, betragCent: number): Promise<void> {
    return this.aktualisieren((d) => ({
      ...d,
      fixkosten: [...d.fixkosten, { id: neueId(), name, betragCent }],
    }));
  }

  fixkostenAendern(id: string, teil: Partial<Omit<Fixkostenposten, 'id'>>): Promise<void> {
    return this.aktualisieren((d) => ({
      ...d,
      fixkosten: d.fixkosten.map((p) => (p.id === id ? { ...p, ...teil } : p)),
    }));
  }

  fixkostenEntfernen(id: string): Promise<void> {
    return this.aktualisieren((d) => ({
      ...d,
      fixkosten: d.fixkosten.filter((p) => p.id !== id),
    }));
  }

  /** Verschiebt einen Posten an eine neue Position (0-basiert). */
  fixkostenVerschieben(id: string, neuerIndex: number): Promise<void> {
    return this.aktualisieren((d) => {
      const alt = d.fixkosten;
      const von = alt.findIndex((p) => p.id === id);
      if (von < 0) return d;
      const posten = alt[von] as Fixkostenposten;
      const rest = alt.slice(0, von).concat(alt.slice(von + 1));
      const ziel = Math.max(0, Math.min(neuerIndex, rest.length));
      return { ...d, fixkosten: [...rest.slice(0, ziel), posten, ...rest.slice(ziel)] };
    });
  }

  /** Legt einen Monatseintrag an. `id` und `erfasstAm` werden gesetzt. */
  monatHinzufuegen(eintrag: Omit<Monatseintrag, 'id' | 'erfasstAm'>): Promise<void> {
    return this.aktualisieren((d) => ({
      ...d,
      monate: [...d.monate, { ...eintrag, id: neueId(), erfasstAm: Date.now() }],
    }));
  }

  monatAendern(id: string, teil: Partial<Omit<Monatseintrag, 'id'>>): Promise<void> {
    return this.aktualisieren((d) => ({
      ...d,
      monate: d.monate.map((m) => (m.id === id ? { ...m, ...teil } : m)),
    }));
  }

  monatEntfernen(id: string): Promise<void> {
    return this.aktualisieren((d) => ({
      ...d,
      monate: d.monate.filter((m) => m.id !== id),
    }));
  }

  /** Kompletter Datensatz-Austausch — für Import (portable.ts) und Migration. */
  ersetzen(daten: AppDaten): Promise<void> {
    return this.aktualisieren(() => daten);
  }

  // -------------------------------------------------------------- Schreiben

  /**
   * Wartet, bis alle angestoßenen Schreibvorgänge durch sind.
   * Für Tests und für das Ereignis-Sicherheitsnetz.
   */
  flush(): Promise<void> {
    return this.speichernAnstossen();
  }

  /**
   * Stößt einen Schreibvorgang an. Mehrere Mutationen fallen auf möglichst wenige
   * Schreibvorgänge zusammen, weil `schreibeJetzt()` immer den **aktuellen** Stand
   * schreibt — ein zwischenzeitlich überholter Stand muss gar nicht erst raus.
   *
   * WICHTIG: Das Zusammenfassen gilt auch, solange ein Schreibvorgang **läuft**.
   * Früher wurde die Marke gelöscht, bevor der Adapter-Aufruf startete; 15 schnelle
   * Eingaben erzeugten dann 15 Schreibvorgänge in Reihe. Wer danach sofort neu lud
   * oder die App wegwischte, verlor die letzten davon — die Kette wurde mittendrin
   * abgeschnitten. Jetzt sind es höchstens zwei: der laufende und ein abschließender
   * mit dem Endstand.
   */
  private speichernAnstossen(): Promise<void> {
    this.schreibenGeplant = true;
    if (this.schreibtGerade) return this.schreibKette;

    this.schreibtGerade = true;
    this.schreibKette = this.schreibKette
      .catch(() => undefined) // Kette darf nie abreißen
      .then(async () => {
        try {
          while (this.schreibenGeplant) {
            this.schreibenGeplant = false;
            await this.schreibeJetzt();
          }
        } finally {
          this.schreibtGerade = false;
        }
      });
    return this.schreibKette;
  }

  private async schreibeJetzt(): Promise<void> {
    this.setzeStatus({ speichertGerade: true });
    try {
      await this.adapter.speichern(this.daten);
      this.setzeStatus({
        speichertGerade: false,
        letzterSpeicherzeitpunkt: Date.now(),
        letzterFehler: null,
      });
      return;
    } catch (fehler) {
      const ersatz = this.herabstufen
        ? await this.herabstufen(fehler, this.adapter.tier).catch(() => null)
        : null;

      if (!ersatz) {
        this.setzeStatus({ speichertGerade: false, letzterFehler: nutzerTextAus(fehler) });
        return;
      }

      this.adapter = ersatz;
      try {
        await ersatz.speichern(this.daten);
        this.setzeStatus({
          tier: ersatz.tier,
          speichertGerade: false,
          letzterSpeicherzeitpunkt: Date.now(),
          letzterFehler:
            ersatz.tier === 'memory'
              ? 'Speichern auf dem Gerät ist nicht möglich. Die Daten liegen nur im Arbeitsspeicher und gehen beim Schließen verloren. Bitte exportiere sie.'
              : `Der bevorzugte Speicher steht nicht zur Verfügung. Es wird jetzt ein einfacherer Speicher genutzt (${ersatz.tier}).`,
        });
      } catch (zweiterFehler) {
        this.setzeStatus({
          tier: ersatz.tier,
          speichertGerade: false,
          letzterFehler: nutzerTextAus(zweiterFehler),
        });
      }
    }
  }

  private setzeStatus(teil: Partial<StoreStatus>): void {
    this.status = { ...this.status, ...teil };
    this.benachrichtigen();
  }

  private benachrichtigen(): void {
    // Kopie, damit ein Listener sich während der Schleife abmelden darf.
    for (const fn of this.listener.slice()) {
      try {
        fn(this.daten, this.status);
      } catch (f) {
        // Ein kaputter Listener darf den Store nicht anhalten.
        // Sichtbar wird das über den Fehlerkanal der UI, nicht hier.
        console.error('Listener-Fehler', f);
      }
    }
  }

  // ------------------------------------------------- Ereignis-Sicherheitsnetz

  /**
   * Hängt Sicherheitsnetz-Handler ein. Auf iOS feuert `beforeunload` unzuverlässig —
   * `pagehide` und `visibilitychange` sind die verlässlichen Ereignisse.
   * Rückgabewert entfernt die Handler wieder.
   */
  ereignisNetzAktivieren(): () => void {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return () => undefined;
    }
    const beiVerstecken = (): void => {
      if (document.visibilityState === 'hidden') void this.flush();
    };
    const beiPagehide = (): void => {
      void this.flush();
    };
    document.addEventListener('visibilitychange', beiVerstecken);
    window.addEventListener('pagehide', beiPagehide);
    return () => {
      document.removeEventListener('visibilitychange', beiVerstecken);
      window.removeEventListener('pagehide', beiPagehide);
    };
  }
}
