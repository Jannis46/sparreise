/**
 * Screen 5 — Daten & Sicherung. Eigentümer: Agent "UI".
 *
 * Ohne Server ist die Exportdatei die einzige Sicherung, die es gibt. Das steht hier
 * auch so da — und zwar bevor der Nutzer es schmerzhaft lernt.
 */

import { TIER_TEXT, nutzerTextAus } from '../../storage/adapter';
import { exportDateiname, exportierenAlsJson, importierenAusJson } from '../../storage/portable';
import { startDaten } from '../../domain/types';
import { el, bestaetigen, karte, knopf, leeren, meldungszeile } from '../components/basis';
import type { Screen, UiKontext } from '../kontext';

export function bauDaten(kontext: UiKontext): Screen {
  const store = kontext.store;
  const wurzel = el('div', 'screen-daten');
  const meldung = meldungszeile();

  // ------------------------------------------------------------- Status
  const statusKarte = karte('Speicherstand');
  const statusBereich = el('div');
  statusKarte.appendChild(statusBereich);
  wurzel.appendChild(statusKarte);

  // ------------------------------------------------------------- Export
  const exportKarte = karte('Sichern');
  exportKarte.appendChild(
    el(
      'p',
      'hinweis',
      'Sparreise speichert ausschließlich auf diesem Gerät. Es gibt keine Kopie in einer Cloud. ' +
        'Exportiere deine Daten regelmäßig — diese Datei ist dein Backup.',
    ),
  );
  exportKarte.appendChild(
    knopf('Daten exportieren', 'knopf-haupt', () => {
      exportieren();
    }),
  );
  wurzel.appendChild(exportKarte);

  // ------------------------------------------------------------- Import
  const importKarte = karte('Wiederherstellen');
  importKarte.appendChild(
    el(
      'p',
      'hinweis',
      'Eine zuvor exportierte Datei einlesen. Das ersetzt alle Daten, die jetzt in Sparreise stehen.',
    ),
  );
  // Das native Dateifeld ist nur ~24px hoch und damit als Touch-Ziel unbrauchbar.
  // Deshalb: Eingabefeld unsichtbar (aber fokussierbar), Label als vollwertiger Knopf.
  const dateiFeld = el('input', 'datei-versteckt');
  dateiFeld.type = 'file';
  dateiFeld.id = 'datei-import';
  dateiFeld.accept = 'application/json,.json';
  dateiFeld.addEventListener('change', () => {
    void importieren();
  });
  const dateiLabel = el('label', 'knopf-zweit knopf-breit datei-knopf', 'Sicherungsdatei auswählen');
  dateiLabel.htmlFor = 'datei-import';
  dateiLabel.appendChild(dateiFeld);
  importKarte.appendChild(dateiLabel);
  wurzel.appendChild(importKarte);

  // ------------------------------------------------------------- Zurücksetzen
  const resetKarte = karte('Zurücksetzen');
  resetKarte.appendChild(
    el(
      'p',
      'hinweis',
      'Löscht alle erfassten Monate und stellt die Startwerte der Fixkosten wieder her. ' +
        'Das lässt sich nicht rückgängig machen — vorher exportieren.',
    ),
  );
  resetKarte.appendChild(
    knopf('Alles zurücksetzen', 'knopf-gefahr knopf-breit', () => {
      void zuruecksetzen();
    }),
  );
  resetKarte.appendChild(meldung.el);
  wurzel.appendChild(resetKarte);

  // ------------------------------------------------------------- Aktionen

  function exportieren(): void {
    meldung.leeren();
    let url: string | null = null;
    try {
      const json = exportierenAlsJson(store.getDaten());
      const blob = new Blob([json], { type: 'application/json' });
      url = URL.createObjectURL(blob);
      const link = el('a');
      link.href = url;
      link.download = exportDateiname();
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      meldung.zeigen('Export gestartet. Sichere die Datei außerhalb dieses Geräts.');
    } catch (fehler: unknown) {
      meldung.zeigen(`Export fehlgeschlagen: ${nutzerTextAus(fehler)}`, 'fehler');
    } finally {
      if (url !== null) {
        const freigeben = url;
        // Erst freigeben, wenn der Download angestoßen ist.
        window.setTimeout(() => URL.revokeObjectURL(freigeben), 10000);
      }
    }
  }

  async function importieren(): Promise<void> {
    meldung.leeren();
    const dateien = dateiFeld.files;
    const datei = dateien && dateien.length > 0 ? dateien[0] : null;
    if (!datei) return;

    try {
      const text = await datei.text();
      const daten = importierenAusJson(text);
      const anzahl = Array.isArray(daten.monate) ? daten.monate.length : 0;
      if (
        !bestaetigen(
          `Datei gelesen: ${anzahl} erfasste Monate. Der Import ersetzt ALLE aktuellen Daten. Fortfahren?`,
        )
      ) {
        meldung.zeigen('Import abgebrochen. Es wurde nichts geändert.');
        return;
      }
      await store.ersetzen(daten);
      meldung.zeigen('Import erfolgreich.');
    } catch (fehler: unknown) {
      meldung.zeigen(`Import fehlgeschlagen: ${nutzerTextAus(fehler)}`, 'fehler');
    } finally {
      // Zurücksetzen, damit dieselbe Datei erneut gewählt werden kann.
      dateiFeld.value = '';
    }
  }

  async function zuruecksetzen(): Promise<void> {
    meldung.leeren();
    if (
      !bestaetigen(
        'Wirklich alles zurücksetzen? Alle erfassten Monate werden gelöscht. Das kann nicht rückgängig gemacht werden.',
      )
    ) {
      return;
    }
    try {
      await store.ersetzen(startDaten());
      meldung.zeigen('Sparreise wurde zurückgesetzt.');
    } catch (fehler: unknown) {
      meldung.zeigen(`Zurücksetzen fehlgeschlagen: ${nutzerTextAus(fehler)}`, 'fehler');
    }
  }

  function statusZeichnen(): void {
    const status = store.getStatus();
    const daten = store.getDaten();
    leeren(statusBereich);
    statusBereich.appendChild(el('p', 'hinweis', TIER_TEXT[status.tier]));
    statusBereich.appendChild(
      el(
        'p',
        'fuss',
        `${daten.monate.length} erfasste Monate · ${daten.fixkosten.length} Fixkostenposten` +
          (status.letzterSpeicherzeitpunkt !== null
            ? ` · zuletzt gesichert ${new Date(status.letzterSpeicherzeitpunkt).toLocaleString('de-DE', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}`
            : ''),
      ),
    );
    if (status.speichertGerade) {
      statusBereich.appendChild(el('p', 'fuss', 'Speichert gerade …'));
    }
  }

  statusZeichnen();

  return {
    el: wurzel,
    aktualisieren: statusZeichnen,
  };
}
