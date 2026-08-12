/**
 * Objektive Messung der Mobil-Anforderungen gegen die gebaute App.
 *
 * Kein Augenschein: alles wird über getBoundingClientRect / getComputedStyle
 * gemessen. WebKit = dieselbe Engine wie iOS Safari.
 *
 * Start:  npx vite preview --port 4173
 * Lauf:   node pruefung/iphone/messung.mjs
 */
import { webkit } from '@playwright/test';

const URL = 'http://localhost:4173/';
const BREITEN = [390, 320];
const SCHEMATA = ['light', 'dark'];
// Über Umgebungsvariablen anhebbar, um die Messung selbst zu prüfen (Gegenprobe):
// schlägt sie bei einer künstlich zu hohen Schwelle nicht an, misst sie nichts.
const MIN_ZIEL = Number(process.env.MIN_ZIEL || 44);
const MIN_SCHRIFT = Number(process.env.MIN_SCHRIFT || 16);

let gemessenZiele = 0;
let gemessenFelder = 0;
let gemessenTexte = 0;

const befunde = [];
const melde = (stufe, titel, detail) => befunde.push({ stufe, titel, detail });

/** Relative Luminanz nach WCAG 2.1. */
function luminanz([r, g, b]) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function kontrast(vg, hg) {
  const a = luminanz(vg);
  const b = luminanz(hg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Im Seitenkontext: alles einsammeln, was gemessen werden muss. */
const SAMMLER = () => {
  const SEL = 'button, a[href], input, select, textarea, label, summary, [role="button"], [tabindex]:not([tabindex="-1"])';
  const sichtbar = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const ziele = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (!sichtbar(el)) continue;
    // Ein Label, das nur Text um ein Feld herum ist, ist kein eigenes Touch-Ziel.
    if (el.tagName === 'LABEL' && !el.querySelector('button, [role="button"]')) {
      const fuer = el.htmlFor ? document.getElementById(el.htmlFor) : el.querySelector('input,select,textarea');
      if (fuer && fuer.type !== 'file') continue;
    }
    const r = el.getBoundingClientRect();
    ziele.push({
      tag: el.tagName.toLowerCase(),
      typ: el.getAttribute('type') || '',
      klasse: (el.className || '').toString().slice(0, 60),
      text: (el.textContent || '').trim().slice(0, 40),
      breite: Math.round(r.width * 10) / 10,
      hoehe: Math.round(r.height * 10) / 10,
    });
  }

  const felder = [];
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (!sichtbar(el)) continue;
    const s = getComputedStyle(el);
    felder.push({
      tag: el.tagName.toLowerCase(),
      typ: el.getAttribute('type') || '',
      inputmode: el.getAttribute('inputmode') || '',
      schrift: parseFloat(s.fontSize),
      name: el.getAttribute('aria-label') || el.id || el.name || '',
    });
  }

  // Kontrast: Textknoten mit ihrer effektiven Hintergrundfarbe.
  const alsRgb = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const t = m[1].split(',').map((x) => parseFloat(x));
    if (t.length > 3 && t[3] === 0) return null;
    return [t[0], t[1], t[2]];
  };
  const hintergrund = (el) => {
    let k = el;
    while (k && k !== document.documentElement) {
      const c = alsRgb(getComputedStyle(k).backgroundColor);
      if (c) return c;
      k = k.parentElement;
    }
    return alsRgb(getComputedStyle(document.body).backgroundColor) || [255, 255, 255];
  };
  const texte = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!sichtbar(el)) continue;
    const eigenerText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3 && n.textContent.trim())
      .map((n) => n.textContent.trim())
      .join(' ');
    if (!eigenerText) continue;
    const s = getComputedStyle(el);
    const vg = alsRgb(s.color);
    if (!vg) continue;
    texte.push({
      text: eigenerText.slice(0, 40),
      vg,
      hg: hintergrund(el),
      groesse: parseFloat(s.fontSize),
      fett: parseInt(s.fontWeight, 10) >= 700,
    });
  }

  return {
    ziele,
    felder,
    texte,
    scrollBreite: document.documentElement.scrollWidth,
    clientBreite: document.documentElement.clientWidth,
  };
};

/** Realistische Daten anlegen, damit die Messung keine leeren Screens misst. */
async function datenAnlegen(page) {
  await page.evaluate(async () => {
    const jetzt = Date.now();
    const monate = [];
    for (let i = 0; i < 8; i++) {
      monate.push({
        id: `m${i}`,
        jahr: 2026,
        monat: i + 1,
        etfDepotCent: 120000 + i * 47000,
        tagesgeldCent: 80000 + i * 31000,
        erfasstAm: jetzt + i,
      });
    }
    const roh = {
      schemaVersion: 1,
      fixkosten: [
        { id: 'f1', name: 'Berufsunfähigkeitsversicherung mit sehr langem Namen', betragCent: 8000 },
        { id: 'f2', name: 'Miete', betragCent: 70000 },
        { id: 'f3', name: 'ETF-Sparplan Ftse All-World', betragCent: 5000 },
      ],
      einstellungen: {
        einkommenCent: 200000,
        studiumCent: 20000,
        freizeitCent: 30000,
        etfZusatzCent: 5000,
        etfInFixkostenCent: 10000,
      },
      monate,
    };
    localStorage.setItem('sparreise.daten.v1', JSON.stringify(roh));
  });
  await page.reload({ waitUntil: 'networkidle' });
}

const browser = await webkit.launch();

for (const schema of SCHEMATA) {
  for (const breite of BREITEN) {
    const ctx = await browser.newContext({
      viewport: { width: breite, height: 844 },
      colorScheme: schema,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => melde('HOCH', 'Unbehandelter Seitenfehler', `${schema}/${breite}px: ${e.message}`));

    await page.goto(URL, { waitUntil: 'networkidle' });
    await datenAnlegen(page);

    // Alle Screens über die Tab-Leiste durchgehen.
    const anzahlTabs = await page.locator('nav.leiste button.leiste-knopf').count();
    if (anzahlTabs === 0) {
      melde('BLOCKER', 'Navigation nicht gefunden', `${schema}/${breite}px: keine nav.leiste button.leiste-knopf`);
    }
    console.log(`  ${schema} @ ${breite}px — ${anzahlTabs} Screens gefunden`);

    for (let i = 0; i < Math.max(anzahlTabs, 1); i++) {
      let screen = '(einziger Screen)';
      if (anzahlTabs > 0) {
        const knopf = page.locator('nav.leiste button.leiste-knopf').nth(i);
        screen = (await knopf.textContent())?.trim() || `Tab ${i + 1}`;
        await knopf.click();
        await page.waitForTimeout(200);
      }

      const d = await page.evaluate(SAMMLER);
      const wo = `${screen} @ ${breite}px / ${schema}`;

      if (d.scrollBreite > d.clientBreite + 1) {
        melde('BLOCKER', 'Horizontales Scrollen', `${wo}: scrollWidth ${d.scrollBreite} > clientWidth ${d.clientBreite}`);
      }

      gemessenZiele += d.ziele.length;
      gemessenFelder += d.felder.length;
      gemessenTexte += d.texte.length;

      for (const z of d.ziele) {
        if (z.breite < MIN_ZIEL - 0.5 || z.hoehe < MIN_ZIEL - 0.5) {
          melde(
            'BLOCKER',
            'Touch-Ziel zu klein',
            `${wo}: <${z.tag}${z.typ ? ` type=${z.typ}` : ''}> "${z.text}" ${z.breite}×${z.hoehe} px (min ${MIN_ZIEL})`,
          );
        }
      }

      // Der Zoom-Sprung entsteht nur bei Feldern, in die man TEXT eintippt.
      // Ein Schieberegler, eine Checkbox oder ein Dateifeld nehmen keine
      // Tastatureingabe entgegen — dort gibt es nichts, wobei iOS zoomen könnte.
      const OHNE_TASTATUR = ['range', 'checkbox', 'radio', 'file', 'button', 'submit', 'color'];
      for (const f of d.felder) {
        if (OHNE_TASTATUR.includes(f.typ)) continue;
        if (f.schrift < MIN_SCHRIFT - 0.01) {
          melde('BLOCKER', 'Zoom-Sprung beim Fokus', `${wo}: <${f.tag} ${f.typ}> "${f.name}" ${f.schrift}px (min ${MIN_SCHRIFT})`);
        }
        if (f.typ === 'number') {
          melde('HOCH', 'type=number frisst Komma', `${wo}: "${f.name}"`);
        }
      }

      for (const t of d.texte) {
        const gross = t.groesse >= 24 || (t.groesse >= 18.66 && t.fett);
        const soll = gross ? 3.0 : 4.5;
        const k = kontrast(t.vg, t.hg);
        if (k < soll) {
          melde(
            'HOCH',
            'Kontrast unter WCAG AA',
            `${wo}: "${t.text}" ${k.toFixed(2)}:1 (min ${soll}:1, ${t.groesse}px)`,
          );
        }
      }
    }
    await ctx.close();
  }
}

// Statische Prüfungen an den Quellen.
const { readFileSync } = await import('node:fs');
const css = readFileSync('src/ui/stil.css', 'utf8');
const html = readFileSync('index.html', 'utf8');
// env() steht in index.html als CSS-Variable, stil.css nutzt sie über var().
// Beide Wege zählen — entscheidend ist, dass der untere Rand sie berücksichtigt.
const safeQuelle = /env\(safe-area-inset-bottom/.test(css) || /env\(safe-area-inset-bottom/.test(html);
const safeGenutzt = /safe-area-inset-bottom|--safe-unten/.test(css);
if (!safeQuelle || !safeGenutzt) {
  melde('HOCH', 'Safe-Area unten nicht berücksichtigt', `Quelle: ${safeQuelle}, genutzt: ${safeGenutzt}`);
}
const hoverBloecke = css.match(/:hover/g) || [];
const hoverGeschuetzt = css.match(/@media\s*\(hover:\s*hover\)/g) || [];
if (hoverBloecke.length > 0 && hoverGeschuetzt.length === 0) {
  melde('HOCH', 'Hover ohne Schutz', `${hoverBloecke.length}× :hover, aber kein @media (hover: hover)`);
}

await browser.close();

// Bericht
const stufen = ['BLOCKER', 'HOCH', 'MITTEL', 'NIEDRIG'];
const einmalig = new Map();
for (const b of befunde) {
  const schluessel = `${b.stufe}|${b.titel}|${b.detail}`;
  if (!einmalig.has(schluessel)) einmalig.set(schluessel, b);
}
const liste = [...einmalig.values()].sort((a, b) => stufen.indexOf(a.stufe) - stufen.indexOf(b.stufe));

console.log(
  `\nGemessen: ${gemessenZiele} Touch-Ziele, ${gemessenFelder} Eingabefelder, ${gemessenTexte} Textknoten` +
    ` (Schwellen: Ziel ${MIN_ZIEL}px, Schrift ${MIN_SCHRIFT}px)`,
);
console.log(`\n=== iPhone-Messung: ${liste.length} Befunde ===\n`);
for (const s of stufen) {
  const teil = liste.filter((b) => b.stufe === s);
  if (!teil.length) continue;
  console.log(`--- ${s} (${teil.length}) ---`);
  for (const b of teil) console.log(`  ${b.titel}: ${b.detail}`);
  console.log('');
}
if (!liste.length) console.log('Keine Verstöße gemessen.');
process.exit(liste.some((b) => b.stufe === 'BLOCKER') ? 1 : 0);
