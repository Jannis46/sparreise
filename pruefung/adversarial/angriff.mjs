/**
 * Adversarial- und Regressionsprüfung: gezielt versuchen, die App zu brechen
 * und Datenverlust zu erzeugen.
 *
 * Start:  npx vite preview --port 4176
 * Lauf:   node pruefung/adversarial/angriff.mjs
 */
import { webkit } from '@playwright/test';

const URL = 'http://localhost:4176/';

// WICHTIG: Die App benutzt IndexedDB als primäre Stufe, nicht localStorage.
// Ein früherer Anlauf dieser Prüfung hat localStorage bespielt und ausgelesen —
// dabei wurde nichts von dem getestet, was getestet werden sollte, und es kamen
// zwei Scheinbefunde heraus. Deshalb hier durchgängig IndexedDB.
const IDB_NAME = 'sparreise';
const IDB_STORE = 'daten';
const IDB_SCHLUESSEL = 'app';

/** Im Seitenkontext ausführbar: Datensatz direkt in die IndexedDB schreiben. */
const IDB_SCHREIBEN = ([name, store, schluessel, roh]) =>
  new Promise((fertig, fehler) => {
    const anfrage = indexedDB.open(name, 1);
    anfrage.onupgradeneeded = () => {
      const db = anfrage.result;
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    };
    anfrage.onerror = () => fehler(anfrage.error);
    anfrage.onsuccess = () => {
      const db = anfrage.result;
      const tx = db.transaction(store, 'readwrite');
      // Gültiges JSON als Objekt ablegen (so speichert die App selbst),
      // kaputtes als Rohstring — dann testet es den Lesepfad für Müll.
      let wert = roh;
      try {
        wert = JSON.parse(roh);
      } catch {
        // absichtlich Rohstring behalten
      }
      tx.objectStore(store).put(wert, schluessel);
      tx.oncomplete = () => {
        db.close();
        fertig(true);
      };
      tx.onerror = () => fehler(tx.error);
    };
  });

/** Im Seitenkontext ausführbar: Datensatz aus der IndexedDB lesen. */
const IDB_LESEN = ([name, store, schluessel]) =>
  new Promise((fertig) => {
    const anfrage = indexedDB.open(name, 1);
    anfrage.onupgradeneeded = () => {
      const db = anfrage.result;
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    };
    anfrage.onerror = () => fertig(null);
    anfrage.onsuccess = () => {
      const db = anfrage.result;
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
        fertig(w === undefined ? null : typeof w === 'string' ? w : JSON.stringify(w));
      };
      g.onerror = () => {
        db.close();
        fertig(null);
      };
    };
  });

const lesen = (page) => page.evaluate(IDB_LESEN, [IDB_NAME, IDB_STORE, IDB_SCHLUESSEL]);

const befunde = [];
const melde = (stufe, titel, detail) => {
  befunde.push({ stufe, titel, detail });
  console.log(`  [${stufe}] ${titel} — ${detail}`);
};
const ok = (text) => console.log(`  ok: ${text}`);

const browser = await webkit.launch();

/** Frischer Kontext, optional mit vorbelegtem Speicher. */
async function neueSeite(vorbelegung) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const fehler = [];
  page.on('pageerror', (e) => fehler.push(e.message));
  // Playwright weist Dialoge sonst automatisch ab. Der Import fragt per confirm
  // nach — ohne Zustimmung bräche er ab und der Test meldete fälschlich
  // "unverändert", ohne je etwas importiert zu haben.
  page.on('dialog', (d) => {
    void d.accept();
  });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  if (vorbelegung !== undefined) {
    // Erst laden (die App legt die Datenbank an), dann überschreiben, dann neu laden.
    // addInitScript reicht nicht: IndexedDB-Schreibvorgänge sind asynchron und
    // wären nicht zwingend fertig, bevor die App liest.
    await page.evaluate(IDB_SCHREIBEN, [IDB_NAME, IDB_STORE, IDB_SCHLUESSEL, vorbelegung]);
    fehler.length = 0;
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
  }
  return { ctx, page, fehler };
}

function gueltigeDaten(extra = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    fixkosten: [
      { id: 'f1', name: 'Miete', betragCent: 70000 },
      { id: 'f2', name: 'Strom', betragCent: 5800 },
    ],
    einstellungen: {
      einkommenCent: 200000,
      studiumCent: 20000,
      freizeitCent: 30000,
      etfZusatzCent: 5000,
      etfInFixkostenCent: 10000,
    },
    monate: [
      { id: 'm1', jahr: 2026, monat: 1, etfDepotCent: 120000, tagesgeldCent: 80000, erfasstAm: 1 },
    ],
    ...extra,
  });
}

// ───────────────────────────────── 1. XSS über Nutzertext
console.log('\n[1] XSS und Layout über Nutzertext');
{
  const boese = [
    '<script>window.__xss=1</script>',
    '<img src=x onerror="window.__xss=1">',
    '"><b>fett</b>',
    '‮gnudlemsgnugithcaneb',
    'A'.repeat(5000),
    '🙈'.repeat(200),
  ];
  const daten = JSON.parse(gueltigeDaten());
  daten.fixkosten = boese.map((name, i) => ({ id: `x${i}`, name, betragCent: 1000 }));
  const { ctx, page, fehler } = await neueSeite(JSON.stringify(daten));

  const xss = await page.evaluate(() => window.__xss === 1);
  if (xss) melde('BLOCKER', 'XSS ausgeführt', 'Script aus Fixkostenname lief');
  else ok('kein Script ausgeführt');

  // Auf jedem Screen prüfen, ob der lange Text das Layout sprengt.
  const anzahl = await page.locator('nav.leiste button.leiste-knopf').count();
  for (let i = 0; i < anzahl; i++) {
    const knopf = page.locator('nav.leiste button.leiste-knopf').nth(i);
    const name = (await knopf.textContent())?.trim() || `Tab ${i}`;
    await knopf.click();
    await page.waitForTimeout(150);
    const [sw, cw] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    if (sw > cw + 1) melde('BLOCKER', 'Horizontales Scrollen durch langen Text', `${name}: ${sw} > ${cw}`);
  }
  ok('kein horizontales Scrollen trotz 5000-Zeichen-Name');
  if (fehler.length) melde('HOCH', 'Seitenfehler bei bösem Text', fehler.join(' | '));
  await ctx.close();
}

// ───────────────────────────────── 2. Kaputter Speicherinhalt
console.log('\n[2] Kaputter Speicherinhalt beim Start');
for (const [name, inhalt] of [
  ['abgeschnittenes JSON', '{"schemaVersion":1,"fixkosten":[{"id"'],
  ['kein JSON', 'völliger Unsinn'],
  ['Array statt Objekt', '[]'],
  ['null', 'null'],
  ['leerer String', ''],
  ['schemaVersion 99', gueltigeDaten({ schemaVersion: 99 })],
  ['__proto__-Angriff', '{"schemaVersion":1,"__proto__":{"verseucht":true},"fixkosten":[],"monate":[]}'],
  ['Beträge als String', '{"schemaVersion":1,"fixkosten":[{"id":"a","name":"X","betragCent":"viel"}],"einstellungen":{},"monate":[]}'],
  ['monat 99', '{"schemaVersion":1,"fixkosten":[],"einstellungen":{},"monate":[{"id":"a","jahr":2026,"monat":99,"etfDepotCent":1,"tagesgeldCent":1,"erfasstAm":1}]}'],
]) {
  const { ctx, page, fehler } = await neueSeite(inhalt);
  const gestartet = await page.locator('nav.leiste button.leiste-knopf').count();
  const verseucht = await page.evaluate(() => ({}).verseucht === true);

  if (gestartet === 0) melde('BLOCKER', 'App startet nicht', `bei: ${name}`);
  else if (verseucht) melde('BLOCKER', 'Prototype Pollution', `bei: ${name}`);
  else if (fehler.length) melde('HOCH', 'Seitenfehler beim Start', `${name}: ${fehler[0]}`);
  else ok(`${name} — App startet sauber`);
  await ctx.close();
}

// ───────────────────────────────── 3. Datenverlust bei schnellen Folgeeingaben
console.log('\n[3] Schnelle Folgeeingaben + sofortiger Reload');
{
  const { ctx, page, fehler } = await neueSeite(gueltigeDaten());
  await page.locator('nav.leiste button.leiste-knopf', { hasText: /Fixkosten/i }).first().click();
  await page.waitForTimeout(200);

  const feld = page.locator('input[inputmode="decimal"]').first();
  const vorhanden = await feld.count();
  if (!vorhanden) {
    melde('MITTEL', 'Kein Betragsfeld gefunden', 'Schnellschreib-Test übersprungen');
  } else {
    // Zwei Varianten, weil sie unterschiedlich viel bedeuten:
    //  (a) schnelle Eingaben, dann kurz warten, dann neu laden
    //      → MUSS den Endstand haben. Das ist die eigentliche Zusage.
    //  (b) schnelle Eingaben, sofort neu laden ohne jede Pause
    //      → Grenzfall. Speichern ist asynchron; wer den Prozess mitten im
    //        Schreiben abschießt, kann prinzipiell nicht alles retten.
    const tippen = async () => {
      for (let i = 1; i <= 15; i++) {
        await feld.fill(`${100 + i},00`);
        await feld.blur();
      }
    };

    await tippen();
    await page.waitForTimeout(600);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const nachPause = await lesen(page);
    if (nachPause && nachPause.includes('11500')) {
      ok('(a) Endstand 115,00 € überlebt Reload nach kurzer Pause');
    } else {
      melde(
        'BLOCKER',
        'Datenverlust trotz Pause vor dem Reload',
        `11500 fehlt: ${String(nachPause).slice(0, 160)}`,
      );
    }

    await page.locator('nav.leiste button.leiste-knopf', { hasText: /Fixkosten/i }).first().click();
    await page.waitForTimeout(200);
    const feld2 = page.locator('input[inputmode="decimal"]').first();
    for (let i = 1; i <= 15; i++) {
      await feld2.fill(`${200 + i},00`);
      await feld2.blur();
    }
    await page.reload({ waitUntil: 'networkidle' }); // ohne jede Pause
    await page.waitForTimeout(500);
    const sofort = await lesen(page);
    const treffer = String(sofort).match(/"betragCent":(2\d{4})/);
    const wert = treffer ? Number(treffer[1]) : null;
    if (wert === 21500) {
      ok('(b) Endstand überlebt sogar den sofortigen Reload');
    } else {
      melde(
        'MITTEL',
        'Sofortiger Reload ohne Pause verliert die letzten Eingaben',
        `zuletzt getippt 21500, gespeichert ${wert} — Grenzfall, siehe Kommentar im Skript`,
      );
    }
  }
  if (fehler.length) melde('HOCH', 'Seitenfehler', fehler.join(' | '));
  await ctx.close();
}

// ───────────────────────────────── 4. Speicher voll → Herabstufung ohne Datenverlust
console.log('\n[4] Speicher voll (QuotaExceededError)');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const fehler = [];
  page.on('pageerror', (e) => fehler.push(e.message));
  // Playwright weist Dialoge sonst automatisch ab. Der Import fragt per confirm
  // nach — ohne Zustimmung bräche er ab und der Test meldete fälschlich
  // "unverändert", ohne je etwas importiert zu haben.
  page.on('dialog', (d) => {
    void d.accept();
  });
  // Jeden Schreibweg blockieren: localStorage UND IndexedDB.
  await page.addInitScript(() => {
    const werfen = () => {
      const e = new Error('QuotaExceededError');
      e.name = 'QuotaExceededError';
      throw e;
    };
    Storage.prototype.setItem = werfen;
    if (window.indexedDB) window.indexedDB.open = () => { throw new Error('IDB blockiert'); };
  });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const gestartet = await page.locator('nav.leiste button.leiste-knopf').count();
  const sichtbarerText = await page.evaluate(() => document.body.innerText);
  const warnt = /nicht dauerhaft|gehen verloren|Arbeitsspeicher|nur für diese Sitzung|nicht gespeichert|Speicher/i.test(
    sichtbarerText,
  );

  if (gestartet === 0) melde('BLOCKER', 'App startet nicht bei vollem Speicher', 'keine Navigation gerendert');
  else if (!warnt) melde('BLOCKER', 'Keine sichtbare Warnung bei Nur-Arbeitsspeicher', 'Nutzer erfährt nichts vom drohenden Datenverlust');
  else ok('App läuft und warnt sichtbar');
  await ctx.close();
}

// ───────────────────────────────── 5. Export → Import Rundreise
console.log('\n[5] Export → Import Rundreise');
{
  const { ctx, page, fehler } = await neueSeite(gueltigeDaten());
  const vorher = await lesen(page);

  await page.locator('nav.leiste button.leiste-knopf', { hasText: /Daten/i }).first().click();
  await page.waitForTimeout(200);

  let exportInhalt = null;
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }),
      page.locator('button', { hasText: /Export|sichern|herunterladen/i }).first().click(),
    ]);
    const strom = await download.createReadStream();
    exportInhalt = await new Promise((res) => {
      let s = '';
      strom.on('data', (c) => (s += c));
      strom.on('end', () => res(s));
    });
    JSON.parse(exportInhalt);
    ok('Export ist valides JSON');
  } catch (e) {
    melde('MITTEL', 'Export nicht prüfbar', String(e).slice(0, 120));
  }

  if (exportInhalt) {
    // Export wieder einlesen und mit dem Ausgangsstand vergleichen.
    await page.setInputFiles('#datei-import', {
      name: 'sparreise.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exportInhalt, 'utf8'),
    });
    await page.waitForTimeout(800);
    const nachher = await lesen(page);
    const a = JSON.parse(vorher || '{}');
    const b = JSON.parse(nachher || '{}');
    const gleich =
      JSON.stringify(a.fixkosten) === JSON.stringify(b.fixkosten) &&
      JSON.stringify(a.monate) === JSON.stringify(b.monate) &&
      JSON.stringify(a.einstellungen) === JSON.stringify(b.einstellungen);
    if (gleich) ok('Rundreise identisch');
    else melde('HOCH', 'Export/Import verändert die Daten', `vorher ${vorher?.length} Zeichen, nachher ${nachher?.length}`);
  }
  if (fehler.length) melde('HOCH', 'Seitenfehler', fehler.join(' | '));
  await ctx.close();
}

// ───────────────────────────────── 6. Manipulierte Import-Datei zerstört gute Daten?
console.log('\n[6] Manipulierte Import-Datei gegen bestehende gute Daten');
for (const [name, inhalt] of [
  ['abgeschnitten', '{"schemaVersion":1,"fixkos'],
  ['leer', ''],
  ['schemaVersion 999', gueltigeDaten({ schemaVersion: 999 })],
  ['__proto__', '{"schemaVersion":1,"__proto__":{"verseucht2":true},"fixkosten":[],"einstellungen":{},"monate":[]}'],
  ['tief verschachtelt', `{"schemaVersion":1,"fixkosten":${'['.repeat(400)}${']'.repeat(400)},"einstellungen":{},"monate":[]}`],
]) {
  const { ctx, page, fehler } = await neueSeite(gueltigeDaten());
  const vorher = await lesen(page);

  await page.locator('nav.leiste button.leiste-knopf', { hasText: /Daten/i }).first().click();
  await page.waitForTimeout(200);
  await page.setInputFiles('#datei-import', {
    name: 'boese.json',
    mimeType: 'application/json',
    buffer: Buffer.from(inhalt, 'utf8'),
  });
  await page.waitForTimeout(700);

  const nachher = await lesen(page);
  const verseucht = await page.evaluate(() => ({}).verseucht2 === true);
  const text = await page.evaluate(() => document.body.innerText);
  const meldetFehler =
    /fehlgeschlagen|konnte nicht|nicht gelesen|ungültig|fehlerhaft|nicht importiert|abgebrochen/i.test(text);

  if (verseucht) melde('BLOCKER', 'Prototype Pollution über Import', name);
  else if (nachher !== vorher) melde('BLOCKER', 'Kaputte Datei zerstört gute Daten', `bei: ${name}`);
  else if (!meldetFehler) melde('HOCH', 'Import scheitert stillschweigend', `bei ${name} — Nutzer sieht keine Meldung`);
  else ok(`${name} — abgelehnt, Daten unverändert, Meldung sichtbar`);
  if (fehler.length) melde('HOCH', 'Seitenfehler beim Import', `${name}: ${fehler[0]}`);
  await ctx.close();
}

await browser.close();

const stufen = ['BLOCKER', 'HOCH', 'MITTEL', 'NIEDRIG'];
console.log(`\n=== Adversarial: ${befunde.length} Befunde ===`);
for (const s of stufen) {
  const teil = befunde.filter((b) => b.stufe === s);
  if (teil.length) console.log(`  ${s}: ${teil.length}`);
}
if (!befunde.length) console.log('  Nichts gebrochen.');
process.exit(befunde.some((b) => b.stufe === 'BLOCKER') ? 1 : 0);
