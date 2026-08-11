/**
 * Screen 6 — Statistik. Jahresübersicht, Jahresvergleich und Monatsdetails.
 *
 * Bewusst als eigener Screen und nicht als Anhang an die Übersicht: die Übersicht
 * soll die eine Frage „wie stehe ich gerade da?" auf einen Blick beantworten.
 * Auswertungen sind eine andere Absicht und dürfen scrollen.
 *
 * Monatsdetails sind aufklappbare Zeilen statt einer Tabelle — bei 390px würde
 * eine Tabelle mit fünf Spalten jede Zahl auf drei Zeichen quetschen.
 */

import { formatCent } from '../../domain/geld';
import { berechneVerteilung } from '../../domain/verteilung';
import { jahresstatistik, monatsDetails, type MonatsDetail } from '../../domain/statistik';
import { balkenChart } from '../../chart/chart';
import { diagrammEinsetzen, el, karte, leeren, monatName, wertZeile } from '../components/basis';
import type { Screen, UiKontext } from '../kontext';

/** Betrag mit Vorzeichen und passender Farbe — „+250,00 €" liest sich sofort. */
function veraenderungZeile(name: string, cent: number | null): HTMLElement {
  if (cent === null) return wertZeile(name, '—');
  const vorzeichen = cent > 0 ? '+' : '';
  const klasse = cent > 0 ? 'wertzeile-plus' : cent < 0 ? 'wertzeile-minus' : '';
  return wertZeile(name, `${vorzeichen}${formatCent(cent)}`, klasse);
}

export function bauStatistik(kontext: UiKontext): Screen {
  const store = kontext.store;
  const wurzel = el('div', 'screen-statistik');

  const jahresKarte = karte('Pro Jahr');
  const jahresBereich = el('div');
  jahresKarte.appendChild(jahresBereich);
  wurzel.appendChild(jahresKarte);

  const vergleichKarte = karte('Jahresvergleich');
  const vergleichBereich = el('div');
  vergleichKarte.appendChild(vergleichBereich);
  wurzel.appendChild(vergleichKarte);

  const monatsKarte = karte('Pro Monat');
  const monatsBereich = el('div', 'monats-liste');
  monatsKarte.appendChild(monatsBereich);
  wurzel.appendChild(monatsKarte);

  function monatsZeile(detail: MonatsDetail): HTMLElement {
    const aufklapp = el('details', 'aufklapp monats-eintrag');
    const kopf = el('summary', 'monats-kopf');

    kopf.appendChild(
      el('span', 'monats-name', `${monatName(detail.eintrag.monat)} ${detail.eintrag.jahr}`),
    );
    const wert = el(
      'span',
      `monats-wert${
        detail.veraenderungCent === null
          ? ''
          : detail.veraenderungCent > 0
            ? ' monats-plus'
            : detail.veraenderungCent < 0
              ? ' monats-minus'
              : ''
      }`,
      detail.veraenderungCent === null
        ? formatCent(detail.vermoegenCent)
        : `${detail.veraenderungCent > 0 ? '+' : ''}${formatCent(detail.veraenderungCent)}`,
    );
    kopf.appendChild(wert);
    aufklapp.appendChild(kopf);

    const inhalt = el('div', 'monats-inhalt');
    inhalt.appendChild(wertZeile('Vermögen am Monatsende', formatCent(detail.vermoegenCent)));
    inhalt.appendChild(veraenderungZeile('ETF-Depot', detail.etfVeraenderungCent));
    inhalt.appendChild(veraenderungZeile('Tagesgeld', detail.tagesgeldVeraenderungCent));
    if (detail.sondereinnahmeCent !== 0) {
      const notiz = detail.eintrag.sondereinnahmeNotiz;
      inhalt.appendChild(
        wertZeile(notiz ? `Sondereinnahme — ${notiz}` : 'Sondereinnahme', formatCent(detail.sondereinnahmeCent)),
      );
    }
    if (detail.sonderausgabeCent !== 0) {
      const notiz = detail.eintrag.sonderausgabeNotiz;
      inhalt.appendChild(
        wertZeile(notiz ? `Sonderausgabe — ${notiz}` : 'Sonderausgabe', formatCent(detail.sonderausgabeCent)),
      );
    }
    if (detail.quote !== null) {
      inhalt.appendChild(
        wertZeile('Anteil am Monatseinkommen', `${Math.round(detail.quote * 100)} %`),
      );
    }
    aufklapp.appendChild(inhalt);
    return aufklapp;
  }

  function zeichnen(): void {
    const daten = store.getDaten();
    const einkommen = berechneVerteilung(daten).einkommenCent;
    const jahre = jahresstatistik(daten, einkommen);
    const details = monatsDetails(daten, einkommen);

    // ---------------------------------------------------------- Pro Jahr
    leeren(jahresBereich);
    if (jahre.length === 0) {
      jahresBereich.appendChild(
        el('p', 'leer-hinweis', 'Noch keine Monate erfasst. Sobald zwei Monate drin sind, entsteht hier die erste Auswertung.'),
      );
    } else {
      for (const j of jahre) {
        const block = el('div', 'jahr-block');
        block.appendChild(el('h3', 'jahr-titel', String(j.jahr)));
        block.appendChild(
          wertZeile(
            `Zuwachs (${j.anzahlMonate} ${j.anzahlMonate === 1 ? 'Monat' : 'Monate'})`,
            `${j.zuwachsCent > 0 ? '+' : ''}${formatCent(j.zuwachsCent)}`,
            `wertzeile-stark${j.zuwachsCent < 0 ? ' wertzeile-minus' : ''}`,
          ),
        );
        block.appendChild(veraenderungZeile('Schnitt pro Monat', j.schnittProMonatCent));
        if (j.bester) {
          block.appendChild(
            veraenderungZeile(`Bester Monat — ${monatName(j.bester.monat)}`, j.bester.veraenderungCent),
          );
        }
        if (j.schlechtester && j.bester && j.schlechtester.monat !== j.bester.monat) {
          block.appendChild(
            veraenderungZeile(
              `Schwächster Monat — ${monatName(j.schlechtester.monat)}`,
              j.schlechtester.veraenderungCent,
            ),
          );
        }
        if (j.sondereinnahmenCent !== 0) {
          block.appendChild(wertZeile('Sondereinnahmen', formatCent(j.sondereinnahmenCent)));
        }
        if (j.sonderausgabenCent !== 0) {
          block.appendChild(wertZeile('Sonderausgaben', formatCent(j.sonderausgabenCent)));
        }
        block.appendChild(wertZeile('Stand am Jahresende', formatCent(j.endVermoegenCent)));
        jahresBereich.appendChild(block);
      }
    }

    // ---------------------------------------------------- Jahresvergleich
    leeren(vergleichBereich);
    if (jahre.length < 2) {
      vergleichBereich.appendChild(
        el('p', 'leer-hinweis', 'Der Vergleich erscheint, sobald Monate aus mindestens zwei Jahren erfasst sind.'),
      );
    } else {
      diagrammEinsetzen(vergleichBereich, (breite) =>
        balkenChart(
          {
            name: 'Zuwachs pro Jahr',
            farbe: 'var(--etf)',
            punkte: jahre.map((j) => ({ label: String(j.jahr), wertCent: j.zuwachsCent })),
          },
          { breite, hoehe: Math.max(120, jahre.length * 44 + 40) },
        ),
      );
    }

    // --------------------------------------------------------- Pro Monat
    leeren(monatsBereich);
    if (details.length === 0) {
      monatsBereich.appendChild(el('p', 'leer-hinweis', 'Noch keine Monate erfasst.'));
    } else {
      // Neueste zuerst — danach sucht man am ehesten.
      for (const detail of [...details].reverse()) {
        monatsBereich.appendChild(monatsZeile(detail));
      }
    }
  }

  zeichnen();

  return {
    el: wurzel,
    aktualisieren: zeichnen,
  };
}
