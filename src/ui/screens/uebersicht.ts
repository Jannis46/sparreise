/**
 * Screen 1 — Übersicht. Eigentümer: Agent "UI".
 *
 * Beantwortet in einem Blick: Wie viel habe ich, wie viel mehr als letzten Monat,
 * wie weit bin ich zur nächsten Etappe, und wie lief es bisher.
 */

import { TIER_TEXT } from '../../storage/adapter';
import { formatCent } from '../../domain/geld';
import {
  aktuellesVermoegenCent,
  etappen,
  hoechstesVermoegenCent,
  sortierteMonate,
  veraenderungCent,
  vermoegenCent,
} from '../../domain/etappen';
import type { Etappe } from '../../domain/etappen';
import { hochrechnung } from '../../domain/hochrechnung';
import { berechneVerteilung } from '../../domain/verteilung';
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

/** Monatsnamen für die Ausgabe des Zieldatums. */
const MONATSNAMEN = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

export function bauUebersicht(kontext: UiKontext): Screen {
  const wurzel = el('div', 'screen-uebersicht');

  /**
   * „Wann bin ich da?" — mit Schieberegler zum Durchspielen.
   *
   * Gerechnet wird linear ohne Rendite. Ein ETF wächst auch durch Kurse, aber
   * jede Renditeannahme wäre geraten und würde ein Datum vorgaukeln, das
   * niemand halten kann. Lieber eine Zahl, die stimmt, wenn nichts dazukommt.
   *
   * Der Regler ist bewusst kein Hover-Element: er funktioniert per Tap und Zug,
   * die Zahl darunter aktualisiert sich sofort.
   */
  function hochrechnungKarte(standCent: number, zielCent: number): HTMLElement {
    const karteEl = karte('Wann bin ich da?');
    const jetzt = new Date();

    const geplant = berechneVerteilung(kontext.store.getDaten());
    // Vorschlag: was laut Verteilung monatlich zurückgelegt wird.
    const vorschlag = Math.max(0, geplant.investCent + geplant.uebrigCent);
    // Regler-Obergrenze großzügig, aber nicht absurd: mindestens 500 €.
    const maximum = Math.max(50000, Math.ceil((vorschlag * 2) / 5000) * 5000);

    const ausgabe = el('div', 'hochrechnung-ausgabe');

    const regler = el('input', 'regler');
    regler.type = 'range';
    regler.min = '0';
    regler.max = String(maximum);
    regler.step = '500'; // 5,00 € Schritte
    regler.value = String(Math.min(vorschlag, maximum));
    regler.setAttribute('aria-label', 'Monatliche Sparrate für die Hochrechnung');

    function neuZeichnen(): void {
      const rate = Number(regler.value);
      leeren(ausgabe);

      ausgabe.appendChild(
        wertZeile('Sparrate pro Monat', formatCent(rate), 'wertzeile-stark'),
      );

      const h = hochrechnung(standCent, zielCent, rate, jetzt.getFullYear(), jetzt.getMonth() + 1);
      ausgabe.appendChild(wertZeile(`Noch bis ${formatCent(zielCent)}`, formatCent(h.restCent)));

      if (h.erreicht) {
        ausgabe.appendChild(el('p', 'hochrechnung-satz', 'Ziel bereits erreicht.'));
      } else if (h.monate === null || h.zielJahr === null || h.zielMonat === null) {
        ausgabe.appendChild(
          el('p', 'hochrechnung-satz', 'Bei dieser Rate dauert es unabsehbar lange.'),
        );
      } else {
        const jahre = Math.floor(h.monate / 12);
        const rest = h.monate % 12;
        const dauer =
          jahre > 0
            ? `${jahre} ${jahre === 1 ? 'Jahr' : 'Jahre'}${rest > 0 ? ` und ${rest} ${rest === 1 ? 'Monat' : 'Monate'}` : ''}`
            : `${h.monate} ${h.monate === 1 ? 'Monat' : 'Monate'}`;
        ausgabe.appendChild(
          el(
            'p',
            'hochrechnung-satz',
            `In ${dauer} — also im ${MONATSNAMEN[h.zielMonat - 1]} ${h.zielJahr}.`,
          ),
        );
      }
    }

    regler.addEventListener('input', neuZeichnen);
    karteEl.appendChild(regler);
    karteEl.appendChild(ausgabe);
    karteEl.appendChild(
      el(
        'p',
        'hinweis',
        'Linear gerechnet, ohne Kursgewinne — was am Ende wirklich dasteht, kann mehr sein.',
      ),
    );
    neuZeichnen();
    return karteEl;
  }

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
      // Bezugspunkt der Etappen ist die Bestmarke — sie rutscht nicht zurück,
      // wenn das Depot fällt. Der Rest bis zum Ziel muss dieselbe Basis benutzen,
      // sonst widersprechen sich Ring und Text.
      const bestmarke = hoechstesVermoegenCent(daten);
      const aktuell = aktuellesVermoegenCent(daten);
      const rest = etappe.zielCent - bestmarke;
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

      // Ehrlich bleiben: liegt der aktuelle Stand unter der Bestmarke, muss das
      // sichtbar sein — sonst suggeriert die Etappe mehr, als gerade da ist.
      if (aktuell < bestmarke) {
        etappenKarte.appendChild(
          el(
            'p',
            'etappe-hinweis',
            `Gemessen an deiner Bestmarke von ${formatCent(bestmarke)}. ` +
              `Aktuell stehst du bei ${formatCent(aktuell)} — erreichte Etappen bleiben trotzdem erreicht.`,
          ),
        );
      }

      // Alle Etappen als Pfad. Zeigt auf einen Blick, was geschafft ist und was
      // noch kommt — die einzelne „nächste Etappe" allein verrät das nicht.
      const pfad = el('ol', 'etappen-pfad');
      for (const stufe of alleEtappen) {
        const punkt = el('li', `pfad-stufe${stufe.erreicht ? ' pfad-erreicht' : ''}`);
        punkt.appendChild(el('span', 'pfad-marke', stufe.erreicht ? '✓' : '○'));
        const beschriftung = el('span', 'pfad-text');
        beschriftung.appendChild(el('span', 'pfad-name', stufe.name));
        beschriftung.appendChild(el('span', 'pfad-ziel', formatCent(stufe.zielCent)));
        punkt.appendChild(beschriftung);
        pfad.appendChild(punkt);
      }
      etappenKarte.appendChild(pfad);
      wurzel.appendChild(etappenKarte);

      // ------------------------------------------------- Hochrechnung
      if (!alleGeschafft) {
        wurzel.appendChild(hochrechnungKarte(bestmarke, etappe.zielCent));
      }
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
