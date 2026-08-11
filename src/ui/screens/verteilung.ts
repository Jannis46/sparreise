/**
 * Screen 4 — Verteilung. Eigentümer: Agent "UI".
 *
 * Rechnet bei jeder Tasteneingabe neu, nicht erst beim Verlassen des Feldes: die
 * Frage „was bleibt übrig, wenn ich das Freizeitbudget erhöhe" soll man beim Tippen
 * beantwortet sehen. In den Store geschrieben wird trotzdem erst beim Verlassen des
 * Feldes und nur mit einem lesbaren Wert.
 */

import { formatCent, parseEuroZuCent } from '../../domain/geld';
import { berechneVerteilung } from '../../domain/verteilung';
import type { Verteilung } from '../../domain/verteilung';
import { balkenChart } from '../../chart/chart';
import { betragFeld, diagrammEinsetzen, el, karte, leeren, wertZeile } from '../components/basis';
import type { BetragFeld } from '../components/basis';
import type { Screen, UiKontext } from '../kontext';

export function bauVerteilung(kontext: UiKontext): Screen {
  const store = kontext.store;
  const wurzel = el('div', 'screen-verteilung');

  const warnBereich = el('div', 'warn-bereich');
  wurzel.appendChild(warnBereich);

  const ergebnisKarte = karte('Monatlich');
  const ergebnisBereich = el('div');
  ergebnisKarte.appendChild(ergebnisBereich);
  wurzel.appendChild(ergebnisKarte);

  const diagrammKarte = karte('Wohin das Einkommen geht');
  const diagrammBereich = el('div', 'diagramm');
  diagrammKarte.appendChild(diagrammBereich);
  wurzel.appendChild(diagrammKarte);

  const stellKarte = karte('Stellschrauben');
  const einstellungen = store.getDaten().einstellungen;

  const freizeitFeld = betragFeld({
    label: 'Freizeit-Budget',
    wertCent: einstellungen.freizeitCent,
    beiGueltig: (cent) => {
      void store.einstellungenSetzen({ freizeitCent: cent });
    },
    beiEingabe: zeichnen,
  });
  const etfZusatzFeld = betragFeld({
    label: 'ETF zusätzlich',
    wertCent: einstellungen.etfZusatzCent,
    beiGueltig: (cent) => {
      void store.einstellungenSetzen({ etfZusatzCent: cent });
    },
    beiEingabe: zeichnen,
  });
  const etfInFixFeld = betragFeld({
    label: 'ETF-Anteil, der schon in den Fixkosten steckt',
    wertCent: einstellungen.etfInFixkostenCent,
    hinweis: 'Wird nicht doppelt abgezogen — zählt nur zur Gesamt-ETF-Sparrate dazu.',
    beiGueltig: (cent) => {
      void store.einstellungenSetzen({ etfInFixkostenCent: cent });
    },
    beiEingabe: zeichnen,
  });

  stellKarte.append(freizeitFeld.el, etfZusatzFeld.el, etfInFixFeld.el);
  wurzel.appendChild(stellKarte);

  function feldOderGespeichert(feld: BetragFeld, gespeichert: number): number {
    const cent = parseEuroZuCent(feld.input.value);
    return cent === null ? gespeichert : cent;
  }

  /** Verteilung auf Basis der aktuell im Feld stehenden Werte (Live-Vorschau). */
  function aktuelleVerteilung(): Verteilung {
    const daten = store.getDaten();
    const gespeichert = daten.einstellungen;
    return berechneVerteilung({
      ...daten,
      einstellungen: {
        ...gespeichert,
        freizeitCent: feldOderGespeichert(freizeitFeld, gespeichert.freizeitCent),
        etfZusatzCent: feldOderGespeichert(etfZusatzFeld, gespeichert.etfZusatzCent),
        etfInFixkostenCent: feldOderGespeichert(etfInFixFeld, gespeichert.etfInFixkostenCent),
      },
    });
  }

  function zeichnen(): void {
    const verteilung = aktuelleVerteilung();
    const verfuegbarCent = verteilung.verfuegbarCent;

    leeren(warnBereich);
    if (verteilung.unterdeckung) {
      const box = el('div', 'banner');
      box.setAttribute('role', 'alert');
      box.appendChild(el('strong', 'banner-titel', 'Unterdeckung'));
      box.appendChild(
        el(
          'span',
          'banner-text',
          `Freizeit und ETF-Zusatz übersteigen das Verfügbare um ${formatCent(
            Math.abs(verteilung.uebrigCent),
          )}. Fürs Tagesgeld bleibt nichts übrig.`,
        ),
      );
      warnBereich.appendChild(box);
    }

    leeren(ergebnisBereich);
    ergebnisBereich.appendChild(wertZeile('Netto-Einkommen', formatCent(verteilung.einkommenCent)));
    ergebnisBereich.appendChild(wertZeile('− Fixkosten', formatCent(verteilung.fixkostenCent)));
    ergebnisBereich.appendChild(wertZeile('− Studiengebühren', formatCent(verteilung.studiumCent)));
    ergebnisBereich.appendChild(
      wertZeile(
        'Verfügbar',
        formatCent(verfuegbarCent),
        `wertzeile-stark${verfuegbarCent < 0 ? ' wertzeile-minus' : ''}`,
      ),
    );
    ergebnisBereich.appendChild(wertZeile('Freizeit-Budget', formatCent(verteilung.freizeitCent)));
    ergebnisBereich.appendChild(wertZeile('ETF zusätzlich', formatCent(verteilung.etfZusatzCent)));
    ergebnisBereich.appendChild(
      wertZeile(
        'Tagesgeld (Rest)',
        formatCent(verteilung.uebrigCent),
        `wertzeile-stark${verteilung.unterdeckung ? ' wertzeile-minus' : ''}`,
      ),
    );
    ergebnisBereich.appendChild(
      wertZeile('Gesamt-ETF-Sparrate', formatCent(verteilung.etfGesamtCent), 'wertzeile-stark'),
    );

    diagrammEinsetzen(diagrammBereich, (breite) =>
      balkenChart(
        {
          name: 'Verteilung des Nettoeinkommens',
          farbe: 'var(--akzent)',
          punkte: [
            { label: 'Fixkosten', wertCent: verteilung.fixkostenCent },
            { label: 'Studium', wertCent: verteilung.studiumCent },
            { label: 'Freizeit', wertCent: verteilung.freizeitCent },
            { label: 'ETF zusätzlich', wertCent: verteilung.etfZusatzCent },
            { label: 'Tagesgeld', wertCent: verteilung.uebrigCent },
          ],
        },
        { breite, hoehe: 214 },
      ),
    );
  }

  zeichnen();

  return {
    el: wurzel,
    aktualisieren: zeichnen,
  };
}
