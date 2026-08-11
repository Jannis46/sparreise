/**
 * Prüft den echten Ablauf: Sicherung per Einfügen-Feld wiederherstellen,
 * dann den Anyfin-Kredit ansehen und eine Sondertilgung durchspielen.
 *
 * Start: npx vite preview --port 4174
 * Lauf:  node pruefung/kredit/ablauf.mjs [url]
 */
import { readFileSync } from 'node:fs';
import { webkit } from '@playwright/test';

const ZIEL = process.argv[2] || 'http://localhost:4174/';
const SICHERUNG = readFileSync('meine-startwerte.json', 'utf8');

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

await page.goto(ZIEL, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

console.log('\n[1] Sicherung über das Einfügen-Feld wiederherstellen');
{
  await gehZu('Daten');
  const aufklapp = page.locator('details', { hasText: /Text einfügen/i }).first();
  if ((await aufklapp.count()) === 0) {
    melde('BLOCKER', 'Einfügen-Feld fehlt', 'kein Aufklappbereich "Text einfügen"');
  } else {
    await aufklapp.locator('summary').click();
    await page.waitForTimeout(200);
    await page.locator('textarea.einfuege-feld').fill(SICHERUNG);
    await page.locator('button', { hasText: /Aus Text wiederherstellen/i }).click();
    await page.waitForTimeout(900);
    const t = await text();
    if (/Import erfolgreich/i.test(t)) ok('Import per Einfügen bestätigt');
    else melde('BLOCKER', 'Import per Einfügen ohne Erfolgsmeldung', t.slice(0, 250));
  }
}

console.log('\n[2] Zahlen nach dem Import');
{
  await gehZu('Verteil');
  for (const [was, wert] of [['Verfügbar', '560,00'], ['Tagesgeld', '210,00'], ['ETF gesamt', '150,00']]) {
    if ((await text()).includes(wert)) ok(`${was} = ${wert} €`);
    else melde('BLOCKER', `${was} nicht ${wert} €`, (await text()).slice(0, 300));
  }
}

console.log('\n[3] Anyfin-Kredit');
{
  await gehZu('Fixkosten');
  const block = page.locator('details.kredit-block').first();
  if ((await block.count()) === 0) {
    melde('BLOCKER', 'Kein Kreditbereich sichtbar', 'details.kredit-block fehlt');
  } else {
    await block.locator('summary').click();
    await page.waitForTimeout(300);
    const t = await block.innerText();
    console.log(`    ---\n${t.split('\n').map((z) => '    ' + z).join('\n')}\n    ---`);

    if (t.includes('1.500,00')) ok('Gesamtsumme 1.500,00 € (60 × 25,00 €)');
    else melde('HOCH', 'Gesamtsumme nicht 1.500,00 €', t.slice(0, 200));

    if (/60 Raten ab August 2026/i.test(t)) ok('Laufzeit und Start korrekt beschriftet');
    else melde('HOCH', 'Laufzeit/Start falsch beschriftet', t.slice(0, 200));

    if (/Juli 2031/.test(t)) ok('Voraussichtliches Ende Juli 2031');
    else melde('HOCH', 'Enddatum nicht Juli 2031', t.slice(0, 300));
  }
}

console.log('\n[4] Sondertilgung durchspielen (500,00 €)');
{
  const block = page.locator('details.kredit-block').first();
  const feld = block.locator('input[inputmode="decimal"]').first();
  await feld.fill('500,00');
  await page.waitForTimeout(400);
  const t = await block.innerText();
  console.log(`    ---\n${t.split('\n').map((z) => '    ' + z).join('\n')}\n    ---`);

  // Stand 08/2026: 1 Rate gezahlt → 1.475,00 offen. −500,00 = 975,00 → 39 Raten.
  if (t.includes('975,00')) ok('Restschuld 975,00 €');
  else melde('HOCH', 'Restschuld nicht 975,00 €', t.slice(0, 300));
  if (/20 Monate früher/.test(t)) ok('20 Monate früher fertig');
  else melde('HOCH', 'Ersparnis nicht 20 Monate', t.slice(0, 300));
  if (/November 2029/.test(t)) ok('neues Ende November 2029');
  else melde('HOCH', 'neues Ende nicht November 2029', t.slice(0, 300));

  // Durchspielen darf nichts speichern.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await gehZu('Fixkosten');
  const nachReload = page.locator('details.kredit-block').first();
  await nachReload.locator('summary').click();
  await page.waitForTimeout(300);
  const t2 = await nachReload.innerText();
  if (t2.includes('1.475,00')) ok('Durchspielen wurde NICHT gespeichert (Restschuld wieder 1.475,00 €)');
  else melde('HOCH', 'Probewert wurde ungewollt gespeichert', t2.slice(0, 250));
}

console.log('\n[5] Sondertilgung übernehmen');
{
  const block = page.locator('details.kredit-block').first();
  await block.locator('input[inputmode="decimal"]').first().fill('500,00');
  await page.waitForTimeout(300);
  await block.locator('button', { hasText: /übernehmen/i }).click();
  await page.waitForTimeout(700);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await gehZu('Fixkosten');
  const nach = page.locator('details.kredit-block').first();
  await nach.locator('summary').click();
  await page.waitForTimeout(300);
  const t = await nach.innerText();
  if (t.includes('975,00')) ok('übernommene Sondertilgung überlebt den Reload');
  else melde('BLOCKER', 'Sondertilgung nach Reload weg', t.slice(0, 300));
}

console.log('\n[6] Fehlerkanäle');
if (seitenfehler.length) melde('HOCH', 'Seitenfehler', seitenfehler.slice(0, 3).join(' | '));
else ok('keine Seitenfehler');

await browser.close();
console.log(`\n=== Kredit-Ablauf: ${befunde.length} Befunde ===`);
if (!befunde.length) console.log('  Alles in Ordnung.');
process.exit(befunde.some((b) => b.s === 'BLOCKER') ? 1 : 0);
