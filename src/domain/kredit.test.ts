import { describe, expect, it } from 'vitest';
import { kreditstand, monatsAbstand, plusMonate } from './kredit';
import type { Fixkostenposten } from './types';

/** Anyfin-Fall: 25,00 € Rate, 60 Raten ab 08/2026 → 1.500,00 € gesamt. */
const anyfin = (sondertilgungCent = 0): Fixkostenposten => ({
  id: 'anyfin',
  name: 'Anyfin',
  betragCent: 2500,
  kredit: { laufzeitMonate: 60, startJahr: 2026, startMonat: 8, sondertilgungCent },
});

describe('monatsAbstand / plusMonate', () => {
  it('rechnet über Jahresgrenzen', () => {
    expect(monatsAbstand(2026, 8, 2026, 8)).toBe(0);
    expect(monatsAbstand(2026, 8, 2027, 8)).toBe(12);
    expect(monatsAbstand(2026, 12, 2027, 1)).toBe(1);
    expect(monatsAbstand(2027, 1, 2026, 12)).toBe(-1);
  });

  it('plusMonate ist Umkehrung', () => {
    expect(plusMonate(2026, 8, 0)).toEqual({ jahr: 2026, monat: 8 });
    expect(plusMonate(2026, 8, 59)).toEqual({ jahr: 2031, monat: 7 });
    expect(plusMonate(2026, 12, 1)).toEqual({ jahr: 2027, monat: 1 });
    expect(plusMonate(2026, 1, -1)).toEqual({ jahr: 2025, monat: 12 });
  });
});

describe('kreditstand — Anyfin ohne Sondertilgung', () => {
  it('vor der ersten Rate ist noch nichts gezahlt', () => {
    const s = kreditstand(anyfin(), 2026, 7)!;
    expect(s.nochNichtGestartet).toBe(true);
    expect(s.gezahlteRaten).toBe(0);
    expect(s.gesamtCent).toBe(150000); // 60 × 25,00 €
    expect(s.restschuldCent).toBe(150000);
    expect(s.verbleibendeRaten).toBe(60);
  });

  it('im Startmonat ist die erste Rate fällig', () => {
    const s = kreditstand(anyfin(), 2026, 8)!;
    expect(s.gezahlteRaten).toBe(1);
    expect(s.restschuldCent).toBe(147500);
    expect(s.verbleibendeRaten).toBe(59);
    // Letzte Rate: 08/2026 + 59 Monate = 07/2031
    expect(s.endeJahr).toBe(2031);
    expect(s.endeMonat).toBe(7);
  });

  it('nach 12 Raten sind 300,00 € getilgt', () => {
    const s = kreditstand(anyfin(), 2027, 7)!;
    expect(s.gezahlteRaten).toBe(12);
    expect(s.gezahltCent).toBe(30000);
    expect(s.restschuldCent).toBe(120000);
    expect(s.verbleibendeRaten).toBe(48);
    expect(s.endeJahr).toBe(2031);
    expect(s.endeMonat).toBe(7);
  });

  it('läuft im letzten Monat aus', () => {
    const s = kreditstand(anyfin(), 2031, 7)!;
    expect(s.gezahlteRaten).toBe(60);
    expect(s.restschuldCent).toBe(0);
    expect(s.abbezahlt).toBe(true);
    expect(s.verbleibendeRaten).toBe(0);
    expect(s.endeJahr).toBeNull();
  });

  it('zählt nach dem Ende nicht weiter', () => {
    const s = kreditstand(anyfin(), 2040, 1)!;
    expect(s.gezahlteRaten).toBe(60);
    expect(s.gezahltCent).toBe(150000);
    expect(s.abbezahlt).toBe(true);
  });
});

describe('kreditstand — Sondertilgung', () => {
  it('500,00 € Sondertilgung verkürzt um 20 Raten', () => {
    // Stand 08/2026: 1 Rate gezahlt, 1.475,00 € offen. Minus 500,00 € = 975,00 €.
    // 975,00 / 25,00 = 39 Raten statt 59 → 20 Monate früher fertig.
    const s = kreditstand(anyfin(50000), 2026, 8)!;
    expect(s.sondertilgungCent).toBe(50000);
    expect(s.restschuldCent).toBe(97500);
    expect(s.verbleibendeRaten).toBe(39);
    expect(s.ersparteMonate).toBe(20);
    // 08/2026 + 1 + 39 − 1 = 11/2029
    expect(s.endeJahr).toBe(2029);
    expect(s.endeMonat).toBe(11);
  });

  it('krumme Sondertilgung ergibt eine kleinere letzte Rate', () => {
    // 1.475,00 − 100,00 = 1.375,00 → 55 Raten, letzte 25,00 (geht glatt auf)
    const glatt = kreditstand(anyfin(10000), 2026, 8)!;
    expect(glatt.verbleibendeRaten).toBe(55);
    expect(glatt.letzteRateCent).toBe(2500);

    // 1.475,00 − 110,00 = 1.365,00 → 55 Raten, letzte 15,00
    const krumm = kreditstand(anyfin(11000), 2026, 8)!;
    expect(krumm.restschuldCent).toBe(136500);
    expect(krumm.verbleibendeRaten).toBe(55);
    expect(krumm.letzteRateCent).toBe(1500);
  });

  it('Sondertilgung über der Restschuld tilgt vollständig, ohne negativ zu werden', () => {
    const s = kreditstand(anyfin(999999999), 2026, 8)!;
    expect(s.restschuldCent).toBe(0);
    expect(s.abbezahlt).toBe(true);
    expect(s.verbleibendeRaten).toBe(0);
    expect(s.letzteRateCent).toBe(0);
    expect(s.endeJahr).toBeNull();
  });

  it('Durchspielen ändert den gespeicherten Wert nicht', () => {
    const posten = anyfin(0);
    const probe = kreditstand(posten, 2026, 8, 50000)!;
    expect(probe.restschuldCent).toBe(97500);
    // Der Posten selbst bleibt unberührt.
    expect(posten.kredit?.sondertilgungCent).toBe(0);
    const echt = kreditstand(posten, 2026, 8)!;
    expect(echt.restschuldCent).toBe(147500);
  });

  it('negative Sondertilgung wird als 0 behandelt', () => {
    const s = kreditstand(anyfin(-50000), 2026, 8)!;
    expect(s.sondertilgungCent).toBe(0);
    expect(s.restschuldCent).toBe(147500);
  });
});

describe('kreditstand — Randfälle', () => {
  it('ohne Kreditangaben null', () => {
    expect(kreditstand({ id: 'a', name: 'Miete', betragCent: 70000 }, 2026, 8)).toBeNull();
  });

  it('unsinnige Laufzeit oder Startmonat ergibt null', () => {
    const kaputt = (k: Partial<NonNullable<Fixkostenposten['kredit']>>): Fixkostenposten => ({
      id: 'x',
      name: 'x',
      betragCent: 2500,
      kredit: { laufzeitMonate: 60, startJahr: 2026, startMonat: 8, sondertilgungCent: 0, ...k },
    });
    expect(kreditstand(kaputt({ laufzeitMonate: 0 }), 2026, 8)).toBeNull();
    expect(kreditstand(kaputt({ laufzeitMonate: -5 }), 2026, 8)).toBeNull();
    expect(kreditstand(kaputt({ startMonat: 0 }), 2026, 8)).toBeNull();
    expect(kreditstand(kaputt({ startMonat: 13 }), 2026, 8)).toBeNull();
    expect(kreditstand(kaputt({ laufzeitMonate: Number.NaN }), 2026, 8)).toBeNull();
  });

  it('Rate 0 kippt die Rechnung nicht', () => {
    const s = kreditstand(
      { id: 'x', name: 'x', betragCent: 0, kredit: { laufzeitMonate: 60, startJahr: 2026, startMonat: 8, sondertilgungCent: 0 } },
      2026,
      8,
    )!;
    expect(s.gesamtCent).toBe(0);
    expect(s.restschuldCent).toBe(0);
    expect(s.verbleibendeRaten).toBe(0);
    expect(Number.isFinite(s.letzteRateCent)).toBe(true);
  });

  it('negative Rate wird als Betrag gelesen', () => {
    const s = kreditstand(
      { id: 'x', name: 'x', betragCent: -2500, kredit: { laufzeitMonate: 60, startJahr: 2026, startMonat: 8, sondertilgungCent: 0 } },
      2026,
      8,
    )!;
    expect(s.gesamtCent).toBe(150000);
  });

  it('alle Werte bleiben endlich und ganzzahlig', () => {
    for (const sonder of [0, 1, 99999, 150000, 150001]) {
      const s = kreditstand(anyfin(sonder), 2027, 3)!;
      for (const wert of [s.gesamtCent, s.restschuldCent, s.gezahltCent, s.letzteRateCent, s.verbleibendeRaten, s.ersparteMonate]) {
        expect(Number.isSafeInteger(wert)).toBe(true);
        expect(wert).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
