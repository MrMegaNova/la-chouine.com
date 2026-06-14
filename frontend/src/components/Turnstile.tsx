import { useEffect, useRef } from 'react';

// Widget Cloudflare Turnstile (#104) — OPTIONNEL. Rendu uniquement si
// VITE_TURNSTILE_SITE_KEY est défini (sinon le composant ne rend rien et
// l'inscription fonctionne comme avant). Charge le script Cloudflare en mode
// `explicit` et remonte le token via `onToken`.
//
// NB : activer le captcha implique d'autoriser Cloudflare dans la CSP nginx
// (#118) : `script-src` + `frame-src` https://challenges.cloudflare.com.

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const SCRIPT_ID = 'cf-turnstile-script';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export const captchaEnabled = Boolean(SITE_KEY);

interface TurnstileGlobal {
  render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; 'error-callback'?: () => void }) => void;
}
declare global {
  interface Window { turnstile?: TurnstileGlobal }
}

export function Turnstile({ onToken }: { onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!SITE_KEY || !ref.current) return;
    let cancelled = false;
    const render = () => {
      if (cancelled || !ref.current || !window.turnstile) return;
      window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        callback: onToken,
        'error-callback': () => onToken(''),
      });
    };
    if (window.turnstile) { render(); return; }
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', render);
    return () => { cancelled = true; script?.removeEventListener('load', render); };
  }, [onToken]);

  if (!SITE_KEY) return null;
  return <div ref={ref} className="turnstile" />;
}
