/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Clé publique Cloudflare Turnstile (#104) — captcha optionnel à l'inscription.
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

declare module '*.module.scss' {
  const classes: Record<string, string>;
  export default classes;
}
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
