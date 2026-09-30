import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

// Target hosts come from env so one codebase builds for local (.env),
// staging (.env.staging, --mode staging) and production (.env.production).
// See ENVIRONMENTS.md.
//
// WXT evaluates this file *before* it loads .env.<mode>, so the WXT_* values
// must be read lazily (env(), inside hooks/manifest), never at the top level.
// zip:store sets WXT_STORE_BUILD=1 in the shell: store packages never carry a
// manifest key, the store assigns the id.
const storeBuild = process.env.WXT_STORE_BUILD === '1';
const env = () => ({
  apiBase: process.env.WXT_API_BASE_URL ?? 'http://localhost:5004/api',
  appBase: process.env.WXT_APP_BASE_URL ?? 'http://localhost:4300',
  // "STG" -> the extension is named "hustlen.ai STG" and gets its own Firefox id.
  label: (process.env.WXT_ENV_LABEL ?? '').trim(),
  manifestKey: storeBuild ? '' : (process.env.WXT_MANIFEST_KEY ?? ''),
});

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/auto-icons'],
  autoIcons: { baseIconPath: 'assets/icon.svg', developmentIndicator: false },
  vite: () => ({ plugins: [preact()] }),
  // Firefox sources zip: keep .env.production (the reviewer rebuilds the store
  // package from it), never ship local env files, submit credentials or keys.
  zip: {
    includeSources: ['.env.production'],
    excludeSources: ['.env', '.env.local', '.env.*.local', '.env.submit', '.env.staging', '.keys/**', '.output/**', 'coverage/**'],
    // Sideload (keyed) and store (keyless) packages of the same mode must not overwrite each other.
    artifactTemplate: `{{name}}-{{packageVersion}}-{{browser}}{{modeSuffix}}${storeBuild ? '' : '-sideload'}.zip`,
  },
  outDirTemplate: `{{browser}}-mv{{manifestVersion}}{{modeSuffix}}${storeBuild ? '-store' : ''}`,
  hooks: {
    'config:resolved': (wxt) => {
      // Staging/production builds must never point at a dev machine. WXT loads
      // .env before .env.<mode>, so a missing value would inherit localhost.
      if (wxt.config.command === 'build' && wxt.config.mode !== 'development') {
        const { apiBase, appBase } = env();
        for (const url of [apiBase, appBase]) {
          if (!/^https:\/\//.test(url) || /localhost|127\.0\.0\.1/.test(url)) {
            throw new Error(`[${wxt.config.mode}] WXT_API_BASE_URL / WXT_APP_BASE_URL must be public https URLs, got "${url}". Check .env.${wxt.config.mode}.`);
          }
        }
      }
    },
  },
  manifest: ({ browser }) => {
    const { apiBase, label: envLabel, manifestKey } = env();
    return {
      name: envLabel ? `hustlen.ai ${envLabel}` : '__MSG_extName__',
      short_name: envLabel ? `hustlen ${envLabel}` : 'hustlen.ai',
      description: '__MSG_extDescription__',
      default_locale: 'en',
      // Pins a stable extension id in local/sideloaded builds so the OAuth
      // redirect URI (https://<id>.chromiumapp.org/) stays allow-listed. Store
      // builds get their id from the store; see ENVIRONMENTS.md.
      ...(manifestKey ? { key: manifestKey } : {}),
      permissions: ['storage', 'identity', 'activeTab', 'scripting', 'tabs', ...(browser === 'firefox' ? [] : ['sidePanel'])],
      host_permissions: [`${new URL(apiBase).origin}/*`],
      // Requested at runtime, only when the user opts in from the side panel
      // ("Work on every job site"); until then other sites rely on activeTab.
      optional_host_permissions: ['https://*/*', 'http://*/*'],
      action: { default_title: envLabel ? `hustlen.ai ${envLabel}` : 'hustlen.ai' },
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
                id: envLabel ? `extension-${envLabel.toLowerCase()}@hustlen.ai` : 'extension@hustlen.ai',
                strict_min_version: '128.0',
                // Sends job-page content (posting text, screening questions) to hustlen.ai and holds OAuth tokens.
                data_collection_permissions: { required: ['websiteContent', 'authenticationInfo'] },
              },
            },
          }
        : {}),
    };
  },
});
