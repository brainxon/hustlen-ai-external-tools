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
  // Store packages: never ship env files (secrets, dev hosts) in the Firefox sources zip.
  zip: { excludeSources: ['.env', '.env.*', '!.env.example', '.output/**', 'coverage/**'] },
  manifest: ({ browser }) => ({
    name: '__MSG_extName__',
    short_name: 'hustlen.ai',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // Pins a stable extension id in dev builds so the OAuth redirect URI
    // (https://<id>.chromiumapp.org/) stays allow-listed. Store builds get
    // their id from the store; see README "OAuth redirect URI".
    ...(process.env.WXT_MANIFEST_KEY ? { key: process.env.WXT_MANIFEST_KEY } : {}),
    permissions: ['storage', 'identity', 'activeTab', 'scripting', 'tabs', ...(browser === 'firefox' ? [] : ['sidePanel'])],
    host_permissions: [`${apiOrigin}/*`],
    // Requested at runtime, only when the user opts in from the side panel
    // ("Work on every job site"); until then other sites rely on activeTab.
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: { default_title: 'hustlen.ai' },
    commands: {
      autofill: {
        suggested_key: { default: 'Alt+Shift+F' },
        description: '__MSG_cmdAutofill__',
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
