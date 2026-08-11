/**
 * Einstiegspunkt. Eigentümer: ARCHITEKT (nicht von Bau-Agents ändern).
 *
 * Verdrahtung: Adapter wählen → Daten laden/migrieren → Store bauen → UI mounten → SW registrieren.
 * Grundregel: JEDER Startfehler landet sichtbar im DOM, nicht nur in der Konsole.
 */

import { startDaten } from './domain/types';
import { nutzerTextAus } from './storage/adapter';
import { migriere } from './storage/migrate';
import { adapterWaehlen, herabstufen } from './storage/tiering';
import { Store } from './state/store';
import { appMounten } from './ui/app';
import { neueVersionUebernehmen, serviceWorkerRegistrieren } from './pwa/register';

function wurzel(): HTMLElement {
  const el = document.getElementById('app');
  if (el) return el;
  const ersatz = document.createElement('div');
  ersatz.id = 'app';
  document.body.appendChild(ersatz);
  return ersatz;
}

/** Sichtbares Fehler-Banner. Bewusst ohne Abhängigkeit zur UI-Schicht. */
function startFehlerAnzeigen(text: string, details?: unknown): void {
  const box = document.createElement('div');
  box.className = 'start-fehler';
  box.setAttribute('role', 'alert');

  const titel = document.createElement('h1');
  titel.textContent = 'Sparreise konnte nicht starten';
  const absatz = document.createElement('p');
  absatz.textContent = text;
  box.appendChild(titel);
  box.appendChild(absatz);

  if (details !== undefined) {
    const pre = document.createElement('pre');
    pre.textContent = details instanceof Error ? `${details.name}: ${details.message}` : String(details);
    box.appendChild(pre);
  }

  wurzel().appendChild(box);
}

/**
 * Hinweis auf eine neue Version. Bewusst kein Zwangs-Reload: der Nutzer könnte
 * gerade Beträge eintippen. Er entscheidet, wann getauscht wird.
 */
function updateHinweisAnzeigen(): void {
  if (document.querySelector('.update-hinweis')) return;

  const box = document.createElement('div');
  box.className = 'update-hinweis';
  box.setAttribute('role', 'status');

  const absatz = document.createElement('p');
  absatz.textContent = 'Eine neue Version von Sparreise ist bereit.';

  const knopf = document.createElement('button');
  knopf.type = 'button';
  knopf.textContent = 'Jetzt aktualisieren';
  knopf.addEventListener('click', () => {
    knopf.disabled = true;
    knopf.textContent = 'Wird aktualisiert …';
    neueVersionUebernehmen();
  });

  box.appendChild(absatz);
  box.appendChild(knopf);
  wurzel().appendChild(box);
}

/** Warnbanner, wenn die App zwar läuft, aber etwas nicht stimmt. */
function warnungAnzeigen(text: string): void {
  const box = document.createElement('div');
  box.className = 'start-fehler';
  box.setAttribute('role', 'status');
  const absatz = document.createElement('p');
  absatz.textContent = text;
  box.appendChild(absatz);
  wurzel().appendChild(box);
}

async function start(): Promise<void> {
  const adapter = await adapterWaehlen();

  let daten = startDaten();
  try {
    const roh = await adapter.laden();
    if (roh !== null) {
      const migriert = migriere(roh);
      if (migriert === null) {
        warnungAnzeigen(
          'Die gespeicherten Daten konnten nicht gelesen werden. Sparreise startet mit den Startwerten. ' +
            'Deine alten Daten wurden NICHT überschrieben, solange du nichts änderst — sichere sie bei Bedarf zuerst.',
        );
      } else {
        daten = migriert;
      }
    }
  } catch (fehler) {
    warnungAnzeigen(`Daten konnten nicht geladen werden: ${nutzerTextAus(fehler)}`);
  }

  const store = new Store(adapter, daten, { herabstufen });
  store.ereignisNetzAktivieren();

  appMounten(wurzel(), store);

  // Der Service Worker darf den Start nie blockieren oder scheitern lassen.
  void serviceWorkerRegistrieren({
    beiFehler: (text) => warnungAnzeigen(text),
    beiUpdate: () => updateHinweisAnzeigen(),
  }).catch(() => undefined);
}

start().catch((fehler: unknown) => {
  startFehlerAnzeigen(nutzerTextAus(fehler), fehler);
});
