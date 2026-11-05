// Enregistrement du service worker (#212). Appelé depuis main.tsx, jamais au
// pré-rendu, et seulement en production.
//
// Le SPA ne recharge pas sa page : sans ce module, un onglet ou une PWA restés
// ouverts garderaient l'ancien code après un déploiement. Un nouveau service
// worker signale donc la nouvelle version, et l'app se recharge au prochain
// changement de page, jamais pendant une partie (voir App.tsx).

let updatePending = false;

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  const { serviceWorker } = navigator;

  // À la première installation, le service worker prend le contrôle de la page
  // sans qu'il y ait de nouvelle version : ce premier signal est ignoré.
  let controlled = serviceWorker.controller !== null;
  serviceWorker.addEventListener('controllerchange', () => {
    if (controlled) updatePending = true;
    controlled = true;
  });

  window.addEventListener('load', () => {
    serviceWorker.register('/sw.js').then(registration => {
      // Le navigateur ne vérifie sw.js qu'aux vraies navigations, rares ici.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {});
      });
    }).catch(err => console.warn('Service worker non enregistré :', err));
  });
}

/** Recharge la page si une nouvelle version a été déployée depuis son ouverture. */
export function applyPendingUpdate(reload: () => void = () => window.location.reload()): void {
  if (updatePending) reload();
}
