/**
 * Screen 2 — Monat erfassen. Eigentümer: Agent "UI".
 *
 * Das ist die Hauptaktion der App und der einzige Screen, der unter Zeitdruck bedient
 * wird. Ziel: unter 15 Sekunden. Deshalb
 *   - Monat/Jahr sind mit dem laufenden Monat vorbelegt (meist kein Antippen nötig),
 *   - genau zwei Pflichtfelder, beide mit Dezimaltastatur und Auto-Markierung beim Fokus,
 *   - Sonderausgabe ist eingeklappt und stört den schnellen Weg nicht,
 *   - der Speichern-Knopf klebt unten im Daumenbereich,
 *   - Anlegen fragt NICHT nach. Nur Löschen fragt nach.
 *
 * Existiert für den gewählten Monat bereits ein Eintrag, wird er geladen und
 * überschrieben statt verdoppelt — das ist gleichzeitig die Editierfunktion.
 */

import { nutzerTextAus } from '../../storage/adapter';
import { formatCent } from '../../domain/geld';
import { sortierteMonate } from '../../domain/etappen';
import type { Monatseintrag } from '../../domain/types';
import {
  MONATSNAMEN,
  bestaetigen,
  betragFeld,
  el,
  karte,
  knopf,
  leeren,
  meldungszeile,
  monatName,
  symbolKnopf,
  textFeld,
} from '../components/basis';
import type { Screen, UiKontext } from '../kontext';

function jahrAuswahl(daten: readonly Monatseintrag[], jetzt: number): number[] {
  let min = jetzt - 2;
  let max = jetzt + 1;
  for (const eintrag of daten) {
    if (Number.isFinite(eintrag.jahr)) {
      min = Math.min(min, eintrag.jahr);
      max = Math.max(max, eintrag.jahr);
    }
  }
  const jahre: number[] = [];
  for (let jahr = min; jahr <= max; jahr++) jahre.push(jahr);
  return jahre;
}

export function bauErfassen(kontext: UiKontext): Screen {
  const store = kontext.store;
  const wurzel = el('div', 'screen-erfassen');
  const heute = new Date();

  let jahr = heute.getFullYear();
  let monat = heute.getMonth() + 1;

  function eintragFuer(gewaehltesJahr: number, gewaehlterMonat: number): Monatseintrag | null {
    const treffer = sortierteMonate(store.getDaten()).filter(
      (m) => m.jahr === gewaehltesJahr && m.monat === gewaehlterMonat,
    );
    return treffer.length > 0 ? (treffer[treffer.length - 1] as Monatseintrag) : null;
  }

  // ------------------------------------------------------------- Monatswahl
  const monatsKarte = karte('Für welchen Monat?');
  const wahlReihe = el('div', 'feld-reihe');

  const monatFeld = el('div', 'feld');
  const monatLabel = el('label', 'feld-label', 'Monat');
  monatLabel.htmlFor = 'wahl-monat';
  const monatWahl = el('select', 'auswahl');
  monatWahl.id = 'wahl-monat';
  MONATSNAMEN.forEach((name, i) => {
    const option = el('option', undefined, name);
    option.value = String(i + 1);
    monatWahl.appendChild(option);
  });
  monatWahl.value = String(monat);
  monatFeld.append(monatLabel, monatWahl);

  const jahrFeld = el('div', 'feld');
  const jahrLabel = el('label', 'feld-label', 'Jahr');
  jahrLabel.htmlFor = 'wahl-jahr';
  const jahrWahl = el('select', 'auswahl');
  jahrWahl.id = 'wahl-jahr';
  for (const wert of jahrAuswahl(store.getDaten().monate, jahr)) {
    const option = el('option', undefined, String(wert));
    option.value = String(wert);
    jahrWahl.appendChild(option);
  }
  jahrWahl.value = String(jahr);
  jahrFeld.append(jahrLabel, jahrWahl);

  wahlReihe.append(monatFeld, jahrFeld);
  monatsKarte.appendChild(wahlReihe);
  const monatsHinweis = el('p', 'feld-hinweis');
  monatsKarte.appendChild(monatsHinweis);
  wurzel.appendChild(monatsKarte);

  // ------------------------------------------------------------- Beträge
  const werteKarte = karte('Stände');
  const etfFeld = betragFeld({
    label: 'ETF-Depotwert (Trade Republic)',
    wertCent: 0,
  });
  const tagesgeldFeld = betragFeld({
    label: 'Tagesgeld gesamt',
    wertCent: 0,
  });
  werteKarte.append(etfFeld.el, tagesgeldFeld.el);

  const aufklapp = el('details', 'aufklapp');
  const zusammenfassung = el('summary', 'aufklapp-titel', 'Sonderausgabe (optional)');
  aufklapp.appendChild(zusammenfassung);
  const sonderFeld = betragFeld({ label: 'Betrag', wertCent: 0 });
  const notizFeld = textFeld({
    label: 'Wofür?',
    wert: '',
    platzhalter: 'z. B. Reparatur',
  });
  aufklapp.append(sonderFeld.el, notizFeld.el);
  werteKarte.appendChild(aufklapp);
  wurzel.appendChild(werteKarte);

  // ------------------------------------------------------------- Aktionen
  const meldung = meldungszeile();
  const speichernKnopf = knopf('Speichern', 'knopf-haupt', () => {
    void speichern();
  });

  const loeschZeile = el('div', 'knopf-reihe');
  loeschZeile.appendChild(
    knopf('Diesen Monat löschen', 'knopf-gefahr', () => {
      void loeschen();
    }),
  );
  wurzel.appendChild(loeschZeile);

  // ------------------------------------------------------------- Liste
  const listenKarte = karte('Erfasste Monate');
  const liste = el('ul', 'liste');
  listenKarte.appendChild(liste);
  wurzel.appendChild(listenKarte);

  // Ganz am Ende im DOM, damit `position: sticky` den Knopf über die ganze Seite
  // hinweg unten festhält — ein sticky-Element klebt nur, solange sein natürlicher
  // Platz weiter unten liegt. Optisch bleibt er dadurch immer im Daumenbereich.
  const aktionen = el('div', 'aktionsleiste');
  aktionen.appendChild(speichernKnopf);
  aktionen.appendChild(meldung.el);
  wurzel.appendChild(aktionen);

  // ------------------------------------------------------------- Verhalten

  /** Lädt die Werte des gewählten Monats ins Formular (oder leert es). */
  function formularLaden(): void {
    const eintrag = eintragFuer(jahr, monat);
    etfFeld.setzen(eintrag ? eintrag.etfDepotCent : 0);
    tagesgeldFeld.setzen(eintrag ? eintrag.tagesgeldCent : 0);

    const hatSonder =
      eintrag !== null &&
      ((typeof eintrag.sonderausgabeCent === 'number' && eintrag.sonderausgabeCent !== 0) ||
        (typeof eintrag.sonderausgabeNotiz === 'string' && eintrag.sonderausgabeNotiz !== ''));
    sonderFeld.setzen(eintrag && typeof eintrag.sonderausgabeCent === 'number' ? eintrag.sonderausgabeCent : 0);
    notizFeld.setzen(eintrag && typeof eintrag.sonderausgabeNotiz === 'string' ? eintrag.sonderausgabeNotiz : '');
    aufklapp.open = hatSonder;

    meldung.leeren();
    zustandZeichnen();
  }

  /** Aktualisiert alles, was von "gibt es diesen Monat schon?" abhängt. */
  function zustandZeichnen(): void {
    const eintrag = eintragFuer(jahr, monat);
    speichernKnopf.textContent = eintrag ? 'Änderung speichern' : 'Speichern';
    loeschZeile.hidden = eintrag === null;
    monatsHinweis.textContent = eintrag
      ? `Für ${monatName(monat)} ${jahr} gibt es bereits einen Eintrag. Speichern überschreibt ihn.`
      : `Neuer Eintrag für ${monatName(monat)} ${jahr}.`;
    listeZeichnen();
  }

  function listeZeichnen(): void {
    leeren(liste);
    const monate = sortierteMonate(store.getDaten()).slice().reverse();

    if (monate.length === 0) {
      const leerZeile = el('li');
      leerZeile.appendChild(el('p', 'leer-hinweis', 'Noch nichts erfasst.'));
      liste.appendChild(leerZeile);
      return;
    }

    for (const eintrag of monate) {
      const zeile = el('li', 'listen-eintrag');

      const auswahl = el('button', 'listen-knopf');
      auswahl.type = 'button';
      auswahl.appendChild(
        el('span', 'listen-name', `${monatName(eintrag.monat)} ${eintrag.jahr}`),
      );
      auswahl.appendChild(
        el(
          'span',
          'listen-unter',
          `ETF ${formatCent(eintrag.etfDepotCent)} · Tagesgeld ${formatCent(eintrag.tagesgeldCent)}`,
        ),
      );
      if (typeof eintrag.sonderausgabeCent === 'number' && eintrag.sonderausgabeCent !== 0) {
        const notiz = eintrag.sonderausgabeNotiz;
        const zusatz = el('span', 'listen-unter');
        // textContent, weil die Notiz Nutzereingabe ist.
        zusatz.textContent =
          `Sonderausgabe ${formatCent(eintrag.sonderausgabeCent)}` +
          (typeof notiz === 'string' && notiz !== '' ? ` · ${notiz}` : '');
        auswahl.appendChild(zusatz);
      }
      auswahl.addEventListener('click', () => {
        jahr = eintrag.jahr;
        monat = eintrag.monat;
        monatWahl.value = String(monat);
        if (jahrWahl.value !== String(jahr)) {
          // Jahr liegt außerhalb der aufgebauten Liste (importierte Daten) → nachtragen.
          const option = el('option', undefined, String(jahr));
          option.value = String(jahr);
          jahrWahl.appendChild(option);
          jahrWahl.value = String(jahr);
        }
        formularLaden();
        window.scrollTo(0, 0);
      });

      const entfernen = symbolKnopf(
        '×',
        `Eintrag ${monatName(eintrag.monat)} ${eintrag.jahr} löschen`,
        () => {
          if (!bestaetigen(`Eintrag für ${monatName(eintrag.monat)} ${eintrag.jahr} löschen?`)) return;
          void store.monatEntfernen(eintrag.id).catch((fehler: unknown) => {
            meldung.zeigen(nutzerTextAus(fehler), 'fehler');
          });
        },
      );

      zeile.append(auswahl, entfernen);
      liste.appendChild(zeile);
    }
  }

  async function speichern(): Promise<void> {
    const etfCent = etfFeld.lesen();
    const tagesgeldCent = tagesgeldFeld.lesen();
    if (etfCent === null || tagesgeldCent === null) {
      meldung.zeigen('Bitte prüfe die rot markierten Beträge.', 'fehler');
      return;
    }

    let sonderausgabeCent: number | undefined;
    let sonderausgabeNotiz: string | undefined;
    if (aufklapp.open) {
      const sonderCent = sonderFeld.lesen();
      if (sonderCent === null) {
        meldung.zeigen('Bitte prüfe den Betrag der Sonderausgabe.', 'fehler');
        return;
      }
      const notiz = notizFeld.lesen();
      if (sonderCent !== 0 || notiz !== '') {
        sonderausgabeCent = sonderCent;
        sonderausgabeNotiz = notiz === '' ? undefined : notiz;
      }
    }

    const vorhanden = eintragFuer(jahr, monat);
    try {
      if (vorhanden) {
        await store.monatAendern(vorhanden.id, {
          jahr,
          monat,
          etfDepotCent: etfCent,
          tagesgeldCent,
          sonderausgabeCent,
          sonderausgabeNotiz,
        });
      } else {
        await store.monatHinzufuegen({
          jahr,
          monat,
          etfDepotCent: etfCent,
          tagesgeldCent,
          sonderausgabeCent,
          sonderausgabeNotiz,
        });
      }
      meldung.zeigen(`${monatName(monat)} ${jahr} gespeichert.`);
    } catch (fehler: unknown) {
      meldung.zeigen(nutzerTextAus(fehler), 'fehler');
    }
  }

  async function loeschen(): Promise<void> {
    const eintrag = eintragFuer(jahr, monat);
    if (!eintrag) return;
    if (!bestaetigen(`Eintrag für ${monatName(monat)} ${jahr} löschen?`)) return;
    try {
      await store.monatEntfernen(eintrag.id);
      formularLaden();
      meldung.zeigen('Eintrag gelöscht.');
    } catch (fehler: unknown) {
      meldung.zeigen(nutzerTextAus(fehler), 'fehler');
    }
  }

  monatWahl.addEventListener('change', () => {
    monat = Number(monatWahl.value);
    formularLaden();
  });
  jahrWahl.addEventListener('change', () => {
    jahr = Number(jahrWahl.value);
    formularLaden();
  });

  formularLaden();

  return {
    el: wurzel,
    // Achtung: NUR abgeleitete Anzeigen auffrischen. Die Eingabefelder gehören dem
    // Nutzer, solange er auf dem Screen ist — sie werden hier nicht überschrieben.
    aktualisieren: zustandZeichnen,
  };
}
