import { describe, expect, it } from 'vitest';
import { hochrechnung } from './hochrechnung';

describe('hochrechnung', () => {
  it('rechnet glatt auf', () => {
    // 1.000,00 € Stand, Ziel 3.000,00 €, 200,00 € pro Monat → 10 Monate
    const h = hochrechnung(100000, 300000, 20000, 2026, 8);
    expect(h.restCent).toBe(200000);
    expect(h.monate).toBe(10);
    expect(h.zielJahr).toBe(2027);
    expect(h.zielMonat).toBe(6); // 08/2026 + 10 = 06/2027
    expect(h.erreicht).toBe(false);
  });

  it('rundet angebrochene Monate auf', () => {
    // Rest 250,00 € bei 100,00 € pro Monat → 3 Monate, nicht 2,5
    const h = hochrechnung(0, 25000, 10000, 2026, 1);
    expect(h.monate).toBe(3);
    expect(h.zielMonat).toBe(4);
  });

  it('Ziel bereits erreicht', () => {
    const h = hochrechnung(500000, 300000, 20000, 2026, 8);
    expect(h.erreicht).toBe(true);
    expect(h.restCent).toBe(0);
    expect(h.monate).toBe(0);
    expect(h.zielJahr).toBe(2026);
    expect(h.zielMonat).toBe(8);
  });

  it('genau auf dem Ziel gilt als erreicht', () => {
    expect(hochrechnung(300000, 300000, 20000, 2026, 8).erreicht).toBe(true);
  });

  it('Rate 0 oder negativ ergibt kein Datum statt einer Fantasiezahl', () => {
    for (const rate of [0, -1, -50000]) {
      const h = hochrechnung(0, 300000, rate, 2026, 8);
      expect(h.monate).toBeNull();
      expect(h.zielJahr).toBeNull();
      expect(h.restCent).toBe(300000);
    }
  });

  it('kaputte Rate ergibt kein Datum', () => {
    for (const rate of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(hochrechnung(0, 300000, rate, 2026, 8).monate).toBeNull();
    }
  });

  it('absurd lange Laufzeiten werden abgeschnitten statt angezeigt', () => {
    // 1 Cent pro Monat auf 10.000 € wären 83.333 Jahre.
    const h = hochrechnung(0, 1000000, 1, 2026, 8);
    expect(h.monate).toBeNull();
    expect(h.zielJahr).toBeNull();
  });

  it('rechnet über Jahresgrenzen korrekt', () => {
    const h = hochrechnung(0, 12000, 1000, 2026, 12); // 12 Monate ab Dezember
    expect(h.monate).toBe(12);
    expect(h.zielJahr).toBe(2027);
    expect(h.zielMonat).toBe(12);
  });

  it('ein Monat Restlaufzeit', () => {
    const h = hochrechnung(0, 5000, 5000, 2026, 8);
    expect(h.monate).toBe(1);
    expect(h.zielJahr).toBe(2026);
    expect(h.zielMonat).toBe(9);
  });

  it('negativer Stand zählt als Rückstand, nicht als Fehler', () => {
    const h = hochrechnung(-50000, 100000, 30000, 2026, 1);
    expect(h.restCent).toBe(150000);
    expect(h.monate).toBe(5);
  });

  it('alle Werte bleiben ganzzahlig und endlich', () => {
    const h = hochrechnung(12345, 678901, 4321, 2026, 3);
    for (const wert of [h.restCent, h.monate, h.zielJahr, h.zielMonat]) {
      expect(Number.isSafeInteger(wert as number)).toBe(true);
    }
  });
});
