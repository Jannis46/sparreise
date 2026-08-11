/**
 * Kleine DOM-Bausteine der Oberfläche. Eigentümer: Agent "UI".
 *
 * Kein Framework, kein Virtual DOM: Funktionen bauen Knoten, die Screens hängen sie ein.
 * NIEMALS `innerHTML` — jeder Text geht über `textContent`. Fixkostennamen und Notizen
 * sind Nutzereingaben.
 */

import { formatCentRoh, parseEuroZuCent } from '../../domain/geld';

export const MONATSNAMEN: readonly string[] = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

/** "August". Außerhalb von 1..12 wird die Zahl gezeigt statt zu raten. */
export function monatName(monat: number): string {
  return MONATSNAMEN[monat - 1] ?? `Monat ${monat}`;
}

/** Kompakte Diagrammbeschriftung "08/26". */
export function monatKurz(jahr: number, monat: number): string {
  const mm = String(monat).padStart(2, '0');
  const jj = String(Math.abs(jahr) % 100).padStart(2, '0');
  return `${mm}/${jj}`;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  klasse?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const knoten = document.createElement(tag);
  if (klasse) knoten.className = klasse;
  if (text !== undefined) knoten.textContent = text;
  return knoten;
}

export function leeren(knoten: Node): void {
  while (knoten.firstChild) knoten.removeChild(knoten.firstChild);
}

/**
 * Button. `klasse` bestimmt die Optik; jede Variante erfüllt über das CSS die
 * 44×44-px-Mindestgröße.
 */
export function knopf(text: string, klasse: string, beiKlick: () => void): HTMLButtonElement {
  const b = el('button', klasse, text);
  b.type = 'button';
  b.addEventListener('click', beiKlick);
  return b;
}

/** Icon-Button (Löschen o.ä.). Braucht ein `aria-label`, weil das Zeichen allein nichts sagt. */
export function symbolKnopf(zeichen: string, beschriftung: string, beiKlick: () => void): HTMLButtonElement {
  const b = knopf(zeichen, 'knopf-symbol', beiKlick);
  b.setAttribute('aria-label', beschriftung);
  b.setAttribute('title', beschriftung);
  return b;
}

/** Karte mit optionaler Überschrift. */
export function karte(titel?: string): HTMLElement {
  const abschnitt = el('section', 'karte');
  if (titel !== undefined) abschnitt.appendChild(el('h2', 'karte-titel', titel));
  return abschnitt;
}

/**
 * Setzt ein Diagramm in `behaelter` — mit der TATSÄCHLICHEN Containerbreite als
 * viewBox-Breite. Ohne das wird das SVG bei 320px herunterskaliert und die
 * Achsenbeschriftung rutscht unter 11px.
 *
 * Beim ersten Aufruf hängt der Container oft noch nicht im Dokument (clientWidth 0),
 * deshalb im nächsten Frame nachmessen.
 */
export function diagrammEinsetzen(
  behaelter: HTMLElement,
  bauen: (breite: number) => SVGSVGElement,
): void {
  const zeichnen = (): number => {
    const gemessen = Math.round(behaelter.clientWidth);
    leeren(behaelter);
    behaelter.appendChild(bauen(gemessen > 0 ? gemessen : geschaetzteBreite()));
    return gemessen;
  };
  // requestAnimationFrame feuert nicht, wenn die Seite beim Mounten unsichtbar ist —
  // deshalb ist die Schätzung der eigentliche Weg und der Frame nur die Feinkorrektur.
  if (zeichnen() <= 0) window.requestAnimationFrame(zeichnen);
}

/** Kartenpolster + Kartenrand je Seite (16px + 1px, siehe `.karte` in stil.css). */
const KARTEN_RAND = 34;

/** Breite der Inhaltsspalte abzüglich Kartenpolster — Schätzung, bis gemessen werden kann. */
function geschaetzteBreite(): number {
  const inhalt = document.querySelector('.inhalt');
  if (!(inhalt instanceof HTMLElement) || inhalt.clientWidth <= 0) return 320;
  const stil = window.getComputedStyle(inhalt);
  const innen =
    inhalt.clientWidth - (parseFloat(stil.paddingLeft) || 0) - (parseFloat(stil.paddingRight) || 0);
  return Math.max(200, Math.round(innen) - KARTEN_RAND);
}

/** Beschriftete Zeile "Bezeichnung ....... Wert". */
export function wertZeile(bezeichnung: string, wert: string, klasse = ''): HTMLElement {
  const zeile = el('div', `wertzeile ${klasse}`.trim());
  zeile.appendChild(el('span', 'wertzeile-name', bezeichnung));
  zeile.appendChild(el('span', 'wertzeile-wert', wert));
  return zeile;
}

/** Rückfrage. Nur für zerstörende Aktionen — Anlegen und Speichern fragen NIE nach. */
export function bestaetigen(frage: string): boolean {
  return window.confirm(frage);
}

let feldZaehler = 0;

function neueFeldId(): string {
  feldZaehler += 1;
  return `feld-${feldZaehler}`;
}

export interface BetragFeld {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  /** Setzt den angezeigten Wert und räumt eine Fehlermarkierung ab. */
  setzen(cent: number): void;
  /** Parst den aktuellen Text. `null` = unlesbar; das Feld ist dann sichtbar markiert. */
  lesen(): number | null;
}

export interface BetragFeldOptionen {
  label: string;
  wertCent: number;
  hinweis?: string;
  /** Wird beim Verlassen des Feldes gerufen — nur mit einem gültig geparsten Wert. */
  beiGueltig?: (cent: number) => void;
  /** Wird bei jeder Tasteneingabe gerufen (für Live-Vorschauen). */
  beiEingabe?: () => void;
}

/**
 * Betragsfeld. Bewusst `type="text"` + `inputmode="decimal"`:
 * `type="number"` verschluckt auf iOS das Komma und zeigt Spinner.
 * Schriftgröße kommt aus dem CSS und liegt bei 17px — unter 16px zoomt Safari beim Fokus.
 *
 * Fehlerverhalten (verbindlich): unlesbare Eingabe wird MARKIERT, der zuletzt gültige
 * Wert bleibt stehen. Es wird niemals stillschweigend auf 0 gesetzt.
 */
export function betragFeld(optionen: BetragFeldOptionen): BetragFeld {
  const id = neueFeldId();
  const wrapper = el('div', 'feld');

  const label = el('label', 'feld-label', optionen.label);
  label.htmlFor = id;
  wrapper.appendChild(label);

  const zeile = el('div', 'feld-zeile');
  const input = el('input', 'feld-eingabe');
  input.id = id;
  input.type = 'text';
  input.setAttribute('inputmode', 'decimal');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('enterkeyhint', 'done');
  input.spellcheck = false;
  input.value = formatCentRoh(optionen.wertCent);
  zeile.appendChild(input);
  zeile.appendChild(el('span', 'feld-einheit', '€'));
  wrapper.appendChild(zeile);

  if (optionen.hinweis !== undefined) {
    wrapper.appendChild(el('p', 'feld-hinweis', optionen.hinweis));
  }

  const fehler = el('p', 'feld-fehler', 'Das konnte ich nicht als Betrag lesen. Beispiel: 1.234,56');
  fehler.hidden = true;
  wrapper.appendChild(fehler);

  function markieren(ungueltig: boolean): void {
    input.classList.toggle('ungueltig', ungueltig);
    input.setAttribute('aria-invalid', ungueltig ? 'true' : 'false');
    fehler.hidden = !ungueltig;
  }

  function lesen(): number | null {
    const cent = parseEuroZuCent(input.value);
    markieren(cent === null);
    return cent;
  }

  input.addEventListener('input', () => {
    if (input.classList.contains('ungueltig')) markieren(false);
    if (optionen.beiEingabe) optionen.beiEingabe();
  });

  input.addEventListener('change', () => {
    const cent = lesen();
    if (cent === null) return; // markiert bleiben, alten Wert behalten
    input.value = formatCentRoh(cent);
    if (optionen.beiGueltig) optionen.beiGueltig(cent);
  });

  // Alles markieren beim Antippen: Überschreiben statt Cursor-Fummelei — das ist der
  // Unterschied zwischen 8 und 20 Sekunden Monatserfassung.
  input.addEventListener('focus', () => {
    // Im nächsten Frame, weil iOS die Auswahl beim Setzen des Fokus sonst wieder verwirft.
    window.requestAnimationFrame(() => {
      if (document.activeElement === input) input.select();
    });
  });

  return {
    el: wrapper,
    input,
    setzen(cent: number): void {
      input.value = formatCentRoh(cent);
      markieren(false);
    },
    lesen,
  };
}

export interface TextFeld {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  lesen(): string;
  setzen(wert: string): void;
}

export function textFeld(optionen: {
  label: string;
  wert: string;
  platzhalter?: string;
  beiAenderung?: (wert: string) => void;
}): TextFeld {
  const id = neueFeldId();
  const wrapper = el('div', 'feld');

  const label = el('label', 'feld-label', optionen.label);
  label.htmlFor = id;
  wrapper.appendChild(label);

  const input = el('input', 'feld-eingabe');
  input.id = id;
  input.type = 'text';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('enterkeyhint', 'done');
  input.maxLength = 120;
  input.value = optionen.wert;
  if (optionen.platzhalter !== undefined) input.placeholder = optionen.platzhalter;
  wrapper.appendChild(input);

  input.addEventListener('change', () => {
    if (optionen.beiAenderung) optionen.beiAenderung(input.value.trim());
  });

  return {
    el: wrapper,
    input,
    lesen: () => input.value.trim(),
    setzen: (wert: string) => {
      input.value = wert;
    },
  };
}

/** Kleine Statuszeile unter einer Aktion ("Gespeichert." / Fehlermeldung). */
export interface Meldungszeile {
  readonly el: HTMLElement;
  zeigen(text: string, art?: 'gut' | 'fehler'): void;
  leeren(): void;
}

export function meldungszeile(): Meldungszeile {
  const p = el('p', 'meldung');
  p.setAttribute('role', 'status');
  p.hidden = true;
  return {
    el: p,
    zeigen(text: string, art: 'gut' | 'fehler' = 'gut'): void {
      p.textContent = text;
      p.className = `meldung meldung-${art}`;
      p.hidden = false;
    },
    leeren(): void {
      p.textContent = '';
      p.hidden = true;
    },
  };
}
