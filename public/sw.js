/*
 * Sparreise — handgeschriebener Service Worker (kein Workbox, keine Abhängigkeiten).
 *
 * ── Cache-Strategie ────────────────────────────────────────────────────────────
 * Vite erzeugt gehashte Dateinamen (assets/index-DarWA2oH.js), die hier zur
 * Schreibzeit unbekannt sind. Gelöst ohne Build-Plugin:
 *
 *   1. Beim `install` holt der SW ./index.html und liest die verlinkten
 *      same-origin-Assets (src="…" / href="…") per Regex heraus — das sind exakt
 *      die gehashten Dateien des aktuellen Builds — und legt sie in den Cache.
 *      Damit ist die App schon nach dem ERSTEN Laden vollständig offline nutzbar
 *      und nicht erst nach dem zweiten (beim ersten Laden steuert der SW die
 *      Seite noch nicht, ihre Requests laufen also an ihm vorbei).
 *   2. Navigationen: network-first mit Cache-Fallback. Die HTML ist nicht gehasht;
 *      cache-first würde eine alte Version festfrieren. Offline liefert der
 *      Fallback immer die gecachte ./index.html.
 *   3. Alle übrigen same-origin GETs: cache-first, Misses werden nachgecacht
 *      (Runtime-Caching). Gehashte URLs sind unveränderlich, cache-first ist dort
 *      korrekt und schnell.
 *
 * Nur GET, nur same-origin. Cross-origin und POST/PUT/… fasst der SW nicht an.
 *
 * ── Update ─────────────────────────────────────────────────────────────────────
 * Kein blindes skipWaiting() — das tauscht die App mitten in einer Sitzung aus.
 * Der neue SW installiert, bleibt im Wartezustand und meldet den Clients
 * { typ: 'SPARREISE_UPDATE_BEREIT' }. Erst wenn die UI (über register.ts)
 * { typ: 'SKIP_WARTEN' } zurückschickt, ruft er skipWaiting().
 *
 * ── Regel ──────────────────────────────────────────────────────────────────────
 * Der fetch-Handler wirft NIE. Jeder Pfad endet in einer Response, sonst ist die
 * Seite tot. Alle Pfade sind relativ (GitHub Pages läuft unter /sparreise/).
 */

const CACHE = 'sparreise-v1';

/** Muss immer im Cache liegen, sonst funktioniert der Offline-Start nicht. */
const KERN = ['./', './index.html'];

// ─────────────────────────────────────────────────────────────────── install

self.addEventListener('install', (event) => {
  event.waitUntil(installieren());
});

async function installieren() {
  const cache = await caches.open(CACHE);
  await einzelnCachen(cache, KERN);
  await einzelnCachen(cache, await assetsAusIndexLesen());

  // Ist schon ein SW aktiv, ist das hier ein Update: Clients Bescheid geben,
  // damit die UI "Neue Version verfügbar" anzeigen kann. Bewusst KEIN skipWaiting().
  if (self.registration.active) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const client of clients) client.postMessage({ typ: 'SPARREISE_UPDATE_BEREIT' });
  }
}

/**
 * Jede URL einzeln cachen. Kein cache.addAll() — dort lässt ein einziger
 * fehlschlagender Request die komplette Installation scheitern.
 */
async function einzelnCachen(cache, urls) {
  for (const url of urls) {
    try {
      await cache.add(url);
    } catch (fehler) {
      console.warn('Sparreise SW: konnte nicht vorab cachen:', url, fehler);
    }
  }
}

/** Liest die gehashten Asset-URLs des aktuellen Builds aus ./index.html. */
async function assetsAusIndexLesen() {
  try {
    const antwort = await fetch('./index.html', { cache: 'no-store' });
    if (!antwort.ok) return [];
    const html = await antwort.text();
    const gefunden = [];
    const muster = /(?:src|href)\s*=\s*"([^"]+)"/g;
    let treffer = muster.exec(html);
    while (treffer !== null) {
      const roh = treffer[1];
      treffer = muster.exec(html);
      if (!roh || roh.startsWith('data:') || roh.startsWith('#')) continue;
      let url;
      try {
        url = new URL(roh, self.location.href);
      } catch (fehler) {
        console.warn('Sparreise SW: unbrauchbare URL in index.html:', roh, fehler);
        continue;
      }
      if (url.origin !== self.location.origin) continue; // kein cross-origin
      if (url.href === self.location.href) continue; // sich selbst nicht cachen
      if (gefunden.indexOf(url.href) === -1) gefunden.push(url.href);
    }
    return gefunden;
  } catch (fehler) {
    // Kein Blocker: der Runtime-Cache holt die Assets beim nächsten Laden nach.
    console.warn('Sparreise SW: index.html für den Precache nicht lesbar:', fehler);
    return [];
  }
}

// ────────────────────────────────────────────────────────────────── activate

self.addEventListener('activate', (event) => {
  event.waitUntil(aktivieren());
});

async function aktivieren() {
  const namen = await caches.keys();
  for (const name of namen) {
    if (name === CACHE || name.indexOf('sparreise-') !== 0) continue;
    try {
      await caches.delete(name);
    } catch (fehler) {
      console.warn('Sparreise SW: alter Cache nicht löschbar:', name, fehler);
    }
  }
  // Nötig, damit nach SKIP_WARTEN ein controllerchange feuert und die UI neu laden kann.
  await self.clients.claim();
}

// ───────────────────────────────────────────────────────────────────── fetch

self.addEventListener('fetch', (event) => {
  const anfrage = event.request;
  if (anfrage.method !== 'GET') return; // nur GET cachen

  let ziel;
  try {
    ziel = new URL(anfrage.url);
  } catch (fehler) {
    console.warn('Sparreise SW: Request mit unlesbarer URL:', fehler);
    return; // durchreichen, der Browser macht das schon
  }
  if (ziel.origin !== self.location.origin) return; // kein cross-origin

  // respondWith MUSS synchron aufgerufen werden.
  if (anfrage.mode === 'navigate') {
    event.respondWith(navigationBeantworten(anfrage));
    return;
  }
  event.respondWith(cacheZuerst(anfrage));
});

/** Navigation: network-first, offline immer die gecachte index.html. */
async function navigationBeantworten(anfrage) {
  try {
    const antwort = await fetch(anfrage);
    if (antwort && antwort.ok) {
      const kopie = antwort.clone();
      try {
        const cache = await caches.open(CACHE);
        await cache.put('./index.html', kopie);
      } catch (fehler) {
        console.warn('Sparreise SW: index.html nicht cachebar:', fehler);
      }
    }
    return antwort;
  } catch (fehler) {
    console.warn('Sparreise SW: Navigation offline, liefere Cache:', fehler);
    const gecacht = await ausCache('./index.html');
    if (gecacht) return gecacht;
    const start = await ausCache('./');
    if (start) return start;
    return offlineAntwort();
  }
}

/** Alles andere: cache-first, Miss wird nachgecacht. */
async function cacheZuerst(anfrage) {
  const gecacht = await ausCache(anfrage);
  if (gecacht) return gecacht;

  try {
    const antwort = await fetch(anfrage);
    if (antwort && antwort.ok && antwort.type === 'basic') {
      const kopie = antwort.clone();
      try {
        const cache = await caches.open(CACHE);
        await cache.put(anfrage, kopie);
      } catch (fehler) {
        // z.B. voller Speicher — die Antwort selbst bleibt trotzdem gültig.
        console.warn('Sparreise SW: Antwort nicht cachebar:', anfrage.url, fehler);
      }
    }
    return antwort;
  } catch (fehler) {
    console.warn('Sparreise SW: Request offline und nicht im Cache:', anfrage.url, fehler);
    return offlineAntwort();
  }
}

/** caches.match, das nie wirft. */
async function ausCache(schluessel) {
  try {
    const cache = await caches.open(CACHE);
    const treffer = await cache.match(schluessel);
    return treffer || null;
  } catch (fehler) {
    console.warn('Sparreise SW: Cache nicht lesbar:', fehler);
    return null;
  }
}

function offlineAntwort() {
  return new Response('Sparreise ist offline und diese Datei liegt nicht im Offline-Speicher.', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

// ─────────────────────────────────────────────────────────────────── message

self.addEventListener('message', (event) => {
  const daten = event.data;
  if (daten && daten.typ === 'SKIP_WARTEN') {
    // Erst jetzt — die UI hat den Versionswechsel bestätigt.
    self.skipWaiting();
  }
});
