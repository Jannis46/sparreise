/**
 * Prüft, dass die Aufstellung live mitrechnet — beim Tippen, ohne Speichern,
 * ohne Neuladen, und über Screens hinweg.
 *
 * Start: npx vite preview --port 4175
 * Lauf:  node pruefung/live-rechnung/ablauf.mjs [url]
 */
import { webkit } from '@playwright/test';

const ZIEL = process.argv[2] || 'http://localhost:4175/';
const befunde = [];
const melde = (s, t, d) => {
  befunde.push({ s, t, d });
  console.log(`  [${s}] ${t} — ${d}`);
};
const ok = (t) => console.log(`  ok: ${t}`);

const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const seitenfehler = [];
page.on('pageerror', (e) => seitenfehler.push(e.message));
page.on('dialog', (d) => void d.accept());

const gehZu = async (name) => {
  await page.locator('nav.leiste button.leiste-knopf', { hasText: new RegExp(name, 'i') }).first().click();
  await page.waitForTimeout(250);
};
const text = () => page.evaluate(() => document.body.innerText);
const zeigt = async (wert) => (await text()).includes(wert);

await page.goto(ZIEL, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

console.log('\n[1] Grundwerte eintragen');
{
  await gehZu('Fixkosten');
  // Einkommen 2.000,00 · erste Fixkostenposition 1.000,00 · Studium 200,00
  await page.getByLabel(/Netto-Einkommen/i).first().fill('2.000,00');
  await page.getByLabel(/Netto-Einkommen/i).first().blur();
  await page.getByLabel(/Studiengebühren/i).first().fill('200,00');
  await page.getByLabel(/Studiengebühren/i).first().blur();

  // Erstes Betragsfeld der Fixkostenliste (nach Einkommen/Studium kommt die Liste
  // im DOM davor — deshalb gezielt über die Postenliste).
  const fixFeld = page.locator('.karte-fixkosten input[inputmode="decimal"]').first();
  await fixFeld.fill('1.000,00');
  await fixFeld.blur();
  await page.waitForTimeout(400);

  if (await zeigt('800,00')) ok('Verfügbar 800,00 € (2.000 − 1.000 − 200)');
  else melde('BLOCKER', 'Verfügbar nicht 800,00 €', (await text()).slice(0, 400));
}

console.log('\n[2] Invest steht in der Aufstellung');
{
  const t = await text();
  if (/−\s*Invest \(3 Posten\)/.test(t)) ok('Zeile „− Invest (3 Posten)" vorhanden');
  else melde('BLOCKER', 'Invest fehlt in der Aufstellung', t.slice(0, 500));
  if (/Für Freizeit & Sonstiges/.test(t)) ok('Zeile „Für Freizeit & Sonstiges" vorhanden');
  else melde('HOCH', 'Schlusszeile fehlt', t.slice(0, 500));
}

console.log('\n[3] Anlage eintragen — rechnet live mit, ohne Neuladen');
{
  // Drittletzte Postenliste ist die Invest-Liste (Fixkosten, Einnahmen, Invest).
  const investListe = page.locator('.karte-invest');
  const felder = investListe.locator('input[inputmode="decimal"]');
  const anzahl = await felder.count();
  if (anzahl < 3) {
    melde('BLOCKER', 'Invest-Liste hat zu wenige Felder', `${anzahl}`);
  } else {
    await felder.nth(0).fill('50,00');
    await felder.nth(0).blur();
    await felder.nth(1).fill('50,00');
    await felder.nth(1).blur();
    await felder.nth(2).fill('50,00');
    await felder.nth(2).blur();
    await page.waitForTimeout(400);

    const t = await text();
    // 800,00 − 150,00 = 650,00 für Freizeit & Rücklage
    if (t.includes('150,00')) ok('Invest-Summe 150,00 €');
    else melde('BLOCKER', 'Invest-Summe nicht 150,00 €', t.slice(0, 500));
    if (t.includes('650,00')) ok('Für Freizeit & Sonstiges 650,00 € — ohne Neuladen aktualisiert');
    else melde('BLOCKER', 'Schlusszeile nicht 650,00 €', t.slice(0, 500));
  }
}

console.log('\n[3b] Sparen als eigene Kachel');
{
  const sparListe = page.locator('.karte-sparen');
  const felder = sparListe.locator('input[inputmode="decimal"]');
  const anzahl = await felder.count();
  if (anzahl < 2) {
    melde('BLOCKER', 'Sparen-Kachel hat zu wenige Felder', `${anzahl}`);
  } else {
    await felder.nth(0).fill('200,00');
    await felder.nth(0).blur();
    await felder.nth(1).fill('100,00');
    await felder.nth(1).blur();
    await page.waitForTimeout(400);

    const t = await text();
    if (/−\s*Sparen \(2 Posten\)/.test(t)) ok('Zeile „− Sparen (2 Posten)" in der Aufstellung');
    else melde('BLOCKER', 'Sparen fehlt in der Aufstellung', t.slice(0, 600));
    if (t.includes('300,00')) ok('Rücklage-Summe 300,00 €');
    else melde('BLOCKER', 'Rücklage-Summe nicht 300,00 €', t.slice(0, 600));
    // 800 − 150 Invest − 300 Sparen = 350
    if (t.includes('350,00')) ok('Für Freizeit & Sonstiges 350,00 € — Sparen zieht ab');
    else melde('BLOCKER', 'Schlusszeile berücksichtigt Sparen nicht', t.slice(0, 600));

    // Wieder zurücksetzen, damit die folgenden Erwartungen stimmen.
    await felder.nth(0).fill('0,00');
    await felder.nth(0).blur();
    await felder.nth(1).fill('0,00');
    await felder.nth(1).blur();
    await page.waitForTimeout(400);
  }
}

console.log('\n[4] Grundlegende Änderung schlägt überall durch');
{
  // Einkommen verdoppeln — ohne Speichern-Knopf, ohne Reload.
  await page.getByLabel(/Netto-Einkommen/i).first().fill('4.000,00');
  await page.getByLabel(/Netto-Einkommen/i).first().blur();
  await page.waitForTimeout(400);

  const t = await text();
  // 4000 − 1000 − 200 = 2800 verfügbar; − 150 Invest = 2650
  if (t.includes('2.800,00')) ok('Verfügbar sofort 2.800,00 €');
  else melde('BLOCKER', 'Verfügbar nicht mitgezogen', t.slice(0, 500));
  if (t.includes('2.650,00')) ok('Für Freizeit & Sonstiges sofort 2.650,00 €');
  else melde('BLOCKER', 'Schlusszeile nicht mitgezogen', t.slice(0, 500));

  // Und auf dem Verteilungs-Screen ebenso.
  await gehZu('Verteil');
  const v = await text();
  if (v.includes('2.800,00')) ok('Verteilungs-Screen zeigt dasselbe Verfügbar');
  else melde('BLOCKER', 'Verteilung nicht mitgezogen', v.slice(0, 400));
  if (v.includes('150,00')) ok('Verteilungs-Screen zeigt Invest 150,00 €');
  else melde('HOCH', 'Verteilung zeigt Invest nicht', v.slice(0, 400));
}

console.log('\n[5] Nach Neuladen weiterhin korrekt');
{
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await gehZu('Fixkosten');
  const t = await text();
  if (t.includes('2.800,00') && t.includes('2.650,00')) ok('Werte überleben den Reload');
  else melde('BLOCKER', 'Werte nach Reload falsch', t.slice(0, 500));
}

console.log('\n[6] Fehlerkanäle');
if (seitenfehler.length) melde('HOCH', 'Seitenfehler', seitenfehler.slice(0, 3).join(' | '));
else ok('keine Seitenfehler');

await browser.close();
console.log(`\n=== Live-Rechnung: ${befunde.length} Befunde ===`);
if (!befunde.length) console.log('  Alles rechnet live mit.');
process.exit(befunde.some((b) => b.s === 'BLOCKER') ? 1 : 0);
