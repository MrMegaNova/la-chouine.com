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

/** Envoie une page vue à chaque changement de page (#311). */
export function useVisitTracking() {
  const { pathname } = useLocation();
  const first = useRef(true);

  useEffect(() => {
    if (trackingRefused()) return;
    // Site d'origine : seulement pour la première page de la visite.
    const referrer = first.current ? document.referrer || undefined : undefined;
    first.current = false;
    visitsApi.track({ path: pathname, referrer }, useAuthStore.getState().token);
  }, [pathname]);
}
