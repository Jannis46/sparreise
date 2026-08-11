/**
 * Einstiegspunkt der Oberfläche. Eigentümer: Agent "UI".
 *
 * Aufbau:
 *   #app (Safe-Area-Polster aus index.html)
 *     └ .app
 *         ├ .kopf     Titel + Statusbanner (Speicher-Tier, letzterFehler)
 *         ├ .inhalt   der aktive Screen
 *         └ .leiste   fixierte Navigation im Daumenbereich
 *
 * Kein Framework, kein Virtual DOM. `store.subscribe()` ruft `screen.aktualisieren()`
 * — gezielt, damit Eingabefelder beim Tippen nicht neu gebaut werden (Fokusverlust
 * auf iOS = zugeklappte Tastatur = kaputte Erfassung).
 */

import './stil.css';

import type { Store } from '../state/store';
import { el, leeren } from './components/basis';
import type { Screen, ScreenId, UiKontext } from './kontext';
import { bauUebersicht } from './screens/uebersicht';
import { bauErfassen } from './screens/erfassen';
import { bauFixkosten } from './screens/fixkosten';
import { bauVerteilung } from './screens/verteilung';
import { bauStatistik } from './screens/statistik';
import { bauDaten } from './screens/daten';

interface TabDefinition {
  id: ScreenId;
  /**
   * Kurz genug, dass sechs Tabs auch bei 320px nebeneinander passen —
   * 320 / 6 ≈ 53px, also weiter über den geforderten 44px Touch-Ziel.
   */
  kurz: string;
  titel: string;
  unter: string;
  haupt?: boolean;
}

const TABS: readonly TabDefinition[] = [
  {
    id: 'uebersicht',
    kurz: 'Übersicht',
    titel: 'Sparreise',
    unter: 'Wo du gerade stehst',
  },
  {
    id: 'erfassen',
    kurz: 'Erfassen',
    titel: 'Monat erfassen',
    unter: 'Depotwert und Tagesgeld eintragen',
    haupt: true,
  },
  {
    id: 'fixkosten',
    kurz: 'Fixkosten',
    titel: 'Fixkosten',
    unter: 'Monatliche Verpflichtungen',
  },
  {
    id: 'verteilung',
    kurz: 'Verteilen',
    titel: 'Verteilung',
    unter: 'Was jeden Monat wohin geht',
  },
  {
    id: 'statistik',
    kurz: 'Statistik',
    titel: 'Statistik',
    unter: 'Auswertung pro Monat und Jahr',
  },
  {
    id: 'daten',
    kurz: 'Daten',
    titel: 'Daten & Sicherung',
    unter: 'Export, Import, Zurücksetzen',
  },
];

const BAUER: Readonly<Record<ScreenId, (kontext: UiKontext) => Screen>> = {
  uebersicht: bauUebersicht,
  erfassen: bauErfassen,
  fixkosten: bauFixkosten,
  verteilung: bauVerteilung,
  statistik: bauStatistik,
  daten: bauDaten,
};

/** Baut die App in `wurzel` auf und abonniert den Store. */
export function appMounten(wurzel: HTMLElement, store: Store): void {
  // Bewusst NICHT leeren: main.ts hängt Startwarnungen vor dem Mounten in #app.
  const rahmen = el('div', 'app');

  const kopf = el('header', 'kopf');
  const titel = el('h1', 'kopf-titel');
  const unter = el('p', 'kopf-unter');
  const bannerBereich = el('div', 'banner-bereich');
  kopf.append(titel, unter, bannerBereich);

  const inhalt = el('main', 'inhalt');
  const leiste = el('nav', 'leiste');
  leiste.setAttribute('aria-label', 'Hauptnavigation');

  rahmen.append(kopf, inhalt, leiste);
  wurzel.appendChild(rahmen);

  let aktiv: ScreenId = 'uebersicht';
  let screen: Screen | null = null;

  const kontext: UiKontext = {
    store,
    gehZu(ziel: ScreenId): void {
      aktiv = ziel;
      zeichneScreen();
      window.scrollTo(0, 0);
    },
    neuRendern(): void {
      zeichneScreen();
    },
  };

  const tabKnoepfe = TABS.map((tab) => {
    const b = el('button', `leiste-knopf${tab.haupt ? ' haupt' : ''}`);
    b.type = 'button';
    b.appendChild(el('span', 'leiste-punkt'));
    b.appendChild(el('span', 'leiste-schrift', tab.kurz));
    b.addEventListener('click', () => kontext.gehZu(tab.id));
    leiste.appendChild(b);
    return b;
  });

  function zeichneScreen(): void {
    const definition = TABS.find((t) => t.id === aktiv) ?? TABS[0];
    if (definition) {
      titel.textContent = definition.titel;
      unter.textContent = definition.unter;
    }

    tabKnoepfe.forEach((b, i) => {
      const tab = TABS[i];
      const istAktiv = tab !== undefined && tab.id === aktiv;
      b.classList.toggle('aktiv', istAktiv);
      b.setAttribute('aria-current', istAktiv ? 'page' : 'false');
    });

    leeren(inhalt);
    screen = BAUER[aktiv](kontext);
    inhalt.appendChild(screen.el);
  }

  /** Speicherstatus und Fehler gehören ganz nach oben — auf JEDEM Screen sichtbar. */
  function zeichneBanner(): void {
    const status = store.getStatus();
    leeren(bannerBereich);

    if (status.tier === 'memory') {
      const box = el('div', 'banner');
      box.setAttribute('role', 'alert');
      box.appendChild(el('strong', 'banner-titel', 'Nichts wird gespeichert'));
      box.appendChild(
        el(
          'span',
          'banner-text',
          'Dieses Gerät lässt kein dauerhaftes Speichern zu. Alle Eingaben gehen verloren, ' +
            'sobald du Sparreise schließt. Exportiere deine Daten jetzt.',
        ),
      );
      const zuDaten = el('button', 'knopf-flach', 'Zu Daten & Sicherung');
      zuDaten.type = 'button';
      zuDaten.addEventListener('click', () => kontext.gehZu('daten'));
      box.appendChild(zuDaten);
      bannerBereich.appendChild(box);
    }

    if (status.letzterFehler !== null) {
      const box = el('div', 'banner');
      box.setAttribute('role', 'alert');
      box.appendChild(el('strong', 'banner-titel', 'Speicherproblem'));
      box.appendChild(el('span', 'banner-text', status.letzterFehler));
      bannerBereich.appendChild(box);
    }
  }

  store.subscribe(() => {
    zeichneBanner();
    if (screen && screen.aktualisieren) screen.aktualisieren();
  });

  // Beim Drehen ändert sich die Containerbreite — die Diagramme messen sich neu aus,
  // sonst werden ihre Beschriftungen im Hochformat heruntergerechnet.
  // Nur auf Breitenänderungen reagieren: das Ein-/Ausblenden der iOS-Adressleiste
  // und die aufklappende Tastatur feuern `resize` ständig, ändern aber nur die Höhe.
  let letzteBreite = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === letzteBreite) return;
    letzteBreite = window.innerWidth;
    if (screen && screen.aktualisieren) screen.aktualisieren();
  });

  zeichneScreen();
  zeichneBanner();
}

/**
 * Zeigt eine für die Nutzerin sichtbare Fehlermeldung an (Banner).
 * Wird auch von main.ts bei Startfehlern genutzt, sobald die UI steht.
 */
export function fehlerAnzeigen(wurzel: HTMLElement, text: string): void {
  const box = el('div', 'banner');
  box.setAttribute('role', 'alert');
  box.appendChild(el('strong', 'banner-titel', 'Fehler'));
  box.appendChild(el('span', 'banner-text', text));

  const bereich = wurzel.querySelector('.banner-bereich');
  if (bereich) {
    bereich.appendChild(box);
    return;
  }
  // Noch keine UI vorhanden: direkt oben in die Wurzel.
  box.style.margin = '1rem';
  wurzel.insertBefore(box, wurzel.firstChild);
}
