/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Version de la release, posée à la construction de l'image (#311). */
  readonly VITE_APP_VERSION?: string;
}

declare module '*.module.scss' {
  const classes: Record<string, string>;
  export default classes;
}
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
