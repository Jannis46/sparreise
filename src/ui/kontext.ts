/**
 * Gemeinsame Typen der UI-Schicht. Eigene Datei, damit Screens und `app.ts`
 * sich nicht gegenseitig importieren müssen.
 */

import type { Store } from '../state/store';

export type ScreenId = 'uebersicht' | 'erfassen' | 'fixkosten' | 'verteilung' | 'daten';

export interface UiKontext {
  readonly store: Store;
  /** Wechselt den Screen und scrollt nach oben. */
  gehZu(ziel: ScreenId): void;
  /** Baut den aktuellen Screen neu auf (für rein lokalen UI-Zustand). */
  neuRendern(): void;
}

/**
 * Ein Screen liefert seinen Wurzelknoten und optional eine gezielte Auffrischung.
 *
 * `aktualisieren()` wird bei JEDER Store-Änderung gerufen und darf deshalb keine
 * Eingabefelder neu bauen, in denen gerade getippt wird — sonst verliert iOS den Fokus
 * und die Tastatur klappt zu. Es aktualisiert nur abgeleitete Anzeigen, und baut Listen
 * nur dann neu, wenn sich deren Zusammensetzung wirklich geändert hat.
 */
export interface Screen {
  readonly el: HTMLElement;
  aktualisieren?(): void;
}

export type ScreenBauer = (kontext: UiKontext) => Screen;
