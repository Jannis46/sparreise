/**
 * Regressionsprüfung: komplette Nutzerflüsse end-to-end in WebKit bei 390×844.
 *
 * Deckt die Lücke, die `pruefung/adversarial/angriff.mjs` offen lässt:
 * Monat erfassen, korrigieren, löschen, Etappen überschreiten, zurücksetzen.
 *
 * Start:  npx vite preview --port 4174
 * Lauf:   node pruefung/regression/fluesse.mjs
 */
import { webkit } from '@playwright/test';

const URL = 'http://localhost:4174/';
const IDB = { name: 'sparreise', store: 'daten', schluessel: 'app' };

const befunde = [];
const melde = (stufe, titel, detail) => {
  befunde.push({ stufe, titel, detail });
  console.log(`  [${stufe}] ${titel} — ${detail}`);
};
const ok = (t) => console.log(`  ok: ${t}`);

/** Datensatz direkt aus der IndexedDB lesen — die Anzeige kann vom Speicher abweichen. */
const IDB_LESEN = ([name, store, schluessel]) =>
  new Promise((fertig) => {
    const a = indexedDB.open(name, 1);
    a.onupgradeneeded = () => {
      const db = a.result;
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    };
    a.onerror = () => fertig(null);
    a.onsuccess = () => {
      const db = a.result;
      let tx;
      try {
        tx = db.transaction(store, 'readonly');
      } catch {
        db.close();
        return fertig(null);
      }
      const g = tx.objectStore(store).get(schluessel);
      g.onsuccess = () => {
        const w = g.result;
        db.close();
        fertig(w === undefined ? null : w);
      };
      g.onerror = () => {
        db.close();
        fertig(null);
      };
    };
  });

const browser = await webkit.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();

const seitenfehler = [];
const konsolenfehler = [];
page.on('pageerror', (e) => seitenfehler.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') konsolenfehler.push(m.text());
});
// Rückfragen bestätigen und mitzählen — ein Löschen ohne Rückfrage wäre ein Befund.
const dialoge = { anzahl: 0 };
page.on('dialog', (d) => {
  dialoge.anzahl += 1;
  void d.accept();
});

const daten = () => page.evaluate(IDB_LESEN, [IDB.name, IDB.store, IDB.schluessel]);
const gehZu = async (name) => {
  await page.locator('nav.leiste button.leiste-knopf', { hasText: new RegExp(name, 'i') }).first().click();
  await page.waitForTimeout(250);
};
const seitentext = () => page.evaluate(() => document.body.innerText);
/** Zahl im deutschen Format im Text finden, z. B. "560,00". */
const zeigt = async (muster) => (await seitentext()).includes(muster);

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// ───────────────────────────── Fluss 1: Ersteinrichtung
console.log('\n[1] Ersteinrichtung');
{
  const d = await daten();
  if (!d) {
    // Kein Befund: die App schreibt beim ersten Start bewusst nichts, sondern erst
    // bei der ersten Änderung. Die Startwerte sind im Code, nicht im Speicher —
    // es kann also nichts verloren gehen, was noch gar nicht existiert.
    ok('erster Start schreibt noch nichts (Startwerte kommen aus dem Code)');
  } else {
    if (d.fixkosten?.length !== 17) {
      melde('BLOCKER', 'Falsche Anzahl Fixkosten', `erwartet 17, tatsächlich ${d.fixkosten?.length}`);
    } else ok('17 Fixkostenkategorien angelegt');
  }

  // Die Startdaten sind bewusst leer (Datenschutz). Deshalb prüft dieser Fluss
  // die echte Ersteinrichtung: Zahlen eintragen und nachrechnen lassen.
  await gehZu('Fixkosten');
  const felder = page.locator('input[inputmode="decimal"]');
  const anzahlFelder = await felder.count();
  if (anzahlFelder < 3) {
    melde('BLOCKER', 'Fixkosten-Screen zeigt keine Eingabefelder', `${anzahlFelder} Felder`);
  } else {
    // Erste Position auf 1.000,00 €, Einkommen und Studium über ihre Labels.
    await felder.first().fill('1.000,00');
    await felder.first().blur();
    await page.getByLabel(/Netto|Einkommen/i).first().fill('2.000,00');
    await page.getByLabel(/Netto|Einkommen/i).first().blur();
    await page.getByLabel(/Studium|Studiengebühr/i).first().fill('200,00');
    await page.getByLabel(/Studium|Studiengebühr/i).first().blur();
    await page.waitForTimeout(400);

    await gehZu('Verteil');
    // Handrechnung: 2000,00 − (1000,00 + 200,00) = 800,00 Verfügbar
    //               800,00 − 300,00 − 50,00 = 450,00 Tagesgeld
    //               100,00 + 50,00 = 150,00 ETF gesamt
    for (const [was, wert] of [
      ['Verfügbar', '800,00'],
      ['Tagesgeld', '450,00'],
      ['ETF gesamt', '150,00'],
    ]) {
      if (await zeigt(wert)) ok(`${was} zeigt ${wert} €`);
      else melde('BLOCKER', `${was} nicht als ${wert} € angezeigt`, (await seitentext()).slice(0, 300));
    }
  }
}

// ───────────────────────────── Fluss 2: mehrere Monate erfassen
console.log('\n[2] Vier Monate erfassen');
const monatsWerte = [
  { monat: 1, etf: '1.200,00', tg: '800,00', etfC: 120000, tgC: 80000 },
  { monat: 2, etf: '1.450,50', tg: '950,00', etfC: 145050, tgC: 95000 },
  { monat: 3, etf: '1.700,00', tg: '1.100,25', etfC: 170000, tgC: 110025 },
  { monat: 4, etf: '2.050,00', tg: '1.400,00', etfC: 205000, tgC: 140000 },
];
{
  for (const m of monatsWerte) {
    await gehZu('Erfassen');
    await page.selectOption('#wahl-monat', String(m.monat));
    await page.getByLabel('ETF-Depotwert (Trade Republic)').fill(m.etf);
    await page.getByLabel('Tagesgeld gesamt').fill(m.tg);
    // Der Knopf heißt bei einem bestehenden Monat "Änderung speichern".
    await page.locator('button', { hasText: /speichern/i }).first().click();
    await page.waitForTimeout(400);
  }
  const d = await daten();
  if (d?.monate?.length !== 4) {
    melde('BLOCKER', 'Nicht alle Monate gespeichert', `erwartet 4, tatsächlich ${d?.monate?.length}`);
  } else {
    const falsch = monatsWerte.filter((m) => {
      const e = d.monate.find((x) => x.monat === m.monat);
      return !e || e.etfDepotCent !== m.etfC || e.tagesgeldCent !== m.tgC;
    });
    if (falsch.length) melde('BLOCKER', 'Beträge falsch gespeichert', JSON.stringify(d.monate));
    else ok('4 Monate mit exakten Cent-Beträgen gespeichert (inkl. Komma-Eingabe)');
  }

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const nachReload = await daten();
  if (nachReload?.monate?.length === 4) ok('überleben den Reload');
  else melde('BLOCKER', 'Monate nach Reload verschwunden', `${nachReload?.monate?.length}`);
}

// ───────────────────────────── Fluss 3: Eintrag korrigieren
console.log('\n[3] Eintrag nachträglich korrigieren');
{
  await gehZu('Erfassen');
  await page.selectOption('#wahl-monat', '2');
  await page.waitForTimeout(300);
  // Bestehender Wert muss vorbelegt sein, sonst korrigiert man blind.
  const vorbelegt = await page.getByLabel('ETF-Depotwert (Trade Republic)').inputValue();
  if (vorbelegt.includes('1.450,50')) ok('bestehender Wert ist vorbelegt');
  else melde('HOCH', 'Bestehender Monat nicht vorbelegt', `Feld zeigt "${vorbelegt}"`);

  await page.getByLabel('ETF-Depotwert (Trade Republic)').fill('1.999,99');
  await page.locator('button', { hasText: /speichern/i }).first().click();
  await page.waitForTimeout(400);

  const d = await daten();
  const m2 = d?.monate?.find((x) => x.monat === 2);
  const m1 = d?.monate?.find((x) => x.monat === 1);
  if (m2?.etfDepotCent !== 199999) melde('BLOCKER', 'Korrektur nicht gespeichert', JSON.stringify(m2));
  else if (d.monate.length !== 4) melde('BLOCKER', 'Korrektur hat einen Eintrag dupliziert', `${d.monate.length} Monate`);
  else if (m1?.etfDepotCent !== 120000) melde('BLOCKER', 'Korrektur hat den falschen Eintrag geändert', JSON.stringify(m1));
  else ok('richtiger Eintrag geändert, kein Duplikat, Nachbarn unberührt');
}

// ───────────────────────────── Fluss 4: Eintrag löschen
console.log('\n[4] Eintrag löschen');
{
  const vorher = dialoge.anzahl;
  await gehZu('Erfassen');
  await page.selectOption('#wahl-monat', '3');
  await page.waitForTimeout(300);
  await page.locator('button', { hasText: /löschen/i }).first().click();
  await page.waitForTimeout(500);

  if (dialoge.anzahl === vorher) melde('HOCH', 'Löschen ohne Rückfrage', 'Datenverlust ohne Bestätigung möglich');
  else ok('Löschen fragt nach');

  const d = await daten();
  if (d?.monate?.length !== 3) melde('BLOCKER', 'Löschen hat nicht gewirkt', `${d?.monate?.length} Monate`);
  else if (d.monate.some((x) => x.monat === 3)) melde('BLOCKER', 'Falscher Eintrag gelöscht', JSON.stringify(d.monate));
  else ok('genau der gewählte Monat ist weg, Rest heil');
}

// ───────────────────────────── Fluss 5: Etappen überschreiten
console.log('\n[5] Etappen überschreiten');
{
  for (const [ziel, etf, tg, erwartet] of [
    ['1.000 €', '600,00', '500,00', 110000],
    ['3.000 €', '2.000,00', '1.500,00', 350000],
    ['10.000 €', '7.000,00', '4.000,00', 1100000],
  ]) {
    await gehZu('Erfassen');
    await page.selectOption('#wahl-monat', '12');
    await page.getByLabel('ETF-Depotwert (Trade Republic)').fill(etf);
    await page.getByLabel('Tagesgeld gesamt').fill(tg);
    // Der Knopf heißt bei einem bestehenden Monat "Änderung speichern".
    await page.locator('button', { hasText: /speichern/i }).first().click();
    await page.waitForTimeout(400);

    await gehZu('Übersicht');
    const text = await seitentext();
    const d = await daten();
    const m12 = d?.monate?.find((x) => x.monat === 12);
    const vermoegen = (m12?.etfDepotCent || 0) + (m12?.tagesgeldCent || 0);
    if (vermoegen !== erwartet) {
      melde('HOCH', `Vermögen für Etappe ${ziel} falsch`, `erwartet ${erwartet}, tatsächlich ${vermoegen}`);
    } else if (!/Etappe|Ziel|Fortschritt|%/i.test(text)) {
      melde('HOCH', 'Übersicht zeigt keinen Etappenfortschritt', text.slice(0, 200));
    } else ok(`Etappe ${ziel}: Vermögen ${(vermoegen / 100).toFixed(2)} €, Fortschritt angezeigt`);
  }

  // Über der letzten Etappe darf nichts kippen.
  const text = await seitentext();
  if (/NaN|Infinity|undefined/.test(text)) {
    melde('BLOCKER', 'Kaputter Wert in der Anzeige', text.match(/.{0,40}(NaN|Infinity|undefined).{0,40}/)?.[0] || '');
  } else ok('kein NaN/Infinity/undefined in der Anzeige');
}

// ───────────────────────────── Fluss 6: alles zurücksetzen
console.log('\n[6] Alles zurücksetzen');
{
  const vorher = dialoge.anzahl;
  await gehZu('Daten');
  await page.locator('button', { hasText: /zurücksetzen|löschen/i }).last().click();
  await page.waitForTimeout(700);

  if (dialoge.anzahl === vorher) melde('HOCH', 'Zurücksetzen ohne Rückfrage', 'Totalverlust ohne Bestätigung');
  else ok('Zurücksetzen fragt nach');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const d = await daten();
  if (d?.monate?.length !== 0) melde('BLOCKER', 'Monate nach Zurücksetzen noch da', `${d?.monate?.length}`);
  else if (d?.fixkosten?.length !== 17) melde('BLOCKER', 'Fixkosten nicht auf Startwerte zurück', `${d?.fixkosten?.length}`);
  else ok('Startzustand wiederhergestellt, überlebt Reload');
}

// ───────────────────────────── Konsolenfehler
console.log('\n[7] Fehlerkanäle');
if (seitenfehler.length) melde('HOCH', 'Unbehandelte Seitenfehler', seitenfehler.slice(0, 3).join(' | '));
else ok('keine unbehandelten Seitenfehler');
if (konsolenfehler.length) melde('MITTEL', 'Konsolenfehler', konsolenfehler.slice(0, 3).join(' | '));
else ok('keine Konsolenfehler');

await browser.close();

const stufen = ['BLOCKER', 'HOCH', 'MITTEL', 'NIEDRIG'];
console.log(`\n=== Regression: ${befunde.length} Befunde ===`);
for (const s of stufen) {
  const t = befunde.filter((b) => b.stufe === s);
  if (t.length) console.log(`  ${s}: ${t.length}`);
}
if (!befunde.length) console.log('  Alle Flüsse funktionieren.');
process.exit(befunde.some((b) => b.stufe === 'BLOCKER') ? 1 : 0);
