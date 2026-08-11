/**
 * Handgeschriebene SVG-Charts. KEINE Chart-Bibliothek, keine Runtime-Dependency.
 * Eigentümer: Agent "UI".
 *
 * Regeln, die hier bewusst durchgehalten werden:
 *  - KEIN Hover, KEINE Tooltips. Jeder Wert, den man wissen muss, steht als Text im Bild.
 *  - Farben kommen aus CSS-Variablen (per `style`, nicht als Präsentationsattribut —
 *    `fill="var(--x)"` löst in Safari nicht auf, `style.fill = 'var(--x)'` schon).
 *    Dark Mode funktioniert dadurch ohne Zutun.
 *  - `viewBox` + `preserveAspectRatio` + `width:100%` → skaliert mit, wird nie breiter
 *    als der Container, erzeugt also nie horizontales Scrollen.
 *  - Schriftgrößen sind so gewählt, dass sie auch bei 320px Viewport (Skalierung ~0,8)
 *    über 11px bleiben.
 *  - Robust gegen: 0 Punkte, 1 Punkt, alle Werte gleich, negative Werte, riesige Werte,
 *    NaN/Infinity in den Daten.
 */

import { formatCent } from '../domain/geld';

const NS = 'http://www.w3.org/2000/svg';

/** Muted für Achsen/Raster. */
const FARBE_TEXT = 'var(--diagramm-text)';
const FARBE_RASTER = 'var(--diagramm-raster)';
const FARBE_HAUPT = 'var(--text)';
const FARBE_SPUR = 'var(--diagramm-spur)';
const FARBE_FLAECHE = 'var(--flaeche)';

/** Basisgrößen der Beschriftung. Bei 320px skaliert das auf ~11px herunter. */
const SCHRIFT_ACHSE = 14;
const SCHRIFT_LEGENDE = 15;

export interface ChartPunkt {
  /** X-Beschriftung, z.B. "08/26". */
  label: string;
  /** Y-Wert in Cent (Integer). */
  wertCent: number;
}

export interface ChartReihe {
  name: string;
  /** CSS-Farbe oder CSS-Variablenreferenz. */
  farbe: string;
  punkte: ChartPunkt[];
}

export interface ChartOptionen {
  breite: number;
  hoehe: number;
  /** Y-Achse bei 0 beginnen lassen. Default true. */
  abNull?: boolean;
}

// ------------------------------------------------------------------ Bausteine

function knoten<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(NS, name);
}

function attr(element: Element, werte: Record<string, string | number>): void {
  for (const [name, wert] of Object.entries(werte)) {
    element.setAttribute(name, String(wert));
  }
}

function zahl(wert: number): number {
  return Number.isFinite(wert) ? wert : 0;
}

/** Auf 1 Nachkommastelle runden — hält die Pfaddaten kurz. */
function r1(wert: number): number {
  return Math.round(wert * 10) / 10;
}

function textKnoten(
  inhalt: string,
  x: number,
  y: number,
  groesse: number,
  farbe: string,
  anker: 'start' | 'middle' | 'end',
): SVGTextElement {
  const t = knoten('text');
  attr(t, { x: r1(x), y: r1(y), 'text-anchor': anker });
  t.style.fontSize = `${groesse}px`;
  t.style.fontFamily = 'inherit';
  t.style.fill = farbe;
  // textContent, nie innerHTML — Reihennamen können Nutzertext enthalten.
  t.textContent = inhalt;
  return t;
}

function linie(x1: number, y1: number, x2: number, y2: number, farbe: string, breite: number): SVGLineElement {
  const l = knoten('line');
  attr(l, { x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2) });
  l.style.stroke = farbe;
  l.style.strokeWidth = String(breite);
  return l;
}

function grundgeruest(breite: number, hoehe: number, beschreibung: string): SVGSVGElement {
  const svg = knoten('svg');
  attr(svg, {
    viewBox: `0 0 ${breite} ${hoehe}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    focusable: 'false',
  });
  svg.style.display = 'block';
  svg.style.width = '100%';
  svg.style.maxWidth = '100%';
  svg.style.height = 'auto';
  svg.style.overflow = 'visible';
  const titel = knoten('title');
  titel.textContent = beschreibung;
  svg.appendChild(titel);
  return svg;
}

/** Kompakte Achsenbeschriftung: "12.345 €" statt "12.345,67 €" — sonst zu breit bei 390px. */
const GANZ_FORMAT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

function kurzEuro(cent: number): string {
  return `${GANZ_FORMAT.format(Math.round(zahl(cent) / 100))} €`;
}

/**
 * Y-Skala. Fängt die drei klassischen Divisions-durch-0-Fälle ab:
 * leere Liste, alle Werte gleich, und Spanne < 1 Cent.
 */
function skala(werte: readonly number[], abNull: boolean): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const wert of werte) {
    const w = zahl(wert);
    if (w < min) min = w;
    if (w > max) max = w;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  if (abNull) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  // Negative Werte müssen sichtbar bleiben, auch ohne abNull.
  if (min > 0 && !abNull) min = min * 0.98;
  if (max - min < 1) max = min + 1;
  return { min, max };
}

/**
 * Welche X-Beschriftungen werden gezeichnet? Vom Ende her ausgedünnt, damit der
 * aktuellste Monat IMMER beschriftet ist. Bei 390px passen ~6 Labels nebeneinander.
 */
function labelIndizes(anzahl: number, plotBreite: number): number[] {
  if (anzahl <= 0) return [];
  const maximal = Math.max(2, Math.floor(plotBreite / 54));
  const schritt = Math.max(1, Math.ceil(anzahl / maximal));
  const indizes: number[] = [];
  for (let i = anzahl - 1; i >= 0; i -= schritt) indizes.unshift(i);
  return indizes;
}

// ------------------------------------------------------------------ Linienchart

export function linienChart(
  reihen: readonly ChartReihe[],
  optionen: ChartOptionen,
): SVGSVGElement {
  const breite = Math.max(160, Math.round(optionen.breite));
  const hoehe = Math.max(140, Math.round(optionen.hoehe));
  const abNull = optionen.abNull !== false;

  const gefuellt = reihen.filter((reihe) => reihe.punkte.length > 0);

  if (gefuellt.length === 0) {
    const svg = grundgeruest(breite, hoehe, 'Verlaufsdiagramm ohne Daten.');
    svg.appendChild(
      textKnoten('Noch keine Verlaufsdaten', breite / 2, hoehe / 2, SCHRIFT_LEGENDE, FARBE_TEXT, 'middle'),
    );
    return svg;
  }

  // Beschriftungen der längsten Reihe geben die X-Achse vor.
  let labels: string[] = [];
  for (const reihe of gefuellt) {
    if (reihe.punkte.length > labels.length) labels = reihe.punkte.map((p) => p.label);
  }
  const anzahl = labels.length;

  const werte: number[] = [];
  for (const reihe of gefuellt) for (const punkt of reihe.punkte) werte.push(zahl(punkt.wertCent));
  const { min, max } = skala(werte, abNull);

  const beschreibungTeile = gefuellt.map((reihe) => {
    const letzter = reihe.punkte[reihe.punkte.length - 1];
    return `${reihe.name} zuletzt ${formatCent(letzter ? letzter.wertCent : 0)}`;
  });
  const svg = grundgeruest(
    breite,
    hoehe,
    `Verlauf über ${anzahl} ${anzahl === 1 ? 'Monat' : 'Monate'}. ${beschreibungTeile.join('. ')}.`,
  );

  const legendeHoehe = gefuellt.length * 20;
  const padLinks = 4;
  const padRechts = 4;
  const oben = Math.min(legendeHoehe + 20, hoehe - 70);
  const unten = hoehe - 26;
  const plotBreite = breite - padLinks - padRechts;
  const plotHoehe = Math.max(20, unten - oben);

  const x = (index: number): number =>
    anzahl <= 1 ? breite / 2 : padLinks + (index * plotBreite) / (anzahl - 1);
  const y = (wert: number): number => unten - ((zahl(wert) - min) / (max - min)) * plotHoehe;

  // Raster: drei Linien, beschriftet werden nur oben und unten (weniger Unruhe bei 390px).
  for (const anteil of [0, 0.5, 1]) {
    const linienY = unten - anteil * plotHoehe;
    svg.appendChild(linie(0, linienY, breite, linienY, FARBE_RASTER, 1));
  }
  svg.appendChild(textKnoten(kurzEuro(max), 2, oben - 6, SCHRIFT_ACHSE, FARBE_TEXT, 'start'));
  svg.appendChild(textKnoten(kurzEuro(min), 2, unten - 6, SCHRIFT_ACHSE, FARBE_TEXT, 'start'));

  // Nulllinie hervorheben, wenn negative Werte vorkommen.
  if (min < 0 && max > 0) {
    svg.appendChild(linie(0, y(0), breite, y(0), FARBE_TEXT, 1));
  }

  // X-Beschriftung, ausgedünnt.
  const indizes = labelIndizes(anzahl, plotBreite);
  for (const index of indizes) {
    // Erstes/letztes Label an den Rand ankern, sonst ragt es aus der viewBox.
    const anker = index === 0 ? 'start' : index === anzahl - 1 ? 'end' : 'middle';
    svg.appendChild(
      textKnoten(labels[index] ?? '', x(index), hoehe - 8, SCHRIFT_ACHSE, FARBE_TEXT, anker),
    );
  }

  // Linien + Endpunktmarkierung.
  for (const reihe of gefuellt) {
    const punkte = reihe.punkte;
    if (punkte.length > 1) {
      let d = '';
      for (let i = 0; i < punkte.length; i++) {
        const punkt = punkte[i];
        if (!punkt) continue;
        d += `${i === 0 ? 'M' : 'L'}${r1(x(i))} ${r1(y(punkt.wertCent))}`;
        if (i < punkte.length - 1) d += ' ';
      }
      const pfad = knoten('path');
      attr(pfad, { d });
      pfad.style.fill = 'none';
      pfad.style.stroke = reihe.farbe;
      pfad.style.strokeWidth = '2.5';
      pfad.style.strokeLinecap = 'round';
      pfad.style.strokeLinejoin = 'round';
      svg.appendChild(pfad);
    }

    const letzterIndex = punkte.length - 1;
    const letzter = punkte[letzterIndex];
    if (letzter) {
      const kreis = knoten('circle');
      attr(kreis, { cx: r1(x(letzterIndex)), cy: r1(y(letzter.wertCent)), r: 4.5 });
      kreis.style.fill = reihe.farbe;
      kreis.style.stroke = FARBE_FLAECHE;
      kreis.style.strokeWidth = '2';
      svg.appendChild(kreis);
    }
  }

  // Legende IM Bild: Name + aktueller Wert. Ersetzt Tooltips vollständig.
  gefuellt.forEach((reihe, i) => {
    const basisY = 15 + i * 20;
    const punkt = knoten('circle');
    attr(punkt, { cx: 6, cy: basisY - 5, r: 5 });
    punkt.style.fill = reihe.farbe;
    svg.appendChild(punkt);
    const letzter = reihe.punkte[reihe.punkte.length - 1];
    svg.appendChild(
      textKnoten(
        `${reihe.name} ${formatCent(letzter ? letzter.wertCent : 0)}`,
        18,
        basisY,
        SCHRIFT_LEGENDE,
        FARBE_HAUPT,
        'start',
      ),
    );
  });

  return svg;
}

// ------------------------------------------------------------------ Balkenchart

/**
 * Balken LIEGEND. Stehende Balken bräuchten bei 390px gedrehte oder abgeschnittene
 * Beschriftungen; liegend passt jede Bezeichnung in eine eigene Zeile.
 */
export function balkenChart(reihe: ChartReihe, optionen: ChartOptionen): SVGSVGElement {
  const breite = Math.max(160, Math.round(optionen.breite));
  const punkte = reihe.punkte;

  if (punkte.length === 0) {
    const leer = grundgeruest(breite, 60, 'Balkendiagramm ohne Daten.');
    leer.appendChild(textKnoten('Keine Daten', breite / 2, 34, SCHRIFT_LEGENDE, FARBE_TEXT, 'middle'));
    return leer;
  }

  const zeilenHoehe = 42;
  const hoehe = Math.max(Math.round(optionen.hoehe), punkte.length * zeilenHoehe + 4);

  let groesster = 0;
  for (const punkt of punkte) groesster = Math.max(groesster, Math.abs(zahl(punkt.wertCent)));

  const beschreibung = punkte
    .map((punkt) => `${punkt.label} ${formatCent(punkt.wertCent)}`)
    .join(', ');
  const svg = grundgeruest(breite, hoehe, `${reihe.name}: ${beschreibung}.`);

  punkte.forEach((punkt, i) => {
    const obenY = 4 + i * zeilenHoehe;
    const wert = zahl(punkt.wertCent);

    svg.appendChild(textKnoten(punkt.label, 0, obenY + 15, SCHRIFT_ACHSE, FARBE_TEXT, 'start'));
    svg.appendChild(
      textKnoten(formatCent(wert), breite, obenY + 15, SCHRIFT_ACHSE, FARBE_HAUPT, 'end'),
    );

    const spur = knoten('rect');
    attr(spur, { x: 0, y: obenY + 23, width: breite, height: 9, rx: 4.5 });
    spur.style.fill = FARBE_SPUR;
    svg.appendChild(spur);

    const anteil = groesster > 0 ? Math.abs(wert) / groesster : 0;
    const balkenBreite = Math.max(wert === 0 ? 0 : 4, r1(anteil * breite));
    if (balkenBreite > 0) {
      const balken = knoten('rect');
      attr(balken, { x: 0, y: obenY + 23, width: balkenBreite, height: 9, rx: 4.5 });
      balken.style.fill = wert < 0 ? 'var(--minus)' : reihe.farbe;
      svg.appendChild(balken);
    }
  });

  return svg;
}

// ------------------------------------------------------------------ Ring

/** Ringfortschritt 0..1. `anteil` wird geklemmt, NaN wird zu 0. */
export function ringFortschritt(anteil: number, groesse: number): SVGSVGElement {
  const seite = Math.max(48, Math.round(groesse));
  const wert = Number.isFinite(anteil) ? Math.min(1, Math.max(0, anteil)) : 0;
  const prozent = Math.round(wert * 100);

  const svg = grundgeruest(seite, seite, `Fortschritt ${prozent} Prozent.`);
  svg.style.width = `${seite}px`;
  svg.style.height = `${seite}px`;
  svg.style.flex = '0 0 auto';

  const dicke = Math.max(6, Math.round(seite * 0.1));
  const radius = seite / 2 - dicke / 2;
  const umfang = 2 * Math.PI * radius;

  const spur = knoten('circle');
  attr(spur, { cx: seite / 2, cy: seite / 2, r: r1(radius) });
  spur.style.fill = 'none';
  spur.style.stroke = FARBE_SPUR;
  spur.style.strokeWidth = String(dicke);
  svg.appendChild(spur);

  if (wert > 0) {
    const bogen = knoten('circle');
    attr(bogen, {
      cx: seite / 2,
      cy: seite / 2,
      r: r1(radius),
      transform: `rotate(-90 ${seite / 2} ${seite / 2})`,
    });
    bogen.style.fill = 'none';
    bogen.style.stroke = 'var(--akzent)';
    bogen.style.strokeWidth = String(dicke);
    bogen.style.strokeLinecap = 'round';
    bogen.style.strokeDasharray = `${r1(umfang)} ${r1(umfang)}`;
    bogen.style.strokeDashoffset = String(r1(umfang * (1 - wert)));
    svg.appendChild(bogen);
  }

  const beschriftung = textKnoten(
    `${prozent} %`,
    seite / 2,
    seite / 2 + Math.round(seite * 0.09),
    Math.max(14, Math.round(seite * 0.24)),
    FARBE_HAUPT,
    'middle',
  );
  beschriftung.style.fontWeight = '600';
  svg.appendChild(beschriftung);

  return svg;
}
