// Point d'entrée du pré-rendu (#271), compilé par `vite build --ssr` et utilisé
// uniquement à la compilation par scripts/prerender.mjs.
// Jamais servi au navigateur : le fast refresh ne le concerne pas.
/* eslint-disable react-refresh/only-export-components */
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import App from './App';

export { buildPageHtml, buildShellHtml, buildSitemap } from './seo/html';
export { PUBLIC_PAGES } from './seo/pages';

export function renderPage(path: string): string {
  return renderToString(
    <StrictMode>
      <StaticRouter location={path}>
        <App />
      </StaticRouter>
    </StrictMode>
  );
}
