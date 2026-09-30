# Environments: local, staging, production

One codebase builds the extension for each environment. The hosts, the OAuth client and the extension ID come from an env file.

| | Local | Staging | Production |
|---|---|---|---|
| Env file | `.env`, your own, git-ignored | `.env.staging`, committed | `.env.production`, committed |
| Web app | `http://localhost:4300` | `https://devapp.hustlen.ai` | `https://app.hustlen.ai` |
| API | `http://localhost:5004/api` | `https://devapp.hustlen.ai/server/api` | `https://app.hustlen.ai/server/api` |
| Name in the browser | hustlen.ai | **hustlen.ai STG** | hustlen.ai |
| Extension ID | from your `.env` key | `efnmckkaaknobocjdmmioepejamcmpap` | `cengnipjmfhjcdchinmldhpkibpahcki` for the sideloaded test build; the store assigns its own |
| OAuth redirect URI | `https://<your-id>.chromiumapp.org/` | `https://efnmckkaaknobocjdmmioepejamcmpap.chromiumapp.org/` | `https://cengnipjmfhjcdchinmldhpkibpahcki.chromiumapp.org/`, plus the store IDs later |
| Build | `npm run dev` | `npm run build:stg` → `.output/chrome-mv3-staging` | `npm run build:prod` → `.output/chrome-mv3` |
| Zip to share | | `npm run zip:stg` → `*-chrome-staging-sideload.zip`, `*-edge-staging-sideload.zip` | `npm run zip:prod` → `*-chrome-sideload.zip`, `*-edge-sideload.zip` |
| Store packages | | | `npm run zip:store` → `*-chrome.zip`, `*-edge.zip`, `*-firefox.zip`, `*-sources.zip`, with no `key` |

Each ID is fixed by the public key in `WXT_MANIFEST_KEY`. Because staging and production have different IDs and names, both can be installed side by side in one browser.

The committed env files hold **no secrets**: URLs, the public OAuth client ID and a public key. The matching private keys are in `.keys/`, which is git-ignored. Loading or zipping an unpacked build doesn't need them; keep them only if you ever want to pack a `.crx` with the same ID.

A staging or production build **fails** if either URL is not public `https`, for example if it points at localhost. WXT loads `.env` before `.env.<mode>`, so without this check a missing value would silently fall back to your local setup.

## Server setup (once per environment)

Do this on the **staging** server for devapp.hustlen.ai and again on the **production** server for app.hustlen.ai.

1. **Deploy the backend.** Staging runs `develop` and production runs `main`. Both branches already include the extension API (chamba-ai-backend-fastapi #302, #303, #305 and #319). Until it is deployed, `GET /server/api/extension/plan` returns `404`; once it is live, it returns `401` without a token.

2. **Run the migrations** in the backend directory, with its virtualenv active. They add the extension screening-answer prompt and use the existing OAuth tables.
   ```bash
   alembic upgrade head
   ```

3. **Add two variables to the backend env file**, the same file that holds `JWT_SECRET` and `DATABASE_URL`.

   Staging:
   ```
   EXTENSION_OAUTH_CLIENT_ID=hustlen-extension
   EXTENSION_OAUTH_REDIRECT_URIS=https://efnmckkaaknobocjdmmioepejamcmpap.chromiumapp.org/
   ```

   Production:
   ```
   EXTENSION_OAUTH_CLIENT_ID=hustlen-extension
   EXTENSION_OAUTH_REDIRECT_URIS=https://cengnipjmfhjcdchinmldhpkibpahcki.chromiumapp.org/
   ```

   - The value is a comma-separated list, with no spaces and **with the trailing `/`**. It must match exactly, or the consent page shows "This connection request is not valid".
   - After the store release, append the Chrome Web Store and Edge IDs to the production list, for example `https://cengni….chromiumapp.org/,https://<cws-id>.chromiumapp.org/,https://<edge-id>.chromiumapp.org/`.
   - The client ID must equal `WXT_OAUTH_CLIENT_ID` in `.env.staging` / `.env.production`.

4. **Restart the backend** so it picks up the new variables. Run the Celery worker restart as well if it shares the env file.

5. **Deploy the frontend.** Use `npm run build:staging` for staging and `npm run build:prod` for production. The frontend must include the consent page `/extension/connect` (chamba-ai #421) and the dashboard card (chamba-ai #430). Leave `extensionStoreUrl` empty until the store listing is live.

6. **Check it.**
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://devapp.hustlen.ai/server/api/extension/plan   # 401 = deployed
   curl -s -o /dev/null -w '%{http_code}\n' https://app.hustlen.ai/server/api/extension/plan      # 401 = deployed
   ```

**No CORS or nginx changes are needed.** The extension calls the API from its service worker with `host_permissions`, and every path lives under the existing `/server/api` proxy.

## Install a build for testing

1. Run `npm ci`, then `npm run build:stg` or `npm run build:prod`. Alternatively, send testers the zip from `npm run zip:stg` / `npm run zip:prod`; they unzip it first.
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose `.output/chrome-mv3-staging` or `.output/chrome-mv3`, or the unzipped folder.
4. Check the ID shown on the card against the table above. If it differs, the key did not make it into the build.
5. Open the side panel and click **Connect**. It opens `https://devapp.hustlen.ai/extension/connect` or `https://app.hustlen.ai/extension/connect`; sign in there with an account of that environment.

After a rebuild, click **Reload** on the extension card. The ID stays the same.

## Firefox

- Staging builds get the gecko ID `extension-stg@hustlen.ai`; production builds get `extension@hustlen.ai`.
- For a temporary test, run `npx wxt build -b firefox --mv3 --mode staging`, open `about:debugging` → *This Firefox* → *Load Temporary Add-on*, and pick `manifest.json`.
- Firefox's redirect URI differs from Chrome's. It is the value of `browser.identity.getRedirectURL()`, which you can see in the add-on's console. Add it to `EXTENSION_OAUTH_REDIRECT_URIS` if you test sign-in on Firefox.
