/**
 * Prüft die veröffentlichte App unter GitHub Pages in WebKit.
 *
 * Lauf: node pruefung/live/pruefe-live.mjs [url]
 */
import { webkit } from '@playwright/test';

const ZIEL = process.argv[2] || 'https://jannis46.github.io/sparreise/';
const befunde = [];
const melde = (s, t, d) => {
  befunde.push({ s, t, d });
  console.log(`  [${s}] ${t} — ${d}`);
};
const ok = (t) => console.log(`  ok: ${t}`);

const browser = await webkit.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
const seitenfehler = [];
const konsolenfehler = [];
const fehlgeschlagen = [];
page.on('pageerror', (e) => seitenfehler.push(e.message));
page.on('console', (m) => m.type() === 'error' && konsolenfehler.push(m.text()));
page.on('requestfailed', (r) => fehlgeschlagen.push(`${r.url()} — ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.status() >= 400) fehlgeschlagen.push(`${r.status()} ${r.url()}`);
});
page.on('dialog', (d) => void d.accept());

console.log(`\nPrüfe ${ZIEL}\n`);
console.log('[1] Laden');
await page.goto(ZIEL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1200);

const tabs = await page.locator('nav.leiste button.leiste-knopf').count();
if (tabs === 0) melde('BLOCKER', 'App rendert nicht', 'keine Navigation gefunden');
else ok(`App lädt, ${tabs} Screens`);

if (fehlgeschlagen.length) melde('BLOCKER', 'Ressourcen fehlen (Pfadproblem?)', fehlgeschlagen.slice(0, 4).join(' | '));
else ok('alle Ressourcen geladen — Unterpfad stimmt');

console.log('\n[2] Manifest und Icons');
{
  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
  const basis = new URL(manifestHref, ZIEL).href;
  const antwort = await page.request.get(basis);
  if (!antwort.ok()) {
    melde('BLOCKER', 'Manifest nicht erreichbar', `${antwort.status()} ${basis}`);
  } else {
    const m = await antwort.json();
    ok(`Manifest geladen: name="${m.name}", display=${m.display}`);
    if (m.display !== 'standalone') melde('HOCH', 'Kein Vollbildmodus', `display=${m.display}`);
    for (const icon of m.icons || []) {
      const iconUrl = new URL(icon.src, basis).href;
      const ia = await page.request.get(iconUrl);
      if (!ia.ok()) melde('BLOCKER', 'Icon fehlt', `${ia.status()} ${iconUrl}`);
      else {
        const puffer = await ia.body();
        const istPng = puffer[0] === 0x89 && puffer.toString('latin1', 1, 4) === 'PNG';
        const breite = istPng ? puffer.readUInt32BE(16) : 0;
        const farbtyp = istPng ? puffer[25] : -1;
        if (!istPng) melde('BLOCKER', 'Icon ist kein gültiges PNG', iconUrl);
        else ok(`${icon.sizes} ${icon.purpose || 'any'}: ${breite}px, Farbtyp ${farbtyp}${farbtyp === 2 ? ' (ohne Alpha — richtig für iOS)' : ''}`);
      }
    }
  }
  // apple-touch-icon separat: das nimmt iOS für den Home-Bildschirm.
  const appleHref = await page.getAttribute('link[rel="apple-touch-icon"]', 'href').catch(() => null);
  if (!appleHref) melde('HOCH', 'Kein apple-touch-icon verlinkt', 'iOS zeigt sonst einen Screenshot als Symbol');
  else {
    const a = await page.request.get(new URL(appleHref, ZIEL).href);
    const p = a.ok() ? await a.body() : null;
    if (!p) melde('BLOCKER', 'apple-touch-icon nicht erreichbar', appleHref);
    else {
      const groesse = p.readUInt32BE(16);
      const farbtyp = p[25];
      if (farbtyp === 6 || farbtyp === 4) {
        melde('HOCH', 'apple-touch-icon hat Alphakanal', 'iOS hinterlegt transparente Home-Symbole schwarz');
      } else ok(`apple-touch-icon: ${groesse}×${groesse}, ohne Alphakanal`);
    }
  }
}

console.log('\n[3] Eintrag speichern und neu laden');
{
  await page.locator('nav.leiste button.leiste-knopf', { hasText: /Erfassen/i }).first().click();
  await page.waitForTimeout(300);
  await page.getByLabel('ETF-Depotwert (Trade Republic)').fill('1.234,56');
  await page.getByLabel('Tagesgeld gesamt').fill('987,65');
  await page.locator('button', { hasText: /speichern/i }).first().click();
  await page.waitForTimeout(900);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const text = await page.evaluate(() => document.body.innerText);
  if (text.includes('1.234,56') || text.includes('2.222,21')) ok('Eintrag überlebt den Reload');
  else {
    await page.locator('nav.leiste button.leiste-knopf', { hasText: /Erfassen/i }).first().click();
    await page.waitForTimeout(400);
    const wert = await page.getByLabel('ETF-Depotwert (Trade Republic)').inputValue();
    if (wert.includes('1.234,56')) ok('Eintrag überlebt den Reload');
    else melde('BLOCKER', 'Eintrag nach Reload weg', `Feld zeigt "${wert}"`);
  }
}

console.log('\n[4] Darstellung bei 390 px');
{
  const anzahl = await page.locator('nav.leiste button.leiste-knopf').count();
  let verstoesse = 0;
  for (let i = 0; i < anzahl; i++) {
    await page.locator('nav.leiste button.leiste-knopf').nth(i).click();
    await page.waitForTimeout(200);
    const [sw, cw] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    if (sw > cw + 1) {
      verstoesse++;
      melde('BLOCKER', 'Horizontales Scrollen live', `Screen ${i + 1}: ${sw} > ${cw}`);
    }
  }
  if (!verstoesse) ok(`kein horizontales Scrollen auf ${anzahl} Screens`);
}

// Ab hier wird absichtlich offline geschaltet — die dabei entstehenden
// Netzwerkfehler sind erwartet und dürfen nicht als App-Fehler gezählt werden.
const fehlerVorOffline = konsolenfehler.length;

console.log('\n[5] Service Worker und Offline');
{
  const swAktiv = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'nicht unterstützt';
    const r = await navigator.serviceWorker.getRegistration();
    return r ? (r.active ? 'aktiv' : 'registriert, nicht aktiv') : 'keine Registrierung';
  });
  if (swAktiv === 'aktiv') ok('Service Worker aktiv');
  else melde('HOCH', 'Service Worker nicht aktiv', swAktiv);

  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1500);
  const offlineTabs = await page.locator('nav.leiste button.leiste-knopf').count();
  if (offlineTabs > 0) ok('App startet offline');
  else melde('BLOCKER', 'App startet offline nicht', 'keine Navigation nach Offline-Reload');
  await ctx.setOffline(false);
}

console.log('\n[6] Fehlerkanäle');
if (seitenfehler.length) melde('HOCH', 'Seitenfehler', seitenfehler.slice(0, 3).join(' | '));
else ok('keine Seitenfehler');
const echteFehler = konsolenfehler.slice(0, fehlerVorOffline);
const offlineFehler = konsolenfehler.length - fehlerVorOffline;
if (echteFehler.length) melde('MITTEL', 'Konsolenfehler im Normalbetrieb', echteFehler.slice(0, 3).join(' | '));
else ok(`keine Konsolenfehler im Normalbetrieb (${offlineFehler} erwartete beim Offline-Test)`);

await browser.close();

console.log(`\n=== Live-Prüfung: ${befunde.length} Befunde ===`);
for (const s of ['BLOCKER', 'HOCH', 'MITTEL']) {
  const t = befunde.filter((b) => b.s === s);
  if (t.length) console.log(`  ${s}: ${t.length}`);
}
if (!befunde.length) console.log('  Alles in Ordnung.');
process.exit(befunde.some((b) => b.s === 'BLOCKER') ? 1 : 0);
