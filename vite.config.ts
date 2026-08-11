import { defineConfig } from 'vitest/config';

// Statt @types/node als Abhängigkeit zu schleppen, nur das eine Feld deklarieren, das wir brauchen.
declare const process: { env: Record<string, string | undefined> };

// base ist über die Umgebungsvariable SPARREISE_BASE konfigurierbar,
// damit derselbe Build sowohl unter "/" als auch unter "/<repo>/" (GitHub Pages) läuft.
// Beispiel: SPARREISE_BASE=/sparreise/ npm run build
export default defineConfig({
  base: process.env.SPARREISE_BASE || '/',
  build: {
    target: ['es2020', 'safari15'],
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
