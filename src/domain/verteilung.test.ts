import { describe, expect, it } from 'vitest';
import { berechneVerteilung, sparquote, type Verteilung } from './verteilung';
import { startDaten, type AppDaten } from './types';

/**
 * Synthetische Probedaten mit runden Zahlen.
 *
 * `startDaten()` enthält absichtlich keine Beträge (Datenschutz, siehe types.ts),
 * taugt also nicht als Rechenanker. Diese Vorlage prüft die Formel — sie ist
 * bewusst erfunden und beschreibt niemanden.
 *
 *   Einkommen           2.000,00
 *   − Fixkosten         1.000,00   (17 Posten)
 *   − Studium             200,00
 *   = Verfügbar           800,00
 *   − Freizeit            300,00
 *   − ETF zusätzlich       50,00
 *   = Tagesgeld           450,00
 *   ETF gesamt            150,00   (100,00 in Fixkosten + 50,00 zusätzlich)
 */
function probeDaten(): AppDaten {
  const daten = startDaten();
  // 17 Posten, Summe genau 100000 Cent: 16 × 5000 + 1 × 20000.
  const fixkosten = daten.fixkosten.map((p, i) => ({ ...p, betragCent: i === 0 ? 20000 : 5000 }));
  return {
    ...daten,
    fixkosten,
    einstellungen: { ...daten.einstellungen, einkommenCent: 200000, studiumCent: 20000 },
  };
}

function mitEinstellungen(teil: Partial<AppDaten['einstellungen']>): AppDaten {
  const daten = probeDaten();
  return { ...daten, einstellungen: { ...daten.einstellungen, ...teil } };
}

/** Die Invariante gilt für JEDE Eingabe — deshalb steht sie als eigene Hilfsprüfung hier. */
function pruefeInvariante(v: Verteilung): void {
  expect(
    v.fixkostenCent + v.studiumCent + v.freizeitCent + v.etfZusatzCent + v.uebrigCent,
  ).toBe(v.einkommenCent);
}

describe('berechneVerteilung — PFLICHT-TESTFALL', () => {
  it('liefert exakt die abgestimmten Zahlen', () => {
    const v = berechneVerteilung(probeDaten());

    // Literale, bewusst NICHT aus denselben Formeln nachgerechnet.
    expect(v.einkommenCent).toBe(200000); // 2.000,00 €
    expect(v.fixkostenCent).toBe(100000); // 1.000,00 €
    expect(v.studiumCent).toBe(20000); //     200,00 €
    expect(v.verfuegbarCent).toBe(80000); //  800,00 €
    expect(v.freizeitCent).toBe(30000); //     300,00 €
    expect(v.etfZusatzCent).toBe(5000); //      50,00 €
    expect(v.uebrigCent).toBe(45000); //       450,00 €  ← Tagesgeld
    expect(v.etfGesamtCent).toBe(15000); //    150,00 €
    expect(v.unterdeckung).toBe(false);
  });

  it('Verfügbar = Einkommen minus Fixkosten und Studium', () => {
    const v = berechneVerteilung(probeDaten());
    expect(v.einkommenCent - (v.fixkostenCent + v.studiumCent)).toBe(80000);
    expect(v.verfuegbarCent).toBe(80000);
  });

  it('erfüllt die Invariante', () => {
    pruefeInvariante(berechneVerteilung(probeDaten()));
  });

  it('mutiert die Eingabedaten nicht', () => {
    const daten = probeDaten();
    const kopie = JSON.parse(JSON.stringify(daten)) as AppDaten;
    berechneVerteilung(daten);
    expect(daten).toEqual(kopie);
  });
});

describe('berechneVerteilung — Randfälle', () => {
  it('Fixkosten-Liste komplett leer', () => {
    const daten = { ...probeDaten(), fixkosten: [] };
    const v = berechneVerteilung(daten);
    expect(v.fixkostenCent).toBe(0);
    expect(v.uebrigCent).toBe(145000); // 200000 - 20000 - 30000 - 5000
    expect(v.unterdeckung).toBe(false);
    pruefeInvariante(v);
  });

  it('Einkommen 0 → volle Unterdeckung', () => {
    const v = berechneVerteilung(mitEinstellungen({ einkommenCent: 0 }));
    expect(v.einkommenCent).toBe(0);
    expect(v.uebrigCent).toBe(-155000); // 0 - 100000 - 20000 - 30000 - 5000
    expect(v.unterdeckung).toBe(true);
    pruefeInvariante(v);
  });

  it('alles auf 0 → alles 0, keine Unterdeckung', () => {
    const daten: AppDaten = {
      ...startDaten(),
      fixkosten: [],
      einstellungen: {
        einkommenCent: 0,
        studiumCent: 0,
        freizeitCent: 0,
        etfZusatzCent: 0,
        etfInFixkostenCent: 0,
      },
    };
    const v = berechneVerteilung(daten);
    expect(v.uebrigCent).toBe(0);
    expect(v.etfGesamtCent).toBe(0);
    expect(v.unterdeckung).toBe(false);
    pruefeInvariante(v);
  });

  it('negative Einzelbeträge (Gutschrift in den Fixkosten)', () => {
    const daten = probeDaten();
    daten.fixkosten = [
      { id: 'a', name: 'Miete', betragCent: 70000 },
      { id: 'b', name: 'Rückerstattung', betragCent: -10000 },
    ];
    const v = berechneVerteilung(daten);
    expect(v.fixkostenCent).toBe(60000);
    expect(v.uebrigCent).toBe(85000); // 200000 - 60000 - 20000 - 30000 - 5000
    pruefeInvariante(v);
  });

  it('negatives Einkommen', () => {
    const v = berechneVerteilung(mitEinstellungen({ einkommenCent: -100000 }));
    expect(v.unterdeckung).toBe(true);
    pruefeInvariante(v);
  });

  it('sehr große Beträge bleiben exakt und ganzzahlig', () => {
    const v = berechneVerteilung(
      mitEinstellungen({ einkommenCent: 99999999999, studiumCent: 1000000000 }),
    );
    expect(v.uebrigCent).toBe(99999999999 - 100000 - 1000000000 - 30000 - 5000);
    expect(Number.isSafeInteger(v.uebrigCent)).toBe(true);
    pruefeInvariante(v);
  });

  it('Freizeit + ETF-Zusatz übersteigen das Verfügbare', () => {
    const v = berechneVerteilung(mitEinstellungen({ freizeitCent: 70000, etfZusatzCent: 20000 }));
    // Verfügbar 80000, verteilt werden 90000
    expect(v.uebrigCent).toBe(-10000);
    expect(v.unterdeckung).toBe(true);
    pruefeInvariante(v);
  });

  it('Verteilung übersteigt Verfügbares massiv', () => {
    const v = berechneVerteilung(mitEinstellungen({ freizeitCent: 1000000 }));
    expect(v.unterdeckung).toBe(true);
    expect(v.uebrigCent).toBeLessThan(0);
    pruefeInvariante(v);
  });

  it('uebrigCent === 0 gilt nicht als Unterdeckung', () => {
    const v = berechneVerteilung(mitEinstellungen({ freizeitCent: 75000 }));
    expect(v.uebrigCent).toBe(0); // 80000 - 75000 - 5000
    expect(v.unterdeckung).toBe(false);
  });

  it('etfGesamtCent ist etfInFixkosten + etfZusatz, unabhängig von der Fixkostenliste', () => {
    const v = berechneVerteilung(mitEinstellungen({ etfInFixkostenCent: 25000, etfZusatzCent: 7500 }));
    expect(v.etfGesamtCent).toBe(32500);
  });

  it('kaputte Werte kippen weder Ergebnis noch Invariante', () => {
    const daten = startDaten();
    daten.einstellungen.einkommenCent = Number.NaN;
    daten.fixkosten = [{ id: 'a', name: 'x', betragCent: Number.POSITIVE_INFINITY }];
    const v = berechneVerteilung(daten);
    expect(v.einkommenCent).toBe(0);
    expect(v.fixkostenCent).toBe(0);
    pruefeInvariante(v);
  });

  it('Invariante hält über zufällige Eingaben', () => {
    for (let i = 0; i < 200; i++) {
      const zufall = (): number => Math.round((Math.random() - 0.3) * 500000);
      const daten: AppDaten = {
        ...startDaten(),
        fixkosten: Array.from({ length: i % 7 }, (_, k) => ({
          id: `f${k}`,
          name: `f${k}`,
          betragCent: zufall(),
        })),
        einstellungen: {
          einkommenCent: zufall(),
          studiumCent: zufall(),
          freizeitCent: zufall(),
          etfZusatzCent: zufall(),
          etfInFixkostenCent: zufall(),
        },
      };
      pruefeInvariante(berechneVerteilung(daten));
    }
  });
});

describe('sparquote', () => {
  it('Probedaten: (150,00 ETF + 450,00 Tagesgeld) / 2.000,00 = 30 %', () => {
    const q = sparquote(berechneVerteilung(probeDaten()));
    expect(q).toBeCloseTo(60000 / 200000, 10);
    expect(q).toBeCloseTo(0.3, 10);
  });

  it('Einkommen 0 → 0 statt Division durch null', () => {
    const v = berechneVerteilung(mitEinstellungen({ einkommenCent: 0 }));
    expect(sparquote(v)).toBe(0);
    expect(Number.isNaN(sparquote(v))).toBe(false);
  });

  it('negatives Einkommen → 0', () => {
    expect(sparquote(berechneVerteilung(mitEinstellungen({ einkommenCent: -1 })))).toBe(0);
  });

  it('ist immer auf 0..1 geklemmt', () => {
    const faelle = [
      startDaten(),
      mitEinstellungen({ freizeitCent: 1000000 }), // starke Unterdeckung
      mitEinstellungen({ etfInFixkostenCent: 900000 }), // absurd hohe ETF-Rate
      { ...startDaten(), fixkosten: [] },
    ];
    for (const daten of faelle) {
      const q = sparquote(berechneVerteilung(daten));
      expect(q).toBeGreaterThanOrEqual(0);
      expect(q).toBeLessThanOrEqual(1);
      expect(Number.isFinite(q)).toBe(true);
    }
  });
});

