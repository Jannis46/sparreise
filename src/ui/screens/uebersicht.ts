/**
 * Screen 1 — Übersicht. Eigentümer: Agent "UI".
 *
 * Beantwortet in einem Blick: Wie viel habe ich, wie viel mehr als letzten Monat,
 * wie weit bin ich zur nächsten Etappe, und wie lief es bisher.
 */

import { TIER_TEXT } from '../../storage/adapter';
import { formatCent } from '../../domain/geld';
import { etappen, sortierteMonate, veraenderungCent, vermoegenCent } from '../../domain/etappen';
import type { Etappe } from '../../domain/etappen';
import type { Monatseintrag } from '../../domain/types';
import { linienChart, ringFortschritt } from '../../chart/chart';
import type { ChartPunkt } from '../../chart/chart';
import {
  diagrammEinsetzen,
  el,
  karte,
  knopf,
  leeren,
  monatKurz,
  monatName,
  wertZeile,
} from '../components/basis';
import type { Screen, UiKontext } from '../kontext';

/** Bei mehr als zwei Jahren wird die X-Achse unlesbar — ältere Monate fallen raus. */
const MAX_PUNKTE = 24;

/** Die Etappe, an der gerade gearbeitet wird: die erste noch nicht erreichte. */
function aktuelleEtappe(alle: readonly Etappe[]): Etappe | null {
  for (const etappe of alle) {
    if (!etappe.erreicht) return etappe;
  }
  return alle.length > 0 ? (alle[alle.length - 1] as Etappe) : null;
}

export function bauUebersicht(kontext: UiKontext): Screen {
  const wurzel = el('div', 'screen-uebersicht');

  function zeichnen(): void {
    leeren(wurzel);

    const daten = kontext.store.getDaten();
    const monate = sortierteMonate(daten);
    const letzter: Monatseintrag | undefined = monate[monate.length - 1];

    // ---------------------------------------------------------- Vermögen
    const vermoegenKarte = karte();
    vermoegenKarte.appendChild(el('p', 'gross-label', 'Vermögen gesamt'));
    vermoegenKarte.appendChild(
      el('p', 'gross-zahl', formatCent(letzter ? vermoegenCent(letzter) : 0)),
    );

    const veraenderung = veraenderungCent(daten);
    if (veraenderung !== null) {
      const richtung = veraenderung > 0 ? 'plus' : veraenderung < 0 ? 'minus' : '';
      const vorzeichen = veraenderung > 0 ? '+' : '';
      const zeile = el(
        'p',
        `veraenderung${richtung ? ` veraenderung-${richtung}` : ''}`,
        `${vorzeichen}${formatCent(veraenderung)} seit dem Vormonat`,
      );
      vermoegenKarte.appendChild(zeile);
    } else if (letzter) {
      vermoegenKarte.appendChild(
        el('p', 'veraenderung', 'Ab dem zweiten erfassten Monat siehst du hier die Veränderung.'),
      );
    }

    if (letzter) {
      vermoegenKarte.appendChild(wertZeile('ETF-Depot', formatCent(letzter.etfDepotCent)));
      vermoegenKarte.appendChild(wertZeile('Tagesgeld', formatCent(letzter.tagesgeldCent)));
      vermoegenKarte.appendChild(
        el('p', 'fuss', `Stand: ${monatName(letzter.monat)} ${letzter.jahr}`),
      );
    } else {
      vermoegenKarte.appendChild(
        el(
          'p',
          'leer-hinweis',
          'Noch kein Monat erfasst. Trage Depotwert und Tagesgeld ein — das dauert keine 15 Sekunden.',
        ),
      );
      vermoegenKarte.appendChild(
        knopf('Ersten Monat erfassen', 'knopf-haupt', () => kontext.gehZu('erfassen')),
      );
    }
    wurzel.appendChild(vermoegenKarte);

    // ---------------------------------------------------------- Etappe
    const alleEtappen = etappen(daten);
    const etappe = aktuelleEtappe(alleEtappen);
    if (etappe) {
      // `Etappe.name` benennt das ZIEL, nicht den Zustand ("Ziel erreicht" ist der
      // Name der 10.000-€-Marke). Deshalb steht darüber, dass es die nächste ist.
      const alleGeschafft = etappe.erreicht;
      const etappenKarte = karte(alleGeschafft ? 'Etappen' : 'Nächste Etappe');
      const reihe = el('div', 'etappe');
      reihe.appendChild(ringFortschritt(etappe.anteil, 76));

      const text = el('div', 'etappe-text');
      text.appendChild(el('p', 'etappe-name', etappe.name));
      const gesamt = letzter ? vermoegenCent(letzter) : 0;
      const rest = etappe.zielCent - gesamt;
      text.appendChild(
        el(
          'p',
          'etappe-rest',
          alleGeschafft
            ? `Alle Etappen geschafft — ${formatCent(etappe.zielCent)} erreicht.`
            : `Noch ${formatCent(rest)} bis ${formatCent(etappe.zielCent)}`,
        ),
      );
      reihe.appendChild(text);
      etappenKarte.appendChild(reihe);
      wurzel.appendChild(etappenKarte);
    }

    // ---------------------------------------------------------- Verlauf
    const verlaufKarte = karte('Verlauf');
    const sichtbare = monate.slice(-MAX_PUNKTE);
    const etfPunkte: ChartPunkt[] = sichtbare.map((m) => ({
      label: monatKurz(m.jahr, m.monat),
      wertCent: m.etfDepotCent,
    }));
    const tagesgeldPunkte: ChartPunkt[] = sichtbare.map((m) => ({
      label: monatKurz(m.jahr, m.monat),
      wertCent: m.tagesgeldCent,
    }));

    const diagramm = el('div', 'diagramm');
    verlaufKarte.appendChild(diagramm);
    diagrammEinsetzen(diagramm, (breite) =>
      linienChart(
        [
          { name: 'ETF-Depot', farbe: 'var(--etf)', punkte: etfPunkte },
          { name: 'Tagesgeld', farbe: 'var(--tagesgeld)', punkte: tagesgeldPunkte },
        ],
        { breite, hoehe: 220 },
      ),
    );
    if (monate.length > MAX_PUNKTE) {
      verlaufKarte.appendChild(el('p', 'fuss', `Zeigt die letzten ${MAX_PUNKTE} Monate.`));
    }
    wurzel.appendChild(verlaufKarte);

    // ---------------------------------------------------------- Speicherstand
    const status = kontext.store.getStatus();
    const speicherKarte = karte('Speicher');
    speicherKarte.appendChild(el('p', 'hinweis', TIER_TEXT[status.tier]));
    if (status.letzterSpeicherzeitpunkt !== null) {
      const zeit = new Date(status.letzterSpeicherzeitpunkt);
      speicherKarte.appendChild(
        el(
          'p',
          'fuss',
          `Zuletzt gesichert: ${zeit.toLocaleString('de-DE', {
            dateStyle: 'short',
            timeStyle: 'short',
          })}`,
        ),
      );
    }
    wurzel.appendChild(speicherKarte);
  }

  zeichnen();

  return {
    el: wurzel,
    // Die Übersicht hat keine Eingabefelder — hier ist ein kompletter Neuaufbau
    // die einfachste korrekte Lösung.
    aktualisieren: zeichnen,
  };
}
