import { defineConfig } from 'vitest/config';

// Eigene Konfiguration für die unabhängigen Prüfskripte.
// Die Haupt-Konfiguration sammelt nur `src/**/*.test.ts` ein — die Prüfung
// soll bewusst getrennt laufen und nicht Teil der normalen Testsuite sein.
// `root` bleibt bewusst weg: Vitest löst ihn gegen das Arbeitsverzeichnis auf,
// und die Skripte werden immer aus dem Projektwurzelverzeichnis gestartet.
export default defineConfig({
  test: {
    include: ['pruefung/**/*.test.ts'],
  },
});
