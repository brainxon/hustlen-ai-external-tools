# Publishing the hustlen.ai extension

Status as of 2026-09-24 covers the Chrome Web Store (CWS), Microsoft Edge Add-ons and Firefox AMO. Sources are listed at the end.

## 0. Once, before the first release

| # | Task | Owner |
|---|---|---|
| 1 | **Register a CWS developer account.** US$5 one-time fee. Use a company Google account with 2-Step Verification, not a personal one. Declare **Trader** status under the EU Digital Services Act; the company address, phone and email are then shown publicly. | Company |
| 2 | **Privacy policy.** Section 9, "hustlen.ai Browser Extension", of `https://hustlen.ai/privacy-policy` (de/en/es/pt, brainxon/hustlen-ai-landing#1) covers the extension and the Limited Use statement. `PRIVACY.md` is the source text; keep both in sync. | Landing |
| 3 | **Support contact:** `support@hustlen.ai`. | Company |
| 4 | **Get the store IDs for OAuth.** Upload a first `zip:store` package to CWS as a draft **without publishing**, and note the item ID. If sideloaded production builds should share the store ID, go to *Package → View public key* and put that key in `.env.production` as `WXT_MANIFEST_KEY`. Otherwise keep the test key; see [ENVIRONMENTS.md](ENVIRONMENTS.md). | Dev |
| 5 | **Register the backend OAuth redirect URIs** in the production backend env. Append them to the test ID from [ENVIRONMENTS.md](ENVIRONMENTS.md): `EXTENSION_OAUTH_REDIRECT_URIS=https://cengnipjmfhjcdchinmldhpkibpahcki.chromiumapp.org/,https://<cws-id>.chromiumapp.org/,https://<edge-id>.chromiumapp.org/,https://<firefox-uuid>.extensions.allizom.org/`. Edge assigns its **own** ID; add it after the first Edge upload. | Backend |
| 6 | **Set `extensionStoreUrl`** in `chamba-ai` `environment.prod.ts`. This turns on the dashboard card's "Add to Chrome" button. | Frontend |
| 7 | **Microsoft Partner Center** account for Edge. Free. | Company |
| 8 | **Firefox AMO** developer account. Free. | Company |

## 1. Production build

```bash
cd browser-extension
# .env.production is committed (app.hustlen.ai hosts); see ENVIRONMENTS.md.
npm ci && npm test && npm run compile
# Bump "version" in package.json first; every store rejects a version it has already seen.
npm run zip:store      # .output/*-chrome.zip, *-edge.zip, *-firefox.zip, *-sources.zip
```

- **No `key` in store builds.** `zip:store` sets `WXT_STORE_BUILD=1`, which drops `WXT_MANIFEST_KEY`; the store supplies the ID. The `*-sideload.zip` files from `zip:prod` / `zip:stg` are for testers only. Never upload them.
- **Env files in packages.** The Firefox sources zip includes `.env.production`, so the reviewer can rebuild the package. It never includes `.env`, `.env.local`, `.env.*.local`, `.env.submit`, `.env.staging` or `.keys/`.

## 2. Chrome Web Store listing

The first upload is manual. The API can't create a new item.

**Assets**
- Icon: 128×128, generated from `src/assets/icon.svg`.
- 1 to 5 screenshots at **1280×800**. Suggested set:
  1. Autofill on Greenhouse
  2. Screening answers
  3. Side panel with tailored documents
  4. "Save new answers?" prompt
  5. Plan card
- Small promo tile: **440×280**, required.
- Marquee tile: 1400×560, optional.

**Name:** hustlen.ai – Job Application Autofill. The `_locales` folder already translates the name into de and es.

**Short description, 132 characters max:**
- EN: Autofill job applications in one click from your hustlen.ai Master CV and saved answers. Free. Works on Workday, Greenhouse & more.
- DE: Bewerbungen mit einem Klick aus deinem hustlen.ai Master-Lebenslauf und gespeicherten Antworten ausfüllen. Kostenlos.
- ES: Autocompleta postulaciones en un clic con tu CV maestro de hustlen.ai y tus respuestas guardadas. Gratis.

**Long description (EN; translate the same structure for de/es):**
> Applying to jobs just got easier.
> - Autofill application forms in one click, on Workday, Greenhouse, Lever, Ashby, SmartRecruiters, LinkedIn Easy Apply and any other job site.
> - Your answers, reused: work authorization, salary, notice period and your own custom answers fill instantly. The extension learns new answers you type, with your permission.
> - Attaches your CV automatically.
> - Save every job you apply to and track it in hustlen.ai.
> - Tailor your CV and cover letter to the job, with AI and your review.
> - You stay in control. Every filled field is highlighted, and the extension never submits for you.
> - Autofill is free. AI features use your hustlen.ai plan's credits.

**Category:** Productivity (alternative: Tools). **Language:** English; add the German and Spanish listings.

## 3. CWS "Privacy practices" tab

**Single purpose:**
> Help job seekers fill in and track job applications using their hustlen.ai profile, saved answers and CV.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Keeps the user's saved answers and settings in the browser, and keeps the signed-in session and profile cache in memory. |
| `identity` | Signs the user in to their hustlen.ai account with OAuth 2.1 + PKCE (`launchWebAuthFlow`). No password is stored. |
| `activeTab` | Reads the job posting and fills the application form on the page when the user clicks the extension or uses its shortcut. |
| `scripting` | Injects the autofill script into the current tab on user action. Optionally does the same on every job site once the user grants access. |
| `tabs` | Lets the side panel follow the active tab's URL, so it can detect the job, avoid duplicates and offer the right actions. |
| `sidePanel` | The extension's main UI. |
| Host permission `https://app.hustlen.ai/*` | Calls the user's own hustlen.ai account API. |
| Content scripts on known ATS domains | Detect application forms and show the Autofill button on Greenhouse, Lever, Workday, Ashby and similar sites. |
| **Optional** host permissions `https://*/*`, `http://*/*` | Requested only when the user clicks "Work on every job site". Lets autofill run on any company career page. It never runs on hustlen.ai, local sites or clearly non-job sites. |

**Remote code:** No. All code is bundled; no `eval` or remote scripts.

**Data usage checkboxes:**
- Personally identifiable information: the profile used to fill forms.
- Authentication information: OAuth tokens.
- Website content: the job posting and form questions.
- User activity: form answers, **only with opt-in**.

Certify all three: not sold; not used for unrelated purposes; not used for creditworthiness or lending.

**Privacy policy URL:** `https://hustlen.ai/privacy-policy?lang=en`. Section 9 covers the extension; use `?lang=de` / `?lang=es` for those listings.

**In-product disclosure:** already built. The "Remember answers I type" toggle and the first-submit opt-in prompt give a prominent disclosure and require the user to act, as the User Data policy requires.

## 4. Review and rollout

- **Visibility:** start as **Unlisted** or **Private**, with trusted testers or a Google Group for a beta. Switch to Public after feedback.
- **Review time:** a few days is typical; up to 3 weeks. It takes longer for new developer accounts, broad host access and the `tabs` permission. We already keep broad access *optional*, which helps.
- **Publishing:** untick "publish automatically" to use **staged publish**, then press *Publish* when backend and frontend are live. You have 30 days after approval.
- **Percentage rollout:** only available above 10,000 weekly active users.

## 5. Edge and Firefox

- **Edge Add-ons:** upload `*-edge.zip` in Partner Center. The privacy fields mirror CWS. Assets: a 300×300 logo and screenshots at 1280×800. Certification takes up to 7 business days. **The Edge ID is different**, so add its redirect URI to the backend.
- **Firefox AMO:**
  - Upload `*-firefox.zip` **and** `*-sources.zip`. A sources zip is required because the code is bundled and minified.
  - The reviewer builds it with `npm ci && npm run build:firefox:store` (Node 22+).
  - The `data_collection_permissions` field is already declared, as required for new add-ons since 2025-11-03.
  - Test the resume auto-attach on Firefox: `File`/`DataTransfer` crossing content-script contexts can behave differently there.

## 6. Automated updates (after the first manual release)

```bash
npm run submit:init      # interactive: stores the CWS v2 service account, Edge API key and AMO JWT in .env.submit
npm run zip:store
npm run submit -- --dry-run   # check auth
npm run submit -- --chrome-publish-type STAGED_PUBLISH
```

- **Use the CWS API v2.** The script already passes `--chrome-api-version v2`. **The v1 API stops working on 2026-10-15.**
- Keep `.env.submit` out of git. `.gitignore` already covers `.env.*`.
- Recommended: a CI job, for example a GitHub Action on version tags, that runs `npm test`, `npm run zip:store` and `npm run submit`, with the secrets stored in the CI.

## 7. Pre-submission checklist

- [ ] `npm test` and `npm run compile` pass; version bumped.
- [ ] Store packages built with `npm run zip:store`, so they have no `key` in the manifest.
- [ ] Backend deployed with `EXTENSION_OAUTH_CLIENT_ID` and a redirect URI for every store ID.
- [ ] Privacy policy live; support contact set.
- [ ] Screenshots and promo tile at 1280×800 and 440×280.
- [ ] Smoke test of the store build: connect → autofill (Greenhouse, Workday, Lever) → save job → tailor → download (after review) → answer learning → disconnect from the dashboard.
- [ ] `extensionStoreUrl` set in chamba-ai prod after approval.

## Sources

- [Register](https://developer.chrome.com/docs/webstore/register)
- [Images](https://developer.chrome.com/docs/webstore/images)
- [Privacy tab](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)
- [Review process](https://developer.chrome.com/docs/webstore/review-process)
- [Distribution](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
- [CWS API v2](https://developer.chrome.com/blog/cws-api-v2)
- [Manifest key](https://developer.chrome.com/docs/extensions/reference/manifest/key)
- [Edge publishing](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
- [AMO source code](https://extensionworkshop.com/documentation/publish/source-code-submission/)
- [Firefox data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
- [WXT publishing](https://wxt.dev/guide/essentials/publishing)
