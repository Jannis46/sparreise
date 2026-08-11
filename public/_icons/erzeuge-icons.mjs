/**
 * Sparreise — Icon-Generator (Agent PWA).
 *
 * Erneut ausführen:
 *     node public/_icons/erzeuge-icons.mjs
 * (aus dem Projektwurzelverzeichnis; keine Abhängigkeiten nötig, nur Node >= 18)
 *
 * Warum selbstgebaut: Das Projekt hat bewusst keine Runtime- und keine
 * Bildwerkzeug-Abhängigkeiten, und Node hat keine Canvas-API. Also:
 *   1. Motiv als einfache Geometrie (Hintergrund + drei aufsteigende Säulen)
 *      in einen RGB-Pixelpuffer rastern, 4x4-Supersampling gegen Treppenkanten.
 *   2. Puffer als PNG kodieren — Signatur + IHDR + IDAT (zlib aus node:zlib) + IEND,
 *      CRC32 selbst gerechnet. Farbtyp 2 (Truecolor, KEIN Alpha).
 *
 * KEIN Alphakanal ist Absicht: iOS legt ein transparentes apple-touch-icon.png
 * auf dem Home-Bildschirm schwarz hinterlegt ab. Alle Icons sind deshalb
 * vollflächig deckend; die abgerundeten Ecken macht iOS selbst.
 *
 * Motiv: drei aufsteigende Säulen (Sparverlauf) auf tiefem Tintenblau,
 * die höchste in warmem Sand. Bewusst geometrisch und ohne Verlauf.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- Farben

const HINTERGRUND = [0x0f, 0x17, 0x2a]; // #0f172a — identisch zu <meta name="theme-color">
const SAEULE_1 = [0x3e, 0x56, 0x6b]; // #3e566b
const SAEULE_2 = [0x78, 0x96, 0xac]; // #7896ac
const SAEULE_3 = [0xe2, 0xbe, 0x7a]; // #e2be7a — warmer Sand, der Zielakzent

// ------------------------------------------------------------- Geometrie

/** Säulen in Einheitskoordinaten der Motivbox (0..1, v zeigt nach unten). */
const SAEULEN = [
  { x: 0.0, breite: 0.24, hoehe: 0.4, farbe: SAEULE_1 },
  { x: 0.38, breite: 0.24, hoehe: 0.66, farbe: SAEULE_2 },
  { x: 0.76, breite: 0.24, hoehe: 1.0, farbe: SAEULE_3 },
];
const ECKRADIUS = 0.07; // Anteil der Motivbox-Kantenlänge

/** true, wenn der Punkt (px, py) im abgerundeten Rechteck liegt. */
function imRundenRechteck(px, py, x, y, breite, hoehe, r) {
  if (px < x || px > x + breite || py < y || py > y + hoehe) return false;
  const radius = Math.min(r, breite / 2, hoehe / 2);
  const dx = Math.max(x + radius - px, 0, px - (x + breite - radius));
  const dy = Math.max(y + radius - py, 0, py - (y + hoehe - radius));
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Rastert das Motiv in einen RGB-Puffer.
 * @param {number} groesse Kantenlänge in Pixeln
 * @param {number} anteil  Kantenlänge der Motivbox als Anteil der Icon-Kante.
 *                         Für maskable klein halten (Motiv in der inneren "safe zone").
 */
function motivRastern(groesse, anteil) {
  const rgb = new Uint8Array(groesse * groesse * 3);
  const box = groesse * anteil;
  const rand = (groesse - box) / 2;
  const radius = box * ECKRADIUS;

  // Säulen in Pixelkoordinaten vorrechnen — spart Arbeit in der inneren Schleife.
  const formen = SAEULEN.map((s) => ({
    x: rand + s.x * box,
    y: rand + box * (1 - s.hoehe),
    breite: s.breite * box,
    hoehe: s.hoehe * box,
    farbe: s.farbe,
  }));

  const UNTER = 4; // 4x4 Subpixel-Abtastung
  for (let y = 0; y < groesse; y++) {
    for (let x = 0; x < groesse; x++) {
      let r = HINTERGRUND[0];
      let g = HINTERGRUND[1];
      let b = HINTERGRUND[2];

      for (const form of formen) {
        let treffer = 0;
        for (let sy = 0; sy < UNTER; sy++) {
          for (let sx = 0; sx < UNTER; sx++) {
            const px = x + (sx + 0.5) / UNTER;
            const py = y + (sy + 0.5) / UNTER;
            if (imRundenRechteck(px, py, form.x, form.y, form.breite, form.hoehe, radius)) treffer++;
          }
        }
        if (treffer === 0) continue;
        const a = treffer / (UNTER * UNTER);
        r = Math.round(r + (form.farbe[0] - r) * a);
        g = Math.round(g + (form.farbe[1] - g) * a);
        b = Math.round(b + (form.farbe[2] - b) * a);
      }

      const i = (y * groesse + x) * 3;
      rgb[i] = r;
      rgb[i + 1] = g;
      rgb[i + 2] = b;
    }
  }
  return rgb;
}

// ----------------------------------------------------------- PNG-Kodierer

const CRC_TABELLE = (() => {
  const tabelle = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabelle[n] = c >>> 0;
  }
  return tabelle;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABELLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(typ, daten) {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length, 0);
  const koerper = Buffer.concat([Buffer.from(typ, 'latin1'), daten]);
  const pruef = Buffer.alloc(4);
  pruef.writeUInt32BE(crc32(koerper), 0);
  return Buffer.concat([laenge, koerper, pruef]);
}

/** Kodiert einen RGB-Puffer als PNG (8 bit, Farbtyp 2 = Truecolor ohne Alpha). */
function pngKodieren(breite, hoehe, rgb) {
  const zeilenlaenge = breite * 3;
  const roh = Buffer.alloc(hoehe * (1 + zeilenlaenge));
  for (let y = 0; y < hoehe; y++) {
    const ziel = y * (1 + zeilenlaenge);
    roh[ziel] = 0; // Filtertyp 0 (None) — bei so wenig Struktur reicht das völlig
    Buffer.from(rgb.buffer, rgb.byteOffset + y * zeilenlaenge, zeilenlaenge).copy(roh, ziel + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(hoehe, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 2; // Farbtyp 2 = RGB, kein Alpha
  ihdr[10] = 0; // Kompression: deflate
  ihdr[11] = 0; // Filtermethode
  ihdr[12] = 0; // kein Interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(roh, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ----------------------------------------------------------------- SVG

function faviconSvg() {
  const hex = (f) => '#' + f.map((k) => k.toString(16).padStart(2, '0')).join('');
  const box = 64 * 0.86;
  const rand = (64 - box) / 2;
  const saeulen = SAEULEN.map((s) => {
    const x = (rand + s.x * box).toFixed(2);
    const y = (rand + box * (1 - s.hoehe)).toFixed(2);
    const b = (s.breite * box).toFixed(2);
    const h = (s.hoehe * box).toFixed(2);
    const r = (box * ECKRADIUS).toFixed(2);
    return `  <rect x="${x}" y="${y}" width="${b}" height="${h}" rx="${r}" fill="${hex(s.farbe)}" />`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Sparreise">
  <rect width="64" height="64" rx="12" fill="${hex(HINTERGRUND)}" />
${saeulen}
</svg>
`;
}

// ------------------------------------------------------------- Erzeugung

const ZIEL = fileURLToPath(new URL('../', import.meta.url)); // public/
mkdirSync(ZIEL, { recursive: true });

const DATEIEN = [
  // apple-touch-icon: 180x180, deckend, ohne runde Ecken — iOS rundet selbst.
  { name: 'apple-touch-icon.png', groesse: 180, anteil: 0.86 },
  { name: 'icon-192.png', groesse: 192, anteil: 0.86 },
  { name: 'icon-512.png', groesse: 512, anteil: 0.86 },
  // maskable: Motiv in der inneren "safe zone" (< 80% Kantenlänge), damit
  // Android beim Zuschneiden nichts abschneidet.
  { name: 'icon-512-maskable.png', groesse: 512, anteil: 0.62 },
];

for (const datei of DATEIEN) {
  const png = pngKodieren(datei.groesse, datei.groesse, motivRastern(datei.groesse, datei.anteil));
  writeFileSync(ZIEL + datei.name, png);
}
writeFileSync(ZIEL + 'favicon.svg', faviconSvg(), 'utf8');

// ------------------------------------------------------------- Prüfung
// Ein kaputtes Icon fällt sonst erst auf dem iPhone auf: Header, Maße,
// Farbtyp, IEND und Dateigröße werden hier gegengelesen.

const SIGNATUR = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let fehler = 0;

for (const datei of DATEIEN) {
  const buf = readFileSync(ZIEL + datei.name);
  const probleme = [];
  if (!buf.subarray(0, 8).equals(SIGNATUR)) probleme.push('PNG-Signatur fehlt');
  if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') probleme.push('IHDR fehlt');
  const breite = buf.readUInt32BE(16);
  const hoehe = buf.readUInt32BE(20);
  if (breite !== datei.groesse || hoehe !== datei.groesse) probleme.push(`Maße ${breite}x${hoehe}`);
  if (buf[24] !== 8) probleme.push('Bittiefe != 8');
  if (buf[25] !== 2) probleme.push('Farbtyp != 2 (Alpha wäre auf iOS schwarz)');
  if (buf.subarray(buf.length - 8, buf.length - 4).toString('latin1') !== 'IEND') probleme.push('IEND fehlt');
  // IHDR-CRC gegenlesen — belegt, dass der Chunk-Aufbau stimmt.
  if (buf.readUInt32BE(29) !== crc32(buf.subarray(12, 29))) probleme.push('IHDR-CRC falsch');
  if (buf.length < 400) probleme.push('Datei verdächtig klein');

  if (probleme.length > 0) fehler++;
  const status = probleme.length === 0 ? 'ok' : 'FEHLER: ' + probleme.join(', ');
  console.log(`${datei.name.padEnd(24)} ${String(breite).padStart(3)}x${hoehe}  ${String(buf.length).padStart(7)} B  ${status}`);
}

const svg = readFileSync(ZIEL + 'favicon.svg', 'utf8');
if (!svg.startsWith('<svg') || !svg.includes('</svg>')) {
  fehler++;
  console.log('favicon.svg              FEHLER: kein gültiges SVG');
} else {
  console.log(`favicon.svg              64x64  ${String(Buffer.byteLength(svg)).padStart(7)} B  ok`);
}

if (fehler > 0) {
  console.error(`\n${fehler} Datei(en) fehlerhaft.`);
  process.exitCode = 1;
}
