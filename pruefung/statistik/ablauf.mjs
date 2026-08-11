/**
 * Prüft Statistik und weitere Einnahmen gegen von Hand gerechnete Werte.
 *
 * Start: npx vite preview --port 4173
 * Lauf:  node pruefung/statistik/ablauf.mjs [url]
 */
import { webkit } from '@playwright/test';

const ZIEL = process.argv[2] || 'http://localhost:4173/';
const IDB = { name: 'sparreise', store: 'daten', schluessel: 'app' };

const befunde = [];
const melde = (s, t, d) => {
  befunde.push({ s, t, d });
  console.log(`  [${s}] ${t} — ${d}`);
};
const ok = (t) => console.log(`  ok: ${t}`);

const IDB_SCHREIBEN = ([name, store, schluessel, roh]) =>
  new Promise((fertig, fehler) => {
    const a = indexedDB.open(name, 1);
    a.onupgradeneeded = () => {
      const db = a.result;
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    };
    a.onerror = () => fehler(a.error);
    a.onsuccess = () => {
      const db = a.result;
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(JSON.parse(roh), schluessel);
      tx.oncomplete = () => {
        db.close();
        fertig(true);
      };
      tx.onerror = () => fehler(tx.error);
    };
  });

/**
 * Von Hand gerechnete Vorlage.
 *
 * Vermögen (ETF + Tagesgeld):
 *   11/2026  100000 +  50000 = 150000
 *   12/2026  120000 +  60000 = 180000   → +30000
 *   01/2027  150000 +  70000 = 220000   → +40000
 *   02/2027  140000 +  90000 = 230000   → +10000
 *   03/2027  200000 + 100000 = 300000   → +70000
 *
 * 2026: Zuwachs 30000, 2 Monate, bester = Dezember
 * 2027: Zuwachs 40000 + 10000 + 70000 = 120000, Schnitt 40000,
 *       bester März (+70000), schwächster Februar (+10000)
 * Einnahmen: Gehalt 200000 + Nebenjob 30000 = 230000
 */
const VORLAGE = JSON.stringify({
  schemaVersion: 3,
  fixkosten: [{ id: 'f1', name: 'Miete', betragCent: 100000 }],
  einnahmen: [{ id: 'e1', name: 'Nebenjob', betragCent: 30000 }],
  einstellungen: {
    einkommenCent: 200000,
    studiumCent: 20000,
    freizeitCent: 30000,
    etfZusatzCent: 5000,
    etfInFixkostenCent: 10000,
  },
  monate: [
    { id: 'm1', jahr: 2026, monat: 11, etfDepotCent: 100000, tagesgeldCent: 50000, erfasstAm: 1 },
    { id: 'm2', jahr: 2026, monat: 12, etfDepotCent: 120000, tagesgeldCent: 60000, erfasstAm: 2 },
    { id: 'm3', jahr: 2027, monat: 1, etfDepotCent: 150000, tagesgeldCent: 70000, erfasstAm: 3, sondereinnahmeCent: 45000, sondereinnahmeNotiz: 'Bonus' },
    { id: 'm4', jahr: 2027, monat: 2, etfDepotCent: 140000, tagesgeldCent: 90000, erfasstAm: 4, sonderausgabeCent: 12000, sonderausgabeNotiz: 'Reparatur' },
    { id: 'm5', jahr: 2027, monat: 3, etfDepotCent: 200000, tagesgeldCent: 100000, erfasstAm: 5 },
  ],
});

const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const seitenfehler = [];
page.on('pageerror', (e) => seitenfehler.push(e.message));
page.on('dialog', (d) => void d.accept());

const gehZu = async (name) => {
  await page.locator('nav.leiste button.leiste-knopf', { hasText: new RegExp(name, 'i') }).first().click();
  await page.waitForTimeout(300);
};

await page.goto(ZIEL, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.evaluate(IDB_SCHREIBEN, [IDB.name, IDB.store, IDB.schluessel, VORLAGE]);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);

console.log('\n[1] Weitere Einnahmen fließen ins Verfügbare');
{
  await gehZu('Verteil');
  const t = await page.evaluate(() => document.body.innerText);
  // 200000 + 30000 = 230000 Einkommen; − 100000 Fixkosten − 20000 Studium = 110000
  if (t.includes('1.100,00')) ok('Verfügbar 1.100,00 € (Gehalt + Nebenjob − Fixkosten − Studium)');
  else melde('BLOCKER', 'Verfügbar nicht 1.100,00 €', t.slice(0, 400));
  // 110000 − 30000 Freizeit − 5000 ETF-Zusatz = 75000
  if (t.includes('750,00')) ok('Tagesgeld 750,00 €');
  else melde('BLOCKER', 'Tagesgeld nicht 750,00 €', t.slice(0, 400));
}

console.log('\n[2] Einnahmen-Liste im Fixkosten-Screen');
{
  await gehZu('Fixkosten');
  const t = await page.evaluate(() => document.body.innerText);
  if (/Weitere Einnahmen/i.test(t) && t.includes('300,00')) ok('Nebenjob 300,00 € wird gezeigt');
  else melde('HOCH', 'Einnahmen-Liste fehlt oder falsch', t.slice(0, 400));
  if (t.includes('2.300,00')) ok('Einnahmen gesamt 2.300,00 €');
  else melde('HOCH', 'Einnahmen-Summe nicht 2.300,00 €', t.slice(0, 400));
}

console.log('\n[3] Jahresstatistik');
{
  await gehZu('Statistik');
  const t = await page.evaluate(() => document.body.innerText);
  console.log(`    ---\n${t.split('\n').slice(0, 40).map((z) => '    ' + z).join('\n')}\n    ---`);

  const pruefe = (name, muster) => {
    if (muster.test(t)) ok(name);
    else melde('HOCH', name + ' fehlt', String(muster));
  };
  pruefe('Jahr 2026 vorhanden', /2026/);
  pruefe('Jahr 2027 vorhanden', /2027/);
  pruefe('Zuwachs 2026 = +300,00 €', /\+300,00/);
  pruefe('Zuwachs 2027 = +1\\.200,00 €', /\+1\.200,00/);
  pruefe('Schnitt 2027 = +400,00 €', /\+400,00/);
  pruefe('Bester Monat März +700,00 €', /Bester Monat — März/);
  pruefe('Schwächster Monat Februar', /Schwächster Monat — Februar/);
  pruefe('Sondereinnahmen 450,00 €', /Sondereinnahmen/);
  pruefe('Sonderausgaben 120,00 €', /Sonderausgaben/);
  if (/NaN|Infinity|undefined/.test(t)) melde('BLOCKER', 'Kaputter Wert in der Statistik', t.slice(0, 300));
  else ok('kein NaN/Infinity/undefined');
}

console.log('\n[4] Monatsdetails aufklappen');
{
  const eintrag = page.locator('details.monats-eintrag').first();
  const anzahl = await page.locator('details.monats-eintrag').count();
  if (anzahl !== 5) melde('HOCH', 'Nicht alle Monate gelistet', `${anzahl} statt 5`);
  else ok('5 Monate gelistet');

  await eintrag.locator('summary').click();
  await page.waitForTimeout(250);
  const t = await eintrag.innerText();
  console.log(`    ---\n${t.split('\n').map((z) => '    ' + z).join('\n')}\n    ---`);
  // Neuester Monat oben: März 2027, +700,00 €, ETF +600,00, Tagesgeld +100,00
  if (/März 2027/.test(t)) ok('neuester Monat steht oben');
  else melde('HOCH', 'Reihenfolge falsch', t.slice(0, 200));
  if (/\+600,00/.test(t)) ok('ETF-Veränderung +600,00 €');
  else melde('HOCH', 'ETF-Veränderung falsch', t.slice(0, 250));
  if (/\+100,00/.test(t)) ok('Tagesgeld-Veränderung +100,00 €');
  else melde('HOCH', 'Tagesgeld-Veränderung falsch', t.slice(0, 250));
  // 70000 / 230000 = 30,4 % → gerundet 30 %
  if (/30 %/.test(t)) ok('Anteil am Monatseinkommen 30 %');
  else melde('HOCH', 'Quote nicht 30 %', t.slice(0, 250));
}

console.log('\n[5] Kein horizontales Scrollen auf dem neuen Screen');
{
  for (const breite of [390, 320]) {
    await page.setViewportSize({ width: breite, height: 844 });
    await page.waitForTimeout(300);
    const [sw, cw] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    if (sw > cw + 1) melde('BLOCKER', 'Horizontales Scrollen', `Statistik @ ${breite}px: ${sw} > ${cw}`);
    else ok(`${breite}px sauber`);
  }
}

console.log('\n[6] Fehlerkanäle');
if (seitenfehler.length) melde('HOCH', 'Seitenfehler', seitenfehler.slice(0, 3).join(' | '));
else ok('keine Seitenfehler');

await browser.close();
console.log(`\n=== Statistik: ${befunde.length} Befunde ===`);
if (!befunde.length) console.log('  Alles in Ordnung.');
process.exit(befunde.some((b) => b.s === 'BLOCKER') ? 1 : 0);
