/**
 * Where the dashboard (`apps/web`) lives. Set PUBLIC_APP_URL per environment;
 * defaults: the local Vite dev server in `astro dev`, app.rapiz.vn in builds (docs/04).
 */
const configured = import.meta.env.PUBLIC_APP_URL?.trim();
const appUrl = (
  configured || (import.meta.env.DEV ? 'http://localhost:5173' : 'https://app.rapiz.vn')
).replace(/\/+$/, '');

export const loginUrl = `${appUrl}/login`;
export const signupUrl = `${appUrl}/signup`;
