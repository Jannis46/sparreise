/**
 * Tests für die Vertrauensgrenze: `migriere` darf bei KEINER Eingabe werfen.
 */

import { describe, expect, it } from 'vitest';
import { EINSTELLUNGEN_START, SCHEMA_VERSION, startDaten } from '../domain/types';
import { MAX_CENT, MAX_FIXKOSTEN, MAX_NAME_LAENGE, MAX_NOTIZ_LAENGE, migriere } from './migrate';

function gueltig(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(startDaten())) as Record<string, unknown>;
}

describe('migriere — Müll ergibt null statt einer Ausnahme', () => {
  const muell: ReadonlyArray<[name: string, wert: unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['Zahl', 42],
    ['Text', 'text'],
    ['leerer Text', ''],
    ['boolean', true],
    ['NaN', NaN],
    ['leeres Array', []],
    ['Array mit Objekten', [{ schemaVersion: 1 }]],
    ['leeres Objekt', {}],
    ['Objekt ohne Listen', { schemaVersion: 1 }],
    ['fixkosten kein Array', { schemaVersion: 1, fixkosten: {}, monate: [] }],
    ['monate kein Array', { schemaVersion: 1, fixkosten: [], monate: 'nein' }],
    ['schemaVersion als Text', { schemaVersion: '1', fixkosten: [], monate: [] }],
    ['schemaVersion 0', { schemaVersion: 0, fixkosten: [], monate: [] }],
    ['schemaVersion fehlt', { fixkosten: [], monate: [] }],
    ['schemaVersion 99 (neuere App)', { schemaVersion: 99, fixkosten: [], monate: [] }],
    ['verschachtelter Unsinn', { schemaVersion: 1, fixkosten: [[[[1]]]], monate: [{ a: { b: {} } }] }],
    ['Funktion', () => undefined],
    ['Symbol', Symbol('x')],
  ];

  for (const [name, wert] of muell) {
    it(`liefert null für: ${name}`, () => {
      expect(migriere(wert)).toBeNull();
    });
  }

  it('liefert null bei absurd vielen Einträgen', () => {
    const viele = { schemaVersion: 1, fixkosten: new Array(MAX_FIXKOSTEN + 1).fill({ name: 'x', betragCent: 1 }), monate: [] };
    expect(migriere(viele)).toBeNull();
  });

  it('liefert null, wenn in einer Liste kein einziger Eintrag brauchbar ist', () => {
    expect(migriere({ schemaVersion: 1, fixkosten: [{ name: 'x' }, 7], monate: [] })).toBeNull();
    expect(migriere({ schemaVersion: 1, fixkosten: [], monate: ['kaputt'] })).toBeNull();
  });

  it('liefert null bei zu tiefer Verschachtelung', () => {
    let tief: unknown = { ende: true };
    for (let i = 0; i < 40; i++) tief = { a: tief };
    expect(migriere({ schemaVersion: 1, fixkosten: [], monate: [], tief })).toBeNull();
  });
});

describe('migriere — Prototype Pollution', () => {
  it('verwirft Eingaben mit __proto__ und verändert Object.prototype nicht', () => {
    const angriff = JSON.parse(
      '{"schemaVersion":1,"fixkosten":[],"monate":[],"__proto__":{"kaputt":true}}',
    ) as unknown;
    expect(migriere(angriff)).toBeNull();
    expect(({} as Record<string, unknown>)['kaputt']).toBeUndefined();
  });

  it('verwirft __proto__ auch tief in einer Liste', () => {
    const angriff = JSON.parse(
      '{"schemaVersion":1,"fixkosten":[{"id":"a","name":"x","betragCent":1,"__proto__":{"x":1}}],"monate":[]}',
    ) as unknown;
    expect(migriere(angriff)).toBeNull();
  });

  it('verwirft die Schlüssel constructor und prototype', () => {
    expect(migriere({ schemaVersion: 1, fixkosten: [], monate: [], constructor: 1 })).toBeNull();
    expect(migriere({ schemaVersion: 1, fixkosten: [], monate: [], prototype: 1 })).toBeNull();
  });
});

describe('migriere — gültige Daten', () => {
  it('nimmt einen frischen Startdatensatz unverändert an', () => {
    const roh = gueltig();
    const daten = migriere(roh);
    expect(daten).toEqual(roh);
    expect(daten?.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('gibt ein frisch gebautes Objekt zurück, nie die Eingabe selbst', () => {
    const roh = gueltig();
    const daten = migriere(roh);
    expect(daten).not.toBe(roh);
    expect(daten?.fixkosten).not.toBe(roh['fixkosten']);
    expect(daten?.einstellungen).not.toBe(roh['einstellungen']);
  });

  it('übernimmt Monatseinträge inklusive optionaler Sonderausgabe', () => {
    const daten = migriere({
      schemaVersion: 1,
      fixkosten: [],
      einstellungen: EINSTELLUNGEN_START,
      monate: [
        {
          id: 'm1',
          jahr: 2026,
          monat: 8,
          etfDepotCent: 123456,
          tagesgeldCent: 21000,
          sonderausgabeCent: 5000,
          sonderausgabeNotiz: 'Zahnarzt',
          erfasstAm: 1754000000000,
        },
      ],
    });
    expect(daten?.monate).toHaveLength(1);
    expect(daten?.monate[0]).toEqual({
      id: 'm1',
      jahr: 2026,
      monat: 8,
      etfDepotCent: 123456,
      tagesgeldCent: 21000,
      sonderausgabeCent: 5000,
      sonderausgabeNotiz: 'Zahnarzt',
      erfasstAm: 1754000000000,
    });
  });
});

describe('migriere — Feldprüfung im Detail', () => {
  it('verwirft einzelne kaputte Positionen, rettet aber den Rest', () => {
    const daten = migriere({
      schemaVersion: 1,
      fixkosten: [
        { id: 'a', name: 'Miete', betragCent: 70000 },
        { id: 'b', name: 'Krumm', betragCent: 12.5 }, // kein Ganzzahl-Cent
        { id: 'c', name: 'Text', betragCent: '5000' },
        { id: 'd', name: 'Riesig', betragCent: MAX_CENT + 1 },
        'gar kein Objekt',
        { id: 'e', name: 'Strom', betragCent: 5800 },
      ],
      monate: [
        { id: 'm1', jahr: 2026, monat: 13, etfDepotCent: 1, tagesgeldCent: 1 }, // Monat außerhalb 1..12
        { id: 'm2', jahr: 2026, monat: 0, etfDepotCent: 1, tagesgeldCent: 1 },
        { id: 'm3', jahr: 1800, monat: 5, etfDepotCent: 1, tagesgeldCent: 1 }, // Jahr unplausibel
        { id: 'm4', jahr: 2026, monat: 5, etfDepotCent: 1, tagesgeldCent: 1 },
      ],
    });
    expect(daten?.fixkosten.map((p) => p.name)).toEqual(['Miete', 'Strom']);
    expect(daten?.monate.map((m) => m.id)).toEqual(['m4']);
  });

  it('kürzt zu lange Namen und Notizen', () => {
    const daten = migriere({
      schemaVersion: 1,
      fixkosten: [{ id: 'a', name: 'x'.repeat(5000), betragCent: 100 }],
      monate: [
        {
          id: 'm1',
          jahr: 2026,
          monat: 1,
          etfDepotCent: 0,
          tagesgeldCent: 0,
          sonderausgabeCent: 1,
          sonderausgabeNotiz: 'y'.repeat(5000),
        },
      ],
    });
    expect(daten?.fixkosten[0]?.name).toHaveLength(MAX_NAME_LAENGE);
    expect(daten?.monate[0]?.sonderausgabeNotiz).toHaveLength(MAX_NOTIZ_LAENGE);
  });

  it('ersetzt fehlende, leere und doppelte IDs', () => {
    const daten = migriere({
      schemaVersion: 1,
      fixkosten: [
        { id: 42, name: 'A', betragCent: 1 },
        { id: '', name: 'B', betragCent: 2 },
        { id: 'gleich', name: 'C', betragCent: 3 },
        { id: 'gleich', name: 'D', betragCent: 4 },
      ],
      monate: [],
    });
    const ids = (daten?.fixkosten ?? []).map((p) => p.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(typeof id).toBe('string');
  });

  it('benennt namenlose Posten statt sie zu verwerfen', () => {
    const daten = migriere({
      schemaVersion: 1,
      fixkosten: [{ id: 'a', name: 999, betragCent: 100 }],
      monate: [],
    });
    expect(daten?.fixkosten[0]?.name).toBe('Unbenannt');
    expect(daten?.fixkosten[0]?.betragCent).toBe(100);
  });

  it('fällt bei kaputten Einstellungen feldweise auf die Startwerte zurück', () => {
    const daten = migriere({
      schemaVersion: 1,
      fixkosten: [],
      monate: [],
      einstellungen: { einkommenCent: 300000, studiumCent: 'viel', freizeitCent: 1.5 },
    });
    expect(daten?.einstellungen.einkommenCent).toBe(300000);
    expect(daten?.einstellungen.studiumCent).toBe(EINSTELLUNGEN_START.studiumCent);
    expect(daten?.einstellungen.freizeitCent).toBe(EINSTELLUNGEN_START.freizeitCent);
  });

  it('migriert Schema 3 durch bis 5: etfZusatz wird zu einer Anlageposition', () => {
    const daten = migriere({
      schemaVersion: 3,
      fixkosten: [{ id: 'f1', name: 'Miete', betragCent: 70000 }],
      monate: [],
      einstellungen: {
        einkommenCent: 200000,
        studiumCent: 20000,
        freizeitCent: 30000,
        etfZusatzCent: 5000,
        etfInFixkostenCent: 10000,
      },
    });
    expect(daten?.schemaVersion).toBe(5);
    // Genau der Betrag, der vorher vom Verfügbaren abging — die Verteilung
    // rechnet nach der Migration identisch weiter.
    expect(daten?.invest).toHaveLength(1);
    expect(daten?.invest[0]?.betragCent).toBe(5000);
    expect(daten?.invest[0]?.name).toBe('ETF zusätzlich');
    // Der reine Anzeigewert entfällt ersatzlos.
    expect('etfInFixkostenCent' in (daten?.einstellungen ?? {})).toBe(false);
  });

  it('Schema 3 ohne etfZusatz ergibt eine leere Anlageliste', () => {
    const daten = migriere({
      schemaVersion: 3,
      fixkosten: [{ id: 'f1', name: 'Miete', betragCent: 70000 }],
      monate: [],
      einstellungen: { einkommenCent: 200000, studiumCent: 0, freizeitCent: 0, etfZusatzCent: 0 },
    });
    expect(daten?.invest).toEqual([]);
  });

  it('setzt ein unbrauchbares erfasstAm auf jetzt', () => {
    const vorher = Date.now();
    const daten = migriere({
      schemaVersion: 1,
      fixkosten: [],
      monate: [{ id: 'm', jahr: 2026, monat: 3, etfDepotCent: 0, tagesgeldCent: 0, erfasstAm: 'gestern' }],
    });
    expect(daten?.monate[0]?.erfasstAm).toBeGreaterThanOrEqual(vorher);
  });

  it('lässt eine unbrauchbare Sonderausgabe weg, statt den Eintrag zu verlieren', () => {
    const daten = migriere({
      schemaVersion: 1,
      fixkosten: [],
      monate: [
        { id: 'm', jahr: 2026, monat: 3, etfDepotCent: 0, tagesgeldCent: 0, sonderausgabeCent: {}, sonderausgabeNotiz: 7 },
      ],
    });
    expect(daten?.monate).toHaveLength(1);
    expect(daten?.monate[0]?.sonderausgabeCent).toBeUndefined();
    expect(daten?.monate[0]?.sonderausgabeNotiz).toBeUndefined();
  });
});
