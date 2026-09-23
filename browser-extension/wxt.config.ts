import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

// Target hosts come from env (see .env.example) so one codebase builds for
// local, staging (devapp.hustlen.ai) and production (app.hustlen.ai).
const apiBase = process.env.WXT_API_BASE_URL ?? 'http://localhost:5004/api';
const apiOrigin = new URL(apiBase).origin;

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/auto-icons'],
  autoIcons: { baseIconPath: 'assets/icon.svg', developmentIndicator: false },
  vite: () => ({ plugins: [preact()] }),
  manifest: ({ browser }) => ({
    name: 'hustlen.ai – Job Application Autofill',
    short_name: 'hustlen.ai',
    description: 'Autofill and track job applications from your hustlen.ai Master CV.',
    // Pins a stable extension id in dev builds so the OAuth redirect URI
    // (https://<id>.chromiumapp.org/) stays allow-listed. Store builds get
    // their id from the store; see README "OAuth redirect URI".
    ...(process.env.WXT_MANIFEST_KEY ? { key: process.env.WXT_MANIFEST_KEY } : {}),
    permissions: ['storage', 'identity', 'activeTab', 'scripting', 'tabs', ...(browser === 'firefox' ? [] : ['sidePanel'])],
    host_permissions: [`${apiOrigin}/*`],
    action: { default_title: 'hustlen.ai' },
    commands: {
      autofill: {
        suggested_key: { default: 'Alt+Shift+F' },
        description: 'Autofill the application form on this page',
      },
      _execute_action: { suggested_key: { default: 'Alt+Shift+H' } },
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'extension@hustlen.ai',
              strict_min_version: '128.0',
              // Sends job-page content (posting text, screening questions) to hustlen.ai and holds OAuth tokens.
              data_collection_permissions: { required: ['websiteContent', 'authenticationInfo'] },
            },
          },
        }
      : {}),
  }),
});
