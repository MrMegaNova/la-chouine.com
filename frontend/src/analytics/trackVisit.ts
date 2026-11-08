import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { visitsApi } from '@/api/client';
import { useAuthStore } from '@/store/authStore';

/**
 * Le visiteur refuse-t-il la mesure d'audience ? Réglage « Ne pas me suivre »
 * ou Global Privacy Control du navigateur (annoncé sur la page Confidentialité).
 */
export function trackingRefused(nav: Navigator = navigator): boolean {
  const n = nav as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  return n.globalPrivacyControl === true || n.doNotTrack === '1' || n.msDoNotTrack === '1';
}

const SOURCE_PARAMS = ['src', 'utm_source'];

/**
 * Campagne d'arrivée (#290) : `?src=affiche` (ou `utm_source`). Seules les
 * valeurs simples sont gardées ; le serveur les vérifie aussi.
 */
export function campaignSource(search: string): string | undefined {
  const params = new URLSearchParams(search);
  for (const name of SOURCE_PARAMS) {
    const value = params.get(name)?.trim().toLowerCase();
    if (value && /^[a-z0-9_-]{1,40}$/.test(value)) return value;
  }
  return undefined;
}

/**
 * Adresse sans les paramètres de campagne, pour qu'un lien recopié ou partagé
 * ne compte pas une seconde fois pour la même campagne. `null` si rien à retirer.
 */
export function withoutCampaign(href: string): string | null {
  const url = new URL(href);
  if (!SOURCE_PARAMS.some(name => url.searchParams.has(name))) return null;
  for (const name of SOURCE_PARAMS) url.searchParams.delete(name);
  return url.pathname + url.search + url.hash;
}

/** Envoie une page vue à chaque changement de page (#311). */
export function useVisitTracking() {
  const { pathname, search } = useLocation();
  const first = useRef(true);

  useEffect(() => {
    if (trackingRefused()) return;
    const isFirst = first.current;
    first.current = false;
    // Site d'origine et campagne : seulement pour la première page de la visite.
    const referrer = isFirst ? document.referrer || undefined : undefined;
    const source = isFirst ? campaignSource(search) : undefined;
    visitsApi.track({ path: pathname, referrer, source }, useAuthStore.getState().token);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une page vue par chemin, pas par requête
  }, [pathname]);

  // Retire `?src=` de l'adresse, même si la mesure est refusée.
  useEffect(() => {
    const clean = withoutCampaign(window.location.href);
    if (clean) window.history.replaceState(window.history.state, '', clean);
  }, []);
}
