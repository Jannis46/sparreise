import { describe, expect, it } from 'vitest';
import { jahresstatistik, monatsDetails } from './statistik';
import { startDaten, type AppDaten, type Monatseintrag } from './types';

let zaehler = 0;
const m = (
  jahr: number,
  monat: number,
  etfDepotCent: number,
  tagesgeldCent: number,
  extra: Partial<Monatseintrag> = {},
): Monatseintrag => ({
  id: `m${(zaehler += 1)}`,
  jahr,
  monat,
  etfDepotCent,
  tagesgeldCent,
  erfasstAm: zaehler,
  ...extra,
});

const mit = (monate: Monatseintrag[]): AppDaten => ({ ...startDaten(), monate });

describe('monatsDetails', () => {
  it('leere Liste ergibt leere Auswertung', () => {
    expect(monatsDetails(mit([]))).toEqual([]);
  });

  it('erster Monat hat keine Veränderung', () => {
    const [d] = monatsDetails(mit([m(2026, 1, 100000, 50000)]));
    expect(d?.vermoegenCent).toBe(150000);
    expect(d?.veraenderungCent).toBeNull();
    expect(d?.etfVeraenderungCent).toBeNull();
    expect(d?.quote).toBeNull();
  });

  it('rechnet Veränderungen gegen den erfassten Vormonat', () => {
    const d = monatsDetails(
      mit([m(2026, 1, 100000, 50000), m(2026, 2, 130000, 55000), m(2026, 3, 125000, 70000)]),
    );
    expect(d[1]?.veraenderungCent).toBe(35000); // 185000 − 150000
    expect(d[1]?.etfVeraenderungCent).toBe(30000);
    expect(d[1]?.tagesgeldVeraenderungCent).toBe(5000);
    // Dritter Monat: Depot fällt, Tagesgeld steigt stärker
    expect(d[2]?.etfVeraenderungCent).toBe(-5000);
    expect(d[2]?.tagesgeldVeraenderungCent).toBe(15000);
    expect(d[2]?.veraenderungCent).toBe(10000);
  });

  it('sortiert unabhängig von der Eingabereihenfolge', () => {
    const d = monatsDetails(mit([m(2026, 3, 300000, 0), m(2026, 1, 100000, 0), m(2026, 2, 200000, 0)]));
    expect(d.map((x) => x.eintrag.monat)).toEqual([1, 2, 3]);
    expect(d[1]?.veraenderungCent).toBe(100000);
  });

  it('Quote ist Veränderung geteilt durch Einkommen', () => {
    const d = monatsDetails(mit([m(2026, 1, 0, 0), m(2026, 2, 0, 50000)]), 200000);
    expect(d[1]?.quote).toBeCloseTo(0.25, 10);
  });

  it('Quote bleibt null ohne Einkommen — keine Division durch null', () => {
    const d = monatsDetails(mit([m(2026, 1, 0, 0), m(2026, 2, 0, 50000)]), 0);
    expect(d[1]?.quote).toBeNull();
    const negativ = monatsDetails(mit([m(2026, 1, 0, 0), m(2026, 2, 0, 50000)]), -100);
    expect(negativ[1]?.quote).toBeNull();
  });

  it('Quote darf negativ und über 1 sein', () => {
    const hoch = monatsDetails(mit([m(2026, 1, 0, 0), m(2026, 2, 500000, 0)]), 200000);
    expect(hoch[1]?.quote).toBeCloseTo(2.5, 10);
    const runter = monatsDetails(mit([m(2026, 1, 500000, 0), m(2026, 2, 400000, 0)]), 200000);
    expect(runter[1]?.quote).toBeCloseTo(-0.5, 10);
  });

  it('liest Sonderausgabe und Sondereinnahme', () => {
    const d = monatsDetails(
      mit([m(2026, 1, 0, 0, { sonderausgabeCent: 12000, sondereinnahmeCent: 45000 })]),
    );
    expect(d[0]?.sonderausgabeCent).toBe(12000);
    expect(d[0]?.sondereinnahmeCent).toBe(45000);
  });

  it('fehlende Sonderfelder zählen als 0, nicht als NaN', () => {
    const d = monatsDetails(mit([m(2026, 1, 100, 100)]));
    expect(d[0]?.sonderausgabeCent).toBe(0);
    expect(d[0]?.sondereinnahmeCent).toBe(0);
  });

  it('kaputte Werte kippen die Auswertung nicht', () => {
    const d = monatsDetails(
      mit([
        m(2026, 1, Number.NaN, 100000),
        m(2026, 2, 50000, Number.POSITIVE_INFINITY, { sonderausgabeCent: Number.NaN }),
      ]),
    );
    for (const x of d) {
      expect(Number.isSafeInteger(x.vermoegenCent)).toBe(true);
      expect(Number.isSafeInteger(x.sonderausgabeCent)).toBe(true);
    }
  });
});

describe('jahresstatistik', () => {
  it('leere Liste ergibt keine Jahre', () => {
    expect(jahresstatistik(mit([]))).toEqual([]);
  });

  it('erster Monat überhaupt zählt mit 0 Zuwachs', () => {
    // Sonst sähe das erste Jahr aus, als hätte man sein ganzes Vermögen darin gespart.
    const [j] = jahresstatistik(mit([m(2026, 1, 500000, 500000)]));
    expect(j?.jahr).toBe(2026);
    expect(j?.anzahlMonate).toBe(1);
    expect(j?.zuwachsCent).toBe(0);
    expect(j?.schnittProMonatCent).toBe(0);
    expect(j?.bester).toBeNull();
    expect(j?.endVermoegenCent).toBe(1000000);
  });

  it('summiert die Monatsveränderungen eines Jahres', () => {
    const j = jahresstatistik(
      mit([
        m(2026, 1, 100000, 0),
        m(2026, 2, 150000, 0), // +50000
        m(2026, 3, 130000, 0), // −20000
        m(2026, 4, 200000, 0), // +70000
      ]),
    );
    expect(j).toHaveLength(1);
    expect(j[0]?.zuwachsCent).toBe(100000);
    expect(j[0]?.anzahlMonate).toBe(4);
    expect(j[0]?.schnittProMonatCent).toBe(33333); // 100000 / 3, gerundet
    expect(j[0]?.bester).toEqual({ monat: 4, veraenderungCent: 70000 });
    expect(j[0]?.schlechtester).toEqual({ monat: 3, veraenderungCent: -20000 });
    expect(j[0]?.endVermoegenCent).toBe(200000);
  });

  it('trennt Jahre und rechnet über den Jahreswechsel weiter', () => {
    const j = jahresstatistik(
      mit([
        m(2026, 11, 100000, 0),
        m(2026, 12, 120000, 0), // +20000 → 2026
        m(2027, 1, 170000, 0), // +50000 → 2027
        m(2027, 2, 160000, 0), // −10000 → 2027
      ]),
    );
    expect(j.map((x) => x.jahr)).toEqual([2026, 2027]);
    expect(j[0]?.zuwachsCent).toBe(20000);
    expect(j[0]?.endVermoegenCent).toBe(120000);
    expect(j[1]?.zuwachsCent).toBe(40000);
    expect(j[1]?.endVermoegenCent).toBe(160000);
    expect(j[1]?.bester).toEqual({ monat: 1, veraenderungCent: 50000 });
  });

  it('summiert Sonderausgaben und Sondereinnahmen je Jahr', () => {
    const j = jahresstatistik(
      mit([
        m(2026, 1, 0, 0, { sonderausgabeCent: 10000 }),
        m(2026, 2, 0, 0, { sonderausgabeCent: 5000, sondereinnahmeCent: 80000 }),
        m(2027, 1, 0, 0, { sondereinnahmeCent: 20000 }),
      ]),
    );
    expect(j[0]?.sonderausgabenCent).toBe(15000);
    expect(j[0]?.sondereinnahmenCent).toBe(80000);
    expect(j[1]?.sonderausgabenCent).toBe(0);
    expect(j[1]?.sondereinnahmenCent).toBe(20000);
  });

  it('bester und schlechtester Monat bei nur einer Veränderung identisch', () => {
    const j = jahresstatistik(mit([m(2026, 1, 0, 0), m(2026, 2, 30000, 0)]));
    expect(j[0]?.bester).toEqual({ monat: 2, veraenderungCent: 30000 });
    expect(j[0]?.schlechtester).toEqual({ monat: 2, veraenderungCent: 30000 });
  });

  it('rein negatives Jahr wird nicht geschönt', () => {
    const j = jahresstatistik(mit([m(2026, 1, 500000, 0), m(2026, 2, 400000, 0), m(2026, 3, 350000, 0)]));
    expect(j[0]?.zuwachsCent).toBe(-150000);
    expect(j[0]?.schnittProMonatCent).toBe(-75000);
    expect(j[0]?.bester?.veraenderungCent).toBe(-50000);
  });

  it('alle Werte bleiben ganzzahlig', () => {
    const j = jahresstatistik(mit([m(2026, 1, 100001, 3), m(2026, 2, 200003, 7), m(2026, 3, 7, 11)]));
    for (const x of j) {
      for (const wert of [x.zuwachsCent, x.schnittProMonatCent, x.endVermoegenCent, x.sonderausgabenCent]) {
        expect(Number.isSafeInteger(wert)).toBe(true);
      }
    }
  });
});
