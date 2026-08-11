import { describe, expect, it } from 'vitest';
import { FIXKOSTEN_START_ANZAHL, neueId, startDaten } from './types';

describe('startDaten', () => {
  it('hat 17 Fixkostenposten in fachlich fester Reihenfolge', () => {
    const d = startDaten();
    expect(d.fixkosten).toHaveLength(FIXKOSTEN_START_ANZAHL);
    expect(d.fixkosten[0]?.name).toBe('Miete');
    expect(d.fixkosten[16]?.name).toBe('Friseur');
  });

  it('enthält keine Beträge — die trägt der Nutzer selbst ein', () => {
    // Datenschutz: im öffentlichen Repository stehen nur die Kategorien.
    const d = startDaten();
    for (const p of d.fixkosten) expect(p.betragCent).toBe(0);
    expect(d.einstellungen.einkommenCent).toBe(0);
    expect(d.einstellungen.studiumCent).toBe(0);
  });

  it('alle Beträge sind Cent-Integer', () => {
    for (const p of startDaten().fixkosten) {
      expect(Number.isInteger(p.betragCent)).toBe(true);
    }
  });

  it('vergibt eindeutige IDs', () => {
    const ids = new Set(startDaten().fixkosten.map((p) => p.id));
    expect(ids.size).toBe(FIXKOSTEN_START_ANZAHL);
  });
});

describe('neueId', () => {
  it('liefert eindeutige, nicht leere IDs', () => {
    const menge = new Set(Array.from({ length: 500 }, () => neueId()));
    expect(menge.size).toBe(500);
    for (const id of menge) expect(id.length).toBeGreaterThan(8);
  });
});

