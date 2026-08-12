/**
 * Tests für Export/Import — die einzige Sicherung, die der Nutzer selbst in der Hand hat.
 */

import { describe, expect, it } from 'vitest';
import { startDaten, type AppDaten } from '../domain/types';
import { SpeicherFehler } from './adapter';
import { exportDateiname, exportierenAlsJson, importierenAusJson } from './portable';

function beispielDaten(): AppDaten {
  const daten = startDaten();
  daten.monate.push({
    id: 'm1',
    jahr: 2026,
    monat: 8,
    etfDepotCent: 512345,
    tagesgeldCent: 210000,
    sonderausgabeCent: 12900,
    sonderausgabeNotiz: 'Zahnarzt, Zuzahlung',
    erfasstAm: 1754000000000,
  });
  return daten;
}

describe('exportierenAlsJson', () => {
  it('schreibt lesbares JSON mit 2 Leerzeichen Einrückung', () => {
    const text = exportierenAlsJson(beispielDaten());
    expect(text.split('\n')[1]).toMatch(/^ {2}"/);
    expect(text).toContain('\n');
  });
});

describe('exportDateiname', () => {
  it('baut den Namen aus dem Datum', () => {
    expect(exportDateiname(new Date(2026, 7, 10))).toBe('sparreise-2026-08-10.json');
    expect(exportDateiname(new Date(2026, 0, 1))).toBe('sparreise-2026-01-01.json');
  });

  it('fällt bei einem unbrauchbaren Datum auf heute zurück', () => {
    expect(exportDateiname(new Date('kein datum'))).toMatch(/^sparreise-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('funktioniert ohne Argument', () => {
    expect(exportDateiname()).toMatch(/^sparreise-\d{4}-\d{2}-\d{2}\.json$/);
  });
});

describe('importierenAusJson', () => {
  it('Rundreise Export → Import ergibt identische Daten', () => {
    const daten = beispielDaten();
    expect(importierenAusJson(exportierenAlsJson(daten))).toEqual(daten);
  });

  it('Rundreise über zwei Runden bleibt stabil', () => {
    const einmal = importierenAusJson(exportierenAlsJson(beispielDaten()));
    const zweimal = importierenAusJson(exportierenAlsJson(einmal));
    expect(zweimal).toEqual(einmal);
  });

  it('wirft bei kaputtem JSON einen SpeicherFehler mit deutschem nutzerText', () => {
    const fehler = (() => {
      try {
        importierenAusJson('{ das ist keine Datei');
        return null;
      } catch (f) {
        return f;
      }
    })();
    expect(fehler).toBeInstanceOf(SpeicherFehler);
    const s = fehler as SpeicherFehler;
    expect(s.nutzerText.length).toBeGreaterThan(0);
    expect(s.nutzerText).toContain('Datei');
    // Kein technischer Kram im Text, den der Nutzer sieht.
    expect(s.nutzerText).not.toMatch(/JSON\.parse|SyntaxError|at\s/);
  });

  it('wirft bei gültigem JSON mit unbrauchbarem Inhalt', () => {
    for (const text of ['null', '42', '"hallo"', '[]', '{}', '{"schemaVersion":99,"fixkosten":[],"monate":[]}']) {
      let gefangen: unknown = null;
      try {
        importierenAusJson(text);
      } catch (f) {
        gefangen = f;
      }
      expect(gefangen, `Eingabe: ${text}`).toBeInstanceOf(SpeicherFehler);
      expect((gefangen as SpeicherFehler).nutzerText.length).toBeGreaterThan(0);
    }
  });

  it('lässt bei einer manipulierten Datei nichts halb Importiertes zurück', () => {
    const kaputt = '{"schemaVersion":1,"fixkosten":"nein","monate":[]}';
    expect(() => importierenAusJson(kaputt)).toThrow(SpeicherFehler);
  });

  it('nimmt eine von Hand reparierte Datei mit anderer Schlüsselreihenfolge an', () => {
    const daten = beispielDaten();
    const gedreht = JSON.stringify({
      monate: daten.monate,
      einstellungen: daten.einstellungen,
      fixkosten: daten.fixkosten,
      einnahmen: daten.einnahmen,
      invest: daten.invest,
      schemaVersion: daten.schemaVersion,
    });
    expect(importierenAusJson(gedreht)).toEqual(daten);
  });
});
