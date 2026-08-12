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
 *   − Fixkosten         1.000,00   (15 Posten)
 *   − Studium             200,00
 *   = Verfügbar           800,00
 *   − Freizeit            300,00
 *   − Invest              150,00   (3 Posten à 50,00)
 *   = Tagesgeld           350,00
 */
function probeDaten(): AppDaten {
  const daten = startDaten();
  // 15 Posten, Summe genau 100000 Cent: 14 × 5000 + 1 × 30000.
  const fixkosten = daten.fixkosten.map((p, i) => ({ ...p, betragCent: i === 0 ? 30000 : 5000 }));
  const invest = daten.invest.map((p) => ({ ...p, betragCent: 5000 }));
  return {
    ...daten,
    fixkosten,
    invest,
    einstellungen: { ...daten.einstellungen, einkommenCent: 200000, studiumCent: 20000 },
  };
}

/** Probedaten mit einer abweichenden Anlage-Liste. */
function mitInvest(...betraege: number[]): AppDaten {
  return {
    ...probeDaten(),
    invest: betraege.map((betragCent, i) => ({ id: `inv${i}`, name: `Anlage ${i}`, betragCent })),
  };
}

function mitEinstellungen(teil: Partial<AppDaten['einstellungen']>): AppDaten {
  const daten = probeDaten();
  return { ...daten, einstellungen: { ...daten.einstellungen, ...teil } };
}

/** Die Invariante gilt für JEDE Eingabe — deshalb steht sie als eigene Hilfsprüfung hier. */
function pruefeInvariante(v: Verteilung): void {
  expect(
    v.fixkostenCent + v.studiumCent + v.freizeitCent + v.investCent + v.uebrigCent,
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
    expect(v.investCent).toBe(15000); //       150,00 €
    expect(v.uebrigCent).toBe(35000); //       350,00 €  ← Tagesgeld
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
    expect(v.uebrigCent).toBe(135000); // 200000 - 20000 - 30000 - 15000
    expect(v.unterdeckung).toBe(false);
    pruefeInvariante(v);
  });

  it('Einkommen 0 → volle Unterdeckung', () => {
    const v = berechneVerteilung(mitEinstellungen({ einkommenCent: 0 }));
    expect(v.einkommenCent).toBe(0);
    expect(v.uebrigCent).toBe(-165000); // 0 - 100000 - 20000 - 30000 - 15000
    expect(v.unterdeckung).toBe(true);
    pruefeInvariante(v);
  });

  it('alles auf 0 → alles 0, keine Unterdeckung', () => {
    const daten: AppDaten = {
      ...startDaten(),
      fixkosten: [],
      invest: [],
      einstellungen: {
        einkommenCent: 0,
        studiumCent: 0,
        freizeitCent: 0,
      },
    };
    const v = berechneVerteilung(daten);
    expect(v.uebrigCent).toBe(0);
    expect(v.investCent).toBe(0);
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
    expect(v.uebrigCent).toBe(75000); // 200000 - 60000 - 20000 - 30000 - 15000
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
    expect(v.uebrigCent).toBe(99999999999 - 100000 - 1000000000 - 30000 - 15000);
    expect(Number.isSafeInteger(v.uebrigCent)).toBe(true);
    pruefeInvariante(v);
  });

  it('Freizeit + Invest übersteigen das Verfügbare', () => {
    const v = berechneVerteilung({ ...mitInvest(20000), einstellungen: { ...probeDaten().einstellungen, freizeitCent: 70000 } });
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
    const v = berechneVerteilung(mitEinstellungen({ freizeitCent: 65000 }));
    expect(v.uebrigCent).toBe(0); // 80000 - 65000 - 15000
    expect(v.unterdeckung).toBe(false);
  });

  it('investCent ist die Summe der Anlageliste', () => {
    expect(berechneVerteilung(mitInvest(2500, 7500, 12500)).investCent).toBe(22500);
    expect(berechneVerteilung(mitInvest()).investCent).toBe(0);
  });

  it('fehlende Anlageliste (Altdaten) zählt als 0 und wirft nicht', () => {
    const daten = { ...probeDaten(), invest: undefined as never };
    const v = berechneVerteilung(daten);
    expect(v.investCent).toBe(0);
    expect(v.uebrigCent).toBe(50000); // 80000 - 30000 - 0
    pruefeInvariante(v);
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
        invest: Array.from({ length: 3 }, (_, k) => ({
          id: `i${k}`,
          name: `i${k}`,
          betragCent: zufall(),
        })),
        einstellungen: {
          einkommenCent: zufall(),
          studiumCent: zufall(),
          freizeitCent: zufall(),
        },
      };
      pruefeInvariante(berechneVerteilung(daten));
    }
  });
});

describe('sparquote', () => {
  it('Probedaten: (150,00 Invest + 350,00 Tagesgeld) / 2.000,00 = 25 %', () => {
    const q = sparquote(berechneVerteilung(probeDaten()));
    expect(q).toBeCloseTo(50000 / 200000, 10);
    expect(q).toBeCloseTo(0.25, 10);
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
      mitInvest(900000), // absurd hohe Anlagerate
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

