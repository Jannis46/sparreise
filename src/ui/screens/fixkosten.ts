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
import { kreditstand } from '../../domain/kredit';
import type { AppDaten, Fixkostenposten } from '../../domain/types';
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
  weitereKarte.append(einkommenFeld.el, studiumFeld.el);
  wurzel.appendChild(weitereKarte);

  // ------------------------------------------------------------- Weitere Einnahmen
  const einnahmenKarte = karte('Weitere Einnahmen');
  einnahmenKarte.appendChild(
    el(
      'p',
      'hinweis',
      'Feste monatliche Einnahmen neben dem Gehalt — Nebenjob, Kindergeld, BAföG. Erhöhen das Verfügbare.',
    ),
  );
  const einnahmenBereich = el('div', 'posten-liste');
  einnahmenKarte.appendChild(einnahmenBereich);
  einnahmenKarte.appendChild(
    knopf('Einnahme hinzufügen', 'knopf-zweit knopf-breit', () => {
      void store.einnahmeHinzufuegen('', 0).catch((fehler: unknown) => {
        meldung.zeigen(nutzerTextAus(fehler), 'fehler');
      });
    }),
  );
  wurzel.appendChild(einnahmenKarte);

  let einnahmeZeilen: PostenZeile[] = [];
  let gezeichneteEinnahmeIds = '';

  // ------------------------------------------------------------- Invest
  const investKarte = karte('Invest');
  investKarte.appendChild(
    el(
      'p',
      'hinweis',
      'Was monatlich angelegt wird. Steht bewusst nicht bei den Fixkosten — das ist keine Ausgabe, sondern verschobenes Vermögen.',
    ),
  );
  const investBereich = el('div', 'posten-liste');
  investKarte.appendChild(investBereich);
  const investSumme = el('div', 'invest-summe');
  investKarte.appendChild(investSumme);
  investKarte.appendChild(
    knopf('Anlage hinzufügen', 'knopf-zweit knopf-breit', () => {
      void store.investHinzufuegen('', 0).catch((fehler: unknown) => {
        meldung.zeigen(nutzerTextAus(fehler), 'fehler');
      });
    }),
  );
  wurzel.appendChild(investKarte);

  let investZeilen: PostenZeile[] = [];
  let gezeichneteInvestIds = '';

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

  function summeEinnahmen(): number {
    const daten = store.getDaten();
    const liste = Array.isArray(daten.einnahmen) ? daten.einnahmen : [];
    let summe = 0;
    for (const zeile of einnahmeZeilen) {
      const posten = liste.find((p) => p.id === zeile.id);
      summe += feldOderGespeichert(zeile.betrag, posten ? posten.betragCent : 0);
    }
    return summe;
  }

  function summeZeichnen(): void {
    const einstellungen = store.getDaten().einstellungen;
    const fixkosten = summeFixkosten();
    const studium = feldOderGespeichert(studiumFeld, einstellungen.studiumCent);
    const gehalt = feldOderGespeichert(einkommenFeld, einstellungen.einkommenCent);
    const weitere = summeEinnahmen();
    const einkommen = gehalt + weitere;
    const bleibt = einkommen - fixkosten - studium;
    const invest = summeInvest();

    leeren(investSumme);
    investSumme.appendChild(
      wertZeile(`Anlage pro Monat (${investZeilen.length})`, formatCent(invest), 'wertzeile-stark'),
    );
    if (einkommen > 0) {
      investSumme.appendChild(
        wertZeile('Anteil am Einkommen', `${Math.round((invest / einkommen) * 100)} %`),
      );
    }

    leeren(summenBereich);
    summenBereich.appendChild(wertZeile('Netto-Einkommen', formatCent(gehalt)));
    if (weitere !== 0) {
      summenBereich.appendChild(
        wertZeile(`Weitere Einnahmen (${einnahmeZeilen.length})`, formatCent(weitere)),
      );
      summenBereich.appendChild(
        wertZeile('Einnahmen gesamt', formatCent(einkommen), 'wertzeile-stark'),
      );
    }
    summenBereich.appendChild(
      wertZeile(`− Fixkosten (${zeilen.length} Posten)`, formatCent(fixkosten)),
    );
    summenBereich.appendChild(wertZeile('− Studiengebühren', formatCent(studium)));
    summenBereich.appendChild(
      wertZeile('Bleibt übrig', formatCent(bleibt), `wertzeile-stark${bleibt < 0 ? ' wertzeile-minus' : ''}`),
    );
  }

  // ------------------------------------------------------------- Kredit

  const MONATSNAMEN = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
  ];

  /**
   * Kreditbereich eines Postens: Restschuld, verbleibende Raten, voraussichtliches
   * Ende — und ein Feld zum Durchspielen einer Sondertilgung.
   *
   * Der eingetippte Betrag rechnet sofort durch, wird aber erst beim Speichern
   * übernommen. So kann man gefahrlos ausprobieren, ohne den echten Stand zu ändern.
   */
  function kreditBlock(posten: Readonly<Fixkostenposten>): HTMLElement {
    const jetzt = new Date();
    const heuteJahr = jetzt.getFullYear();
    const heuteMonat = jetzt.getMonth() + 1;

    const aufklapp = el('details', 'aufklapp kredit-block');
    const titel = el('summary', 'aufklapp-titel', 'Kredit & Sondertilgung');
    aufklapp.appendChild(titel);

    const anzeige = el('div', 'kredit-anzeige');
    aufklapp.appendChild(anzeige);

    // Probewert: undefined = gespeicherten Stand zeigen.
    let probeCent: number | undefined;

    // Rohtext statt `lesen()`: `lesen()` würde das Feld schon beim Tippen als
    // fehlerhaft markieren, solange die Eingabe noch unvollständig ist ("1,").
    const rohWert = (): string => probeFeld.el.querySelector('input')?.value ?? '';

    const probeFeld: BetragFeld = betragFeld({
      label: 'Sondertilgung durchspielen',
      wertCent: posten.kredit?.sondertilgungCent ?? 0,
      hinweis: 'Betrag eintippen — die Rechnung darunter aktualisiert sich sofort. Erst „Übernehmen" speichert.',
      beiEingabe: () => {
        const cent = parseEuroZuCent(rohWert());
        probeCent = cent === null ? undefined : Math.max(0, cent);
        zeichnen();
      },
      beiGueltig: () => {
        /* Übernahme läuft bewusst nur über den Knopf. */
      },
    });
    aufklapp.appendChild(probeFeld.el);

    aufklapp.appendChild(
      knopf('Sondertilgung übernehmen', 'knopf-zweit knopf-breit', () => {
        const cent = parseEuroZuCent(rohWert());
        if (cent === null) {
          meldung.zeigen('Bitte einen gültigen Betrag eintragen.', 'fehler');
          return;
        }
        const alt = posten.kredit;
        if (!alt) return;
        void store
          .fixkostenAendern(posten.id, {
            kredit: { ...alt, sondertilgungCent: Math.max(0, cent) },
          })
          .then(() => meldung.zeigen('Sondertilgung gespeichert.'))
          .catch((fehler: unknown) => meldung.zeigen(nutzerTextAus(fehler), 'fehler'));
      }),
    );

    function zeichnen(): void {
      leeren(anzeige);
      const stand = kreditstand(posten, heuteJahr, heuteMonat, probeCent);
      if (!stand) {
        anzeige.appendChild(el('p', 'hinweis', 'Keine gültigen Kreditangaben hinterlegt.'));
        return;
      }

      const k = posten.kredit!;
      anzeige.appendChild(
        el(
          'p',
          'hinweis',
          `${k.laufzeitMonate} Raten ab ${MONATSNAMEN[k.startMonat - 1]} ${k.startJahr} · ` +
            `Gesamtsumme ${formatCent(stand.gesamtCent)} (zinsfrei gerechnet)`,
        ),
      );

      if (stand.abbezahlt) {
        anzeige.appendChild(wertZeile('Restschuld', formatCent(0), 'wertzeile-stark'));
        anzeige.appendChild(el('p', 'hinweis', 'Vollständig getilgt.'));
        return;
      }

      anzeige.appendChild(
        wertZeile(
          stand.nochNichtGestartet ? 'Noch nicht begonnen — offen' : 'Restschuld',
          formatCent(stand.restschuldCent),
          'wertzeile-stark',
        ),
      );
      anzeige.appendChild(
        wertZeile(`Gezahlte Raten (${stand.gezahlteRaten})`, formatCent(stand.gezahltCent)),
      );
      if (stand.sondertilgungCent > 0) {
        anzeige.appendChild(wertZeile('Sondertilgung', formatCent(stand.sondertilgungCent)));
      }
      anzeige.appendChild(
        wertZeile(
          'Verbleibende Raten',
          stand.letzteRateCent > 0 && stand.letzteRateCent !== Math.abs(posten.betragCent)
            ? `${stand.verbleibendeRaten} (letzte ${formatCent(stand.letzteRateCent)})`
            : String(stand.verbleibendeRaten),
        ),
      );
      if (stand.endeJahr !== null && stand.endeMonat !== null) {
        anzeige.appendChild(
          wertZeile('Voraussichtlich fertig', `${MONATSNAMEN[stand.endeMonat - 1]} ${stand.endeJahr}`),
        );
      }
      if (stand.ersparteMonate > 0) {
        anzeige.appendChild(
          el(
            'p',
            'kredit-ersparnis',
            `${stand.ersparteMonate} ${stand.ersparteMonate === 1 ? 'Monat' : 'Monate'} früher fertig — ` +
              `danach bleiben ${formatCent(Math.abs(posten.betragCent))} pro Monat mehr übrig.`,
          ),
        );
      }
    }

    zeichnen();
    return aufklapp;
  }

  // ------------------------------------------------------------- Invest-Liste

  function summeInvest(): number {
    const daten = store.getDaten();
    const liste = Array.isArray(daten.invest) ? daten.invest : [];
    let summe = 0;
    for (const zeile of investZeilen) {
      const posten = liste.find((p) => p.id === zeile.id);
      summe += feldOderGespeichert(zeile.betrag, posten ? posten.betragCent : 0);
    }
    return summe;
  }

  function investZeichnen(): void {
    const daten = store.getDaten();
    const liste = Array.isArray(daten.invest) ? daten.invest : [];
    leeren(investBereich);
    investZeilen = [];

    if (liste.length === 0) {
      investBereich.appendChild(
        el('p', 'leer-hinweis', 'Keine Anlage eingetragen. Alles Übrige geht aufs Tagesgeld.'),
      );
    }

    for (const posten of liste) {
      const block = el('div', 'posten');

      const name = textFeld({
        label: 'Bezeichnung',
        wert: posten.name,
        platzhalter: 'z. B. ETF-Sparplan',
        beiAenderung: (wert) => {
          void store.investAendern(posten.id, { name: wert });
        },
      });

      const betrag = betragFeld({
        label: 'Betrag pro Monat',
        wertCent: posten.betragCent,
        beiGueltig: (cent) => {
          void store.investAendern(posten.id, { betragCent: cent });
        },
        beiEingabe: summeZeichnen,
      });

      const fuss = el('div', 'posten-fuss');
      fuss.appendChild(betrag.el);
      fuss.appendChild(
        symbolKnopf('×', `${posten.name || 'Anlage'} löschen`, () => {
          if (!bestaetigen(`"${posten.name || 'Anlage ohne Namen'}" wirklich löschen?`)) return;
          void store.investEntfernen(posten.id).catch((fehler: unknown) => {
            meldung.zeigen(nutzerTextAus(fehler), 'fehler');
          });
        }),
      );

      block.append(name.el, fuss);
      investBereich.appendChild(block);
      investZeilen.push({ id: posten.id, name, betrag });
    }
  }

  // ------------------------------------------------------------- Einnahmen-Liste

  function einnahmenZeichnen(): void {
    const daten = store.getDaten();
    const liste = Array.isArray(daten.einnahmen) ? daten.einnahmen : [];
    leeren(einnahmenBereich);
    einnahmeZeilen = [];

    if (liste.length === 0) {
      einnahmenBereich.appendChild(
        el('p', 'leer-hinweis', 'Keine weiteren Einnahmen. Nur das Netto-Einkommen zählt.'),
      );
      return;
    }

    for (const posten of liste) {
      const block = el('div', 'posten');

      const name = textFeld({
        label: 'Bezeichnung',
        wert: posten.name,
        platzhalter: 'z. B. Nebenjob',
        beiAenderung: (wert) => {
          void store.einnahmeAendern(posten.id, { name: wert });
        },
      });

      const betrag = betragFeld({
        label: 'Betrag pro Monat',
        wertCent: posten.betragCent,
        beiGueltig: (cent) => {
          void store.einnahmeAendern(posten.id, { betragCent: cent });
        },
        beiEingabe: summeZeichnen,
      });

      const fuss = el('div', 'posten-fuss');
      fuss.appendChild(betrag.el);
      fuss.appendChild(
        symbolKnopf('×', `${posten.name || 'Einnahme'} löschen`, () => {
          if (!bestaetigen(`"${posten.name || 'Einnahme ohne Namen'}" wirklich löschen?`)) return;
          void store.einnahmeEntfernen(posten.id).catch((fehler: unknown) => {
            meldung.zeigen(nutzerTextAus(fehler), 'fehler');
          });
        }),
      );

      block.append(name.el, fuss);
      einnahmenBereich.appendChild(block);
      einnahmeZeilen.push({ id: posten.id, name, betrag });
    }
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
      if (posten.kredit) block.appendChild(kreditBlock(posten));
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
  einnahmenZeichnen();
  investZeichnen();
  summeZeichnen();

  return {
    el: wurzel,
    aktualisieren(): void {
      // Nur neu bauen, wenn sich die Zusammensetzung geändert hat. Sonst würde ein
      // Speichervorgang mitten im Tippen die Felder unter den Fingern wegziehen.
      const daten = store.getDaten();
      if (idsVon(daten) !== gezeichneteIds) listeZeichnen();
      const einnahmeIds = (Array.isArray(daten.einnahmen) ? daten.einnahmen : [])
        .map((p) => p.id)
        .join('|');
      if (einnahmeIds !== gezeichneteEinnahmeIds) {
        einnahmenZeichnen();
        gezeichneteEinnahmeIds = einnahmeIds;
      }
      const investIds = (Array.isArray(daten.invest) ? daten.invest : [])
        .map((p) => p.id)
        .join('|');
      if (investIds !== gezeichneteInvestIds) {
        investZeichnen();
        gezeichneteInvestIds = investIds;
      }
      summeZeichnen();
    },
  };
}
