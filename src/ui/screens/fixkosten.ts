/**
 * Screen 3 — Fixkosten. Eigentümer: Agent "UI".
 *
 * Jeder Posten ist eine eigene kleine Karte statt einer Tabellenzeile: bei 390px
 * würde eine Spaltentabelle aus Name, Betrag und Löschknopf den Namen auf ein paar
 * Zeichen zusammenquetschen. Der Name bekommt hier die volle Breite, Betrag und
 * Löschknopf teilen sich die Zeile darunter.
 *
 * Die Summe rechnet live mit — auch während getippt wird, noch bevor der Wert
 * im Store landet.
 */

import { nutzerTextAus } from '../../storage/adapter';
import { formatCent, parseEuroZuCent } from '../../domain/geld';
import type { AppDaten } from '../../domain/types';
import {
  bestaetigen,
  betragFeld,
  el,
  karte,
  knopf,
  leeren,
  meldungszeile,
  symbolKnopf,
  textFeld,
  wertZeile,
} from '../components/basis';
import type { BetragFeld, TextFeld } from '../components/basis';
import type { Screen, UiKontext } from '../kontext';

interface PostenZeile {
  id: string;
  name: TextFeld;
  betrag: BetragFeld;
}

function idsVon(daten: Readonly<AppDaten>): string {
  return daten.fixkosten.map((posten) => posten.id).join('|');
}

export function bauFixkosten(kontext: UiKontext): Screen {
  const store = kontext.store;
  const wurzel = el('div', 'screen-fixkosten');
  const meldung = meldungszeile();

  // ------------------------------------------------------------- Summe
  const summenKarte = karte('Monatliche Verpflichtungen');
  const summenBereich = el('div');
  summenKarte.appendChild(summenBereich);
  wurzel.appendChild(summenKarte);

  // ------------------------------------------------------------- Posten
  const postenKarte = karte('Fixkosten');
  const postenBereich = el('div', 'posten-liste');
  postenKarte.appendChild(postenBereich);
  postenKarte.appendChild(
    knopf('Position hinzufügen', 'knopf-zweit knopf-breit', () => {
      void hinzufuegen();
    }),
  );
  postenKarte.appendChild(meldung.el);
  wurzel.appendChild(postenKarte);

  let zeilen: PostenZeile[] = [];
  let gezeichneteIds = '';

  // ------------------------------------------------------------- Einstellungen
  const weitereKarte = karte('Separat');
  const studiumFeld = betragFeld({
    label: 'Studiengebühren',
    wertCent: store.getDaten().einstellungen.studiumCent,
    hinweis: 'Zählt zu den monatlichen Verpflichtungen, steht aber nicht in der Liste.',
    beiGueltig: (cent) => {
      void store.einstellungenSetzen({ studiumCent: cent });
    },
    beiEingabe: summeZeichnen,
  });
  const einkommenFeld = betragFeld({
    label: 'Netto-Einkommen',
    wertCent: store.getDaten().einstellungen.einkommenCent,
    beiGueltig: (cent) => {
      void store.einstellungenSetzen({ einkommenCent: cent });
    },
    beiEingabe: summeZeichnen,
  });
  weitereKarte.append(studiumFeld.el, einkommenFeld.el);
  wurzel.appendChild(weitereKarte);

  // ------------------------------------------------------------- Rechnen

  /** Aktueller Feldwert, sonst der zuletzt gespeicherte — nie stillschweigend 0. */
  function feldOderGespeichert(feld: BetragFeld, gespeichert: number): number {
    const cent = parseEuroZuCent(feld.input.value);
    return cent === null ? gespeichert : cent;
  }

  function summeFixkosten(): number {
    const daten = store.getDaten();
    let summe = 0;
    for (const zeile of zeilen) {
      const posten = daten.fixkosten.find((p) => p.id === zeile.id);
      summe += feldOderGespeichert(zeile.betrag, posten ? posten.betragCent : 0);
    }
    return summe;
  }

  function summeZeichnen(): void {
    const einstellungen = store.getDaten().einstellungen;
    const fixkosten = summeFixkosten();
    const studium = feldOderGespeichert(studiumFeld, einstellungen.studiumCent);
    const einkommen = feldOderGespeichert(einkommenFeld, einstellungen.einkommenCent);

    leeren(summenBereich);
    summenBereich.appendChild(
      wertZeile(`Fixkosten (${zeilen.length} Posten)`, formatCent(fixkosten)),
    );
    summenBereich.appendChild(wertZeile('Studiengebühren', formatCent(studium)));
    summenBereich.appendChild(
      wertZeile('Gesamt', formatCent(fixkosten + studium), 'wertzeile-stark'),
    );
    summenBereich.appendChild(
      wertZeile(
        'Bleibt vom Einkommen',
        formatCent(einkommen - fixkosten - studium),
        einkommen - fixkosten - studium < 0 ? 'wertzeile-minus' : '',
      ),
    );
  }

  // ------------------------------------------------------------- Liste

  function listeZeichnen(): void {
    const daten = store.getDaten();
    leeren(postenBereich);
    zeilen = [];

    if (daten.fixkosten.length === 0) {
      postenBereich.appendChild(
        el('p', 'leer-hinweis', 'Keine Fixkosten eingetragen. Füge unten deine erste Position hinzu.'),
      );
    }

    for (const posten of daten.fixkosten) {
      const block = el('div', 'posten');

      const name = textFeld({
        label: 'Bezeichnung',
        wert: posten.name,
        platzhalter: 'z. B. Miete',
        beiAenderung: (wert) => {
          void store.fixkostenAendern(posten.id, { name: wert });
        },
      });

      const betrag = betragFeld({
        label: 'Betrag',
        wertCent: posten.betragCent,
        beiGueltig: (cent) => {
          void store.fixkostenAendern(posten.id, { betragCent: cent });
        },
        beiEingabe: summeZeichnen,
      });

      const fuss = el('div', 'posten-fuss');
      fuss.appendChild(betrag.el);
      fuss.appendChild(
        symbolKnopf('×', `${posten.name || 'Position'} löschen`, () => {
          if (!bestaetigen(`"${posten.name || 'Position ohne Namen'}" wirklich löschen?`)) return;
          void store.fixkostenEntfernen(posten.id).catch((fehler: unknown) => {
            meldung.zeigen(nutzerTextAus(fehler), 'fehler');
          });
        }),
      );

      block.append(name.el, fuss);
      postenBereich.appendChild(block);
      zeilen.push({ id: posten.id, name, betrag });
    }

    gezeichneteIds = idsVon(daten);
  }

  async function hinzufuegen(): Promise<void> {
    meldung.leeren();
    try {
      await store.fixkostenHinzufuegen('', 0);
      // Nach dem Neuaufbau steht die neue Zeile hinten — direkt hineinspringen.
      const letzte = zeilen[zeilen.length - 1];
      if (letzte) letzte.name.input.focus();
    } catch (fehler: unknown) {
      meldung.zeigen(nutzerTextAus(fehler), 'fehler');
    }
  }

  listeZeichnen();
  summeZeichnen();

  return {
    el: wurzel,
    aktualisieren(): void {
      // Nur neu bauen, wenn sich die Zusammensetzung geändert hat. Sonst würde ein
      // Speichervorgang mitten im Tippen die Felder unter den Fingern wegziehen.
      if (idsVon(store.getDaten()) !== gezeichneteIds) listeZeichnen();
      summeZeichnen();
    },
  };
}
