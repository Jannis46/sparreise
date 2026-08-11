import { describe, expect, it } from 'vitest';
import {
  ETAPPEN_SCHWELLEN_CENT,
  aktuellesVermoegenCent,
  etappen,
  hoechstesVermoegenCent,
  sortierteMonate,
  veraenderungCent,
  vermoegenCent,
} from './etappen';
import { startDaten, type AppDaten, type Monatseintrag } from './types';

let lfd = 0;

/** Monatseintrag mit stabilen Defaults. `erfasstAm` läuft hoch, solange nichts anderes gesetzt ist. */
function monat(teil: Partial<Monatseintrag> & Pick<Monatseintrag, 'jahr' | 'monat'>): Monatseintrag {
  lfd += 1;
  return {
    id: `m${lfd}`,
    etfDepotCent: 0,
    tagesgeldCent: 0,
    erfasstAm: lfd,
    ...teil,
  };
}

function mitMonaten(monate: Monatseintrag[]): AppDaten {
  return { ...startDaten(), monate };
}

/** Datensatz, dessen jüngster Eintrag genau `cent` Vermögen hat. */
function mitVermoegen(cent: number): AppDaten {
  return mitMonaten([monat({ jahr: 2026, monat: 1, etfDepotCent: cent, tagesgeldCent: 0 })]);
}

// ---------------------------------------------------------------- vermoegenCent

describe('vermoegenCent', () => {
  it('ist ETF-Depot + Tagesgeld', () => {
    expect(vermoegenCent(monat({ jahr: 2026, monat: 3, etfDepotCent: 150000, tagesgeldCent: 21000 }))).toBe(
      171000,
    );
  });

  it('beide 0 → 0', () => {
    expect(vermoegenCent(monat({ jahr: 2026, monat: 1 }))).toBe(0);
  });

  it('negatives Tagesgeld zieht ab (Dispo)', () => {
    expect(
      vermoegenCent(monat({ jahr: 2026, monat: 1, etfDepotCent: 100000, tagesgeldCent: -25000 })),
    ).toBe(75000);
  });

  it('rundet kaufmännisch symmetrisch, kein -0', () => {
    const v = vermoegenCent(monat({ jahr: 2026, monat: 1, etfDepotCent: 1.5, tagesgeldCent: -1.5 }));
    expect(v).toBe(0);
    expect(Object.is(v, -0)).toBe(false);
    expect(vermoegenCent(monat({ jahr: 2026, monat: 1, etfDepotCent: 2.4, tagesgeldCent: 0 }))).toBe(2);
    expect(vermoegenCent(monat({ jahr: 2026, monat: 1, etfDepotCent: 0, tagesgeldCent: -2.6 }))).toBe(-3);
  });

  it('NaN und Infinity zählen als 0 statt anzustecken', () => {
    const v = vermoegenCent(
      monat({ jahr: 2026, monat: 1, etfDepotCent: Number.NaN, tagesgeldCent: 50000 }),
    );
    expect(v).toBe(50000);
    expect(
      vermoegenCent(
        monat({
          jahr: 2026,
          monat: 1,
          etfDepotCent: Number.POSITIVE_INFINITY,
          tagesgeldCent: Number.NEGATIVE_INFINITY,
        }),
      ),
    ).toBe(0);
  });

  it('sehr große Beträge bleiben exakt', () => {
    expect(
      vermoegenCent(monat({ jahr: 2026, monat: 1, etfDepotCent: 99999999999, tagesgeldCent: 1 })),
    ).toBe(100000000000);
  });
});

// ------------------------------------------------------------- sortierteMonate

describe('sortierteMonate', () => {
  it('sortiert chronologisch aufsteigend über Jahres- und Monatsgrenzen', () => {
    const daten = mitMonaten([
      monat({ id: 'c', jahr: 2026, monat: 1 }),
      monat({ id: 'a', jahr: 2025, monat: 11 }),
      monat({ id: 'd', jahr: 2026, monat: 2 }),
      monat({ id: 'b', jahr: 2025, monat: 12 }),
    ]);
    expect(sortierteMonate(daten).map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sortiert nach Monat, nicht nach Monatsstring (10 kommt nach 9)', () => {
    const daten = mitMonaten([
      monat({ id: 'zehn', jahr: 2026, monat: 10 }),
      monat({ id: 'neun', jahr: 2026, monat: 9 }),
      monat({ id: 'eins', jahr: 2026, monat: 1 }),
    ]);
    expect(sortierteMonate(daten).map((m) => m.id)).toEqual(['eins', 'neun', 'zehn']);
  });

  it('mutiert das Eingabe-Array nicht', () => {
    const monate = [
      monat({ id: 'spaet', jahr: 2026, monat: 5 }),
      monat({ id: 'frueh', jahr: 2026, monat: 1 }),
    ];
    const daten = mitMonaten(monate);
    const vorher = monate.slice();

    const sortiert = sortierteMonate(daten);

    expect(monate).not.toBe(sortiert);
    expect(monate.map((m) => m.id)).toEqual(['spaet', 'frueh']); // Reihenfolge unverändert
    expect(monate).toEqual(vorher);
    expect(daten.monate).toBe(monate);
  });

  it('gibt dieselben Objektreferenzen zurück (keine Kopien der Einträge)', () => {
    const eintrag = monat({ jahr: 2026, monat: 4 });
    expect(sortierteMonate(mitMonaten([eintrag]))[0]).toBe(eintrag);
  });

  it('leere Liste → leeres Array', () => {
    expect(sortierteMonate(startDaten())).toEqual([]);
  });

  it('gleiches Jahr/Monat: erfasstAm entscheidet, danach die id — deterministisch', () => {
    const daten = mitMonaten([
      monat({ id: 'z', jahr: 2026, monat: 6, erfasstAm: 200 }),
      monat({ id: 'b', jahr: 2026, monat: 6, erfasstAm: 100 }),
      monat({ id: 'a', jahr: 2026, monat: 6, erfasstAm: 100 }),
    ]);
    expect(sortierteMonate(daten).map((m) => m.id)).toEqual(['a', 'b', 'z']);
  });

  it('doppelte Monatseinträge werden weder verworfen noch zusammengefasst', () => {
    const daten = mitMonaten([
      monat({ id: 'alt', jahr: 2026, monat: 6, erfasstAm: 1, etfDepotCent: 100000 }),
      monat({ id: 'neu', jahr: 2026, monat: 6, erfasstAm: 2, etfDepotCent: 200000 }),
    ]);
    const sortiert = sortierteMonate(daten);
    expect(sortiert).toHaveLength(2);
    expect(sortiert.map((m) => m.id)).toEqual(['alt', 'neu']);
  });

  it('liefert bei mehrfachem Aufruf stets dieselbe Reihenfolge', () => {
    const daten = mitMonaten([
      monat({ id: 'x', jahr: 2026, monat: 2, erfasstAm: 5 }),
      monat({ id: 'y', jahr: 2026, monat: 2, erfasstAm: 5 }),
      monat({ id: 'w', jahr: 2026, monat: 2, erfasstAm: 5 }),
    ]);
    const erst = sortierteMonate(daten).map((m) => m.id);
    expect(sortierteMonate(daten).map((m) => m.id)).toEqual(erst);
    expect(erst).toEqual(['w', 'x', 'y']);
  });
});

// -------------------------------------------------------------------- etappen

describe('etappen — Grundgerüst', () => {
  it('hat die Schwellen 0 / 1.000 / 3.000 / 6.000 / 10.000 €', () => {
    expect(ETAPPEN_SCHWELLEN_CENT).toEqual([0, 100000, 300000, 600000, 1000000]);
    expect(etappen(startDaten()).map((e) => e.zielCent)).toEqual([0, 100000, 300000, 600000, 1000000]);
  });

  it('vergibt stabile ids', () => {
    expect(etappen(startDaten()).map((e) => e.id)).toEqual([
      'etappe-0',
      'etappe-100000',
      'etappe-300000',
      'etappe-600000',
      'etappe-1000000',
    ]);
  });

  it('Etappennamen sind gesetzt und höchstens 18 Zeichen lang (390px-Display)', () => {
    for (const e of etappen(startDaten())) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.name.length).toBeLessThanOrEqual(18);
      expect(e.name.trim()).toBe(e.name);
    }
  });

  it('mutiert die Eingabedaten nicht', () => {
    const daten = mitVermoegen(450000);
    const kopie = JSON.parse(JSON.stringify(daten)) as AppDaten;
    etappen(daten);
    expect(daten).toEqual(kopie);
  });
});

describe('etappen — keine Monatseinträge', () => {
  it('wirft nicht und liefert fünf Etappen', () => {
    expect(() => etappen(startDaten())).not.toThrow();
    expect(etappen(startDaten())).toHaveLength(5);
  });

  it('nur die Startetappe bei 0 € gilt als erreicht', () => {
    const e = etappen(startDaten());
    expect(e.map((x) => x.erreicht)).toEqual([true, false, false, false, false]);
    expect(e.map((x) => x.anteil)).toEqual([1, 0, 0, 0, 0]);
    expect(e.map((x) => x.erreichtCent)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('etappen — genau auf einer Schwelle', () => {
  it('exakt 3.000 € → dritte Etappe voll, vierte bei 0', () => {
    const e = etappen(mitVermoegen(300000));

    expect(e.map((x) => x.erreicht)).toEqual([true, true, true, false, false]);
    expect(e.map((x) => x.anteil)).toEqual([1, 1, 1, 0, 0]);
    expect(e.map((x) => x.erreichtCent)).toEqual([0, 100000, 300000, 300000, 300000]);
  });

  it('exakt 1.000 € → zweite Etappe gerade erreicht', () => {
    const e = etappen(mitVermoegen(100000));
    expect(e[1]?.erreicht).toBe(true);
    expect(e[1]?.anteil).toBe(1);
    expect(e[2]?.erreicht).toBe(false);
    expect(e[2]?.anteil).toBe(0);
  });

  it('exakt 10.000 € → alle Etappen erreicht', () => {
    const e = etappen(mitVermoegen(1000000));
    expect(e.map((x) => x.erreicht)).toEqual([true, true, true, true, true]);
    expect(e.map((x) => x.anteil)).toEqual([1, 1, 1, 1, 1]);
  });

  it('einen Cent unter 3.000 € ist die Etappe noch nicht erreicht', () => {
    const e = etappen(mitVermoegen(299999));
    expect(e[2]?.erreicht).toBe(false);
    expect(e[2]?.anteil).toBeCloseTo(0.999995, 10);
    expect(e[2]?.erreichtCent).toBe(299999);
  });
});

describe('etappen — zwischen zwei Schwellen', () => {
  it('4.500 € liegt genau in der Mitte zwischen 3.000 und 6.000', () => {
    const e = etappen(mitVermoegen(450000));

    expect(e[3]?.zielCent).toBe(600000);
    expect(e[3]?.anteil).toBe(0.5);
    expect(e[3]?.erreicht).toBe(false);
    expect(e[3]?.erreichtCent).toBe(450000);

    // vorherige Etappen voll, spätere bei 0
    expect(e[2]?.anteil).toBe(1);
    expect(e[2]?.erreicht).toBe(true);
    expect(e[4]?.anteil).toBe(0);
  });

  it('250,00 € → ein Viertel der ersten 1.000er-Etappe', () => {
    const e = etappen(mitVermoegen(25000));
    expect(e[1]?.anteil).toBe(0.25);
    expect(e[1]?.erreicht).toBe(false);
    expect(e[1]?.erreichtCent).toBe(25000);
  });

  it('8.000 € → halbe Strecke der letzten Etappe', () => {
    const e = etappen(mitVermoegen(800000));
    expect(e[4]?.anteil).toBe(0.5);
    expect(e[4]?.erreicht).toBe(false);
    expect(e[4]?.erreichtCent).toBe(800000);
  });

  it('anteil liegt bei allen Zwischenständen in 0..1 und ist endlich', () => {
    for (let cent = -50000; cent <= 1200000; cent += 12345) {
      for (const e of etappen(mitVermoegen(cent))) {
        expect(Number.isFinite(e.anteil)).toBe(true);
        expect(e.anteil).toBeGreaterThanOrEqual(0);
        expect(e.anteil).toBeLessThanOrEqual(1);
      }
    }
  });

  it('erreichtCent überschreitet zielCent nie und wird nie negativ', () => {
    for (const cent of [-999999, -1, 0, 1, 99999, 450000, 1000001, 987654321]) {
      for (const e of etappen(mitVermoegen(cent))) {
        expect(e.erreichtCent).toBeGreaterThanOrEqual(0);
        expect(e.erreichtCent).toBeLessThanOrEqual(e.zielCent);
      }
    }
  });
});

describe('etappen — über der letzten Schwelle', () => {
  it('12.345,67 € → letzte Etappe erreicht, anteil exakt 1', () => {
    const e = etappen(mitVermoegen(1234567));
    const letzte = e[4];

    expect(letzte?.erreicht).toBe(true);
    expect(letzte?.anteil).toBe(1);
    expect(letzte?.erreichtCent).toBe(1000000); // auf das Ziel gedeckelt
  });

  it('anteil ist auch bei absurd großem Vermögen weder NaN noch Infinity', () => {
    for (const cent of [1000001, 10 ** 9, Number.MAX_SAFE_INTEGER]) {
      for (const e of etappen(mitVermoegen(cent))) {
        expect(Number.isFinite(e.anteil)).toBe(true);
        expect(Number.isNaN(e.anteil)).toBe(false);
        expect(e.anteil).toBe(1);
        expect(e.erreicht).toBe(true);
      }
    }
  });

  it('Infinity im Depotwert kippt nichts (zählt als 0)', () => {
    const daten = mitMonaten([
      monat({ jahr: 2026, monat: 1, etfDepotCent: Number.POSITIVE_INFINITY, tagesgeldCent: 100000 }),
    ]);
    const e = etappen(daten);
    for (const x of e) {
      expect(Number.isFinite(x.anteil)).toBe(true);
    }
    expect(e[1]?.anteil).toBe(1); // nur die 100000 aus dem Tagesgeld zählen
    expect(e[2]?.erreicht).toBe(false);
  });
});

describe('etappen — negatives Vermögen', () => {
  // Die Etappen richten sich nach der Bestmarke, und die ist nie kleiner als 0.
  // Ein negativer Stand lässt deshalb nur die Nulletappe stehen — er stürzt
  // nicht ab und erzeugt keine negativen Anteile.
  it('stürzt nicht ab und klemmt anteil auf 0', () => {
    const e = etappen(mitVermoegen(-500000));

    expect(e).toHaveLength(5);
    expect(e.map((x) => x.anteil)).toEqual([1, 0, 0, 0, 0]);
    expect(e.map((x) => x.erreicht)).toEqual([true, false, false, false, false]);
    expect(e.map((x) => x.erreichtCent)).toEqual([0, 0, 0, 0, 0]);
  });

  it('minus ein Cent erzeugt keinen negativen Anteil', () => {
    const e = etappen(mitVermoegen(-1));
    expect(e[1]?.erreicht).toBe(false);
    expect(e[1]?.anteil).toBe(0);
    expect(Object.is(e[1]?.anteil, -0)).toBe(false);
  });
});

describe('etappen — Bestmarke rutscht nicht zurück', () => {
  it('bleibt erreicht, wenn das Depot später fällt', () => {
    const daten = mitMonaten([
      monat({ jahr: 2026, monat: 1, etfDepotCent: 100000, tagesgeldCent: 0 }),
      monat({ jahr: 2026, monat: 2, etfDepotCent: 350000, tagesgeldCent: 0 }), // Hoch
      monat({ jahr: 2026, monat: 3, etfDepotCent: 120000, tagesgeldCent: 0 }), // Absturz
    ]);
    const e = etappen(daten);
    // Bestmarke 3.500,00 € → Etappen bei 0, 1.000 und 3.000 bleiben erreicht.
    expect(e.map((x) => x.erreicht)).toEqual([true, true, true, false, false]);
    expect(hoechstesVermoegenCent(daten)).toBe(350000);
    // Der aktuelle Stand bleibt separat abrufbar und zeigt den Absturz.
    expect(aktuellesVermoegenCent(daten)).toBe(120000);
  });

  it('Bestmarke ohne Einträge ist 0', () => {
    expect(hoechstesVermoegenCent(mitMonaten([]))).toBe(0);
  });

  it('findet das Hoch unabhängig von der Array-Reihenfolge', () => {
    const daten = mitMonaten([
      monat({ jahr: 2026, monat: 3, etfDepotCent: 50000, tagesgeldCent: 0 }),
      monat({ jahr: 2026, monat: 1, etfDepotCent: 900000, tagesgeldCent: 0 }),
      monat({ jahr: 2026, monat: 2, etfDepotCent: 60000, tagesgeldCent: 0 }),
    ]);
    expect(hoechstesVermoegenCent(daten)).toBe(900000);
  });

  it('zählt ETF und Tagesgeld zusammen', () => {
    const daten = mitMonaten([
      monat({ jahr: 2026, monat: 1, etfDepotCent: 200000, tagesgeldCent: 200000 }), // 4.000
      monat({ jahr: 2026, monat: 2, etfDepotCent: 300000, tagesgeldCent: 0 }), // 3.000
    ]);
    expect(hoechstesVermoegenCent(daten)).toBe(400000);
  });
});

describe('etappen — Bezugspunkt ist der chronologisch jüngste Eintrag', () => {
  it('nicht der letzte im Array', () => {
    const daten = mitMonaten([
      monat({ jahr: 2026, monat: 6, etfDepotCent: 450000 }), // chronologisch jünger
      monat({ jahr: 2026, monat: 1, etfDepotCent: 25000 }), // steht hinten im Array
    ]);
    expect(etappen(daten)[3]?.anteil).toBe(0.5); // 450000 → halbe Strecke 3.000→6.000
  });

  it('doppelter Monatseintrag: der zuletzt erfasste gewinnt', () => {
    const daten = mitMonaten([
      monat({ id: 'neu', jahr: 2026, monat: 6, erfasstAm: 20, etfDepotCent: 450000 }),
      monat({ id: 'alt', jahr: 2026, monat: 6, erfasstAm: 10, etfDepotCent: 25000 }),
    ]);
    expect(() => etappen(daten)).not.toThrow();
    expect(etappen(daten)[3]?.anteil).toBe(0.5);
  });
});

// ------------------------------------------------------------ veraenderungCent

describe('veraenderungCent', () => {
  it('null ohne Monatseinträge', () => {
    expect(veraenderungCent(startDaten())).toBeNull();
  });

  it('null bei genau einem Eintrag', () => {
    expect(veraenderungCent(mitVermoegen(300000))).toBeNull();
  });

  it('positiv bei Zuwachs', () => {
    const daten = mitMonaten([
      monat({ jahr: 2026, monat: 1, etfDepotCent: 100000, tagesgeldCent: 20000 }),
      monat({ jahr: 2026, monat: 2, etfDepotCent: 150000, tagesgeldCent: 21000 }),
    ]);
    expect(veraenderungCent(daten)).toBe(51000); // 171000 − 120000
  });

  it('negativ bei Rückgang', () => {
    const daten = mitMonaten([
      monat({ jahr: 2026, monat: 1, etfDepotCent: 150000, tagesgeldCent: 21000 }),
      monat({ jahr: 2026, monat: 2, etfDepotCent: 100000, tagesgeldCent: 20000 }),
    ]);
    expect(veraenderungCent(daten)).toBe(-51000);
  });

  it('0 bei unverändertem Vermögen — und nicht null', () => {
    const daten = mitMonaten([
      monat({ jahr: 2026, monat: 1, etfDepotCent: 100000 }),
      monat({ jahr: 2026, monat: 2, etfDepotCent: 60000, tagesgeldCent: 40000 }),
    ]);
    expect(veraenderungCent(daten)).toBe(0);
  });

  it('benutzt die chronologisch letzten zwei, nicht die Array-Reihenfolge', () => {
    const daten = mitMonaten([
      monat({ jahr: 2026, monat: 3, etfDepotCent: 300000 }), // jüngster
      monat({ jahr: 2025, monat: 12, etfDepotCent: 100000 }), // ältester
      monat({ jahr: 2026, monat: 2, etfDepotCent: 250000 }), // vorletzter
    ]);
    expect(veraenderungCent(daten)).toBe(50000); // 300000 − 250000
  });

  it('vergleicht über den Jahreswechsel hinweg', () => {
    const daten = mitMonaten([
      monat({ jahr: 2026, monat: 1, etfDepotCent: 220000 }),
      monat({ jahr: 2025, monat: 12, etfDepotCent: 200000 }),
    ]);
    expect(veraenderungCent(daten)).toBe(20000);
  });

  it('doppelter Monatseintrag: vergleicht Korrektur gegen Original, ohne zu werfen', () => {
    const daten = mitMonaten([
      monat({ id: 'alt', jahr: 2026, monat: 6, erfasstAm: 10, etfDepotCent: 200000 }),
      monat({ id: 'korrektur', jahr: 2026, monat: 6, erfasstAm: 20, etfDepotCent: 210000 }),
    ]);
    expect(() => veraenderungCent(daten)).not.toThrow();
    expect(veraenderungCent(daten)).toBe(10000);
  });

  it('bleibt bei kaputten Werten endlich', () => {
    const daten = mitMonaten([
      monat({ jahr: 2026, monat: 1, etfDepotCent: Number.NaN, tagesgeldCent: 50000 }),
      monat({ jahr: 2026, monat: 2, etfDepotCent: Number.POSITIVE_INFINITY, tagesgeldCent: 70000 }),
    ]);
    const v = veraenderungCent(daten);
    expect(v).toBe(20000);
    expect(Number.isFinite(v as number)).toBe(true);
  });

  it('mutiert die Eingabedaten nicht', () => {
    const daten = mitMonaten([
      monat({ id: 'b', jahr: 2026, monat: 2, etfDepotCent: 200000 }),
      monat({ id: 'a', jahr: 2026, monat: 1, etfDepotCent: 100000 }),
    ]);
    const kopie = JSON.parse(JSON.stringify(daten)) as AppDaten;
    veraenderungCent(daten);
    expect(daten).toEqual(kopie);
    expect(daten.monate.map((m) => m.id)).toEqual(['b', 'a']);
  });
});
