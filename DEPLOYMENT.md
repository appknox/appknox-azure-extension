# Appknox Azure DevOps Extension — Deployment & Usage Guide

This covers how to build, test, and publish the Appknox Azure Pipelines extension,
and how end users configure the task once it's installed.

## Quick links

| What | URL |
|---|---|
| Azure DevOps entry point — find/switch orgs, and where you actually install and run test pipelines | https://aex.dev.azure.com/ |
| Generate a Marketplace-publish PAT (`appknox` org) | https://dev.azure.com/appknox/_usersSettings/tokens |
| Manage the `appknox` Marketplace publisher & its extensions (versions, publish history, delete) | https://marketplace.visualstudio.com/manage/publishers/appknox |

Note: `portal.azure.com` (the Azure Portal, for cloud resources like VMs/storage) is a
**different product** from Azure DevOps (`dev.azure.com`, for Pipelines/Repos/extensions).
Extensions and pipelines are never reachable from the Azure Portal.

## Extensions in play

This repo publishes to **two separate Marketplace listings**, both built from the same
source. They have independent version histories — publishing one does not affect the other.

| Extension | `id` in `vss-extension.json` | Purpose |
|---|---|---|
| `Appknox` | `Appknox` | Production. Public, used by real customers. |
| `appknox-test` | `appknox-test` | Private. Used to validate changes in a test Azure DevOps org before touching production. |

**Always test against `appknox-test` first**, then switch `id`/`name` in `vss-extension.json`
to `Appknox` for the production publish.


---

## Prerequisites

- Node.js and npm installed
- `tfx-cli` installed globally: `npm install -g tfx-cli`
- Publisher access to the `appknox` Marketplace publisher account
  (https://marketplace.visualstudio.com/manage/publishers/appknox)
- A Personal Access Token (PAT) with Marketplace publish scope (see below)

### Creating the PAT for publishing

The token needs **Marketplace (Manage)** scope, not a regular Azure DevOps org-scoped token.

1. Go to https://dev.azure.com/appknox/_usersSettings/tokens (or any other Azure DevOps
   organization you're a member of — Marketplace PATs aren't scoped to a single org, see
   step 3).
2. Click **New Token**.
3. Set:
   - **Name**: something identifiable, e.g. `appknox-extension-publish`
   - **Organization**: **All accessible organizations** — this matters, Marketplace publishing
     isn't scoped to a single org.
   - **Expiration**: pick what your security policy allows (Marketplace tokens can't be
     unlimited).
   - **Scopes**: choose **Custom defined**, then check **Marketplace → Manage**
     (publish, manage, and share extensions).
4. Click **Create**, then **copy the token immediately** — Azure DevOps only shows it once.
5. Export it in your shell before running any `tfx` publish command:
   ```bash
   export TFX_TOKEN=<paste-token-here>
   ```

---

## Repository layout

```
vss-extension.json              # extension manifest — id, name, version, publisher
buildAndReleaseTask/
  task.json                     # task definition — GUID, version, inputs
  index.ts                      # task logic (compiles to index.js)
  package.json                  # "version" (task version) + "binary" (appknox-go CLI version)
overview.md                     # Marketplace listing page content (bundled into the extension)
README.md                       # short dev/build quick-reference
```

---

## Two things that must NEVER change carelessly

These caused real incidents during development — both are one-character-typo-away from
breaking every existing customer pipeline.

### 1. The task GUID (`buildAndReleaseTask/task.json` → `"id"`)

```json
"id": "d0f16a13-2e67-46b5-a4b4-72f5c2ddfa4c"
```

This GUID is the permanent identity of the task across **every** version ever published.
If it changes even by one character, publishing fails Marketplace validation with:

```
Task ID mismatch between extension versions. To publish the extension, continue to
use same task ID for a contribution in all the versions.
```

If it doesn't fail loudly (e.g. on a brand-new, never-published extension), it silently
orphans every existing pipeline that references the old GUID. **Never regenerate or
hand-edit this value.** If you ever see a diff touching this line, stop and verify against
the currently-live production `task.json` before proceeding.

**Known drift on `appknox-test` (discovered Sept 2026):** the `appknox-test` listing's
published history has the GUID `...fa4d`, one character off from the real, correct GUID
`...fa4c` that's actually in this repo and live in production. It happened from
alternating between two local copies during a rapid test-iteration session, and the wrong
one ended up published last. `appknox-test` already has real installs in at least one org,
so deleting and recreating the listing (which would let it pick up the correct GUID fresh)
isn't an option. Until that listing is deliberately fixed, **any build published to
`appknox-test` must use `...fa4d`**, not the real `...fa4c` — build it with the GUID
temporarily hand-edited to `...fa4d` (never commit that edit), publish, then revert to
`...fa4c` before committing anything else. Production (`Appknox`) is unaffected and must
always use the correct `...fa4c`.

### 2. Version numbers — not all three files carry the same weight

| File | When to bump | Why |
|---|---|---|
| `vss-extension.json` → `"version"` | **Every single publish, no exceptions.** | Marketplace hard-requires this to strictly increase, or the publish is rejected outright. |
| `buildAndReleaseTask/task.json` → `"version"` | Whenever `task.json` or `index.ts` actually changes (new inputs, logic changes, etc.) — bump it *in the same publish* as the change, not deferred to later. | Azure DevOps's task catalog registers task versions by GUID + version. If this stays the same across two extension publishes, the catalog may not recognize a new task version — meaning your actual code/input changes might not reach users even though the extension "publish" itself succeeds. |
| `buildAndReleaseTask/package.json` → `"version"` | Optional / cosmetic. | Not read by `tfx` or Marketplace validation at all — plain npm metadata for that sub-package. Kept in sync with `task.json` here purely for readability, not because anything technical requires it. |

In practice: if you're touching `task.json`/`index.ts`, bump both `vss-extension.json` and
`task.json` together. If you're only changing something outside `buildAndReleaseTask/`
(e.g. `overview.md`, images), `vss-extension.json` alone needs to move.

Also: the Marketplace tracks "last version seen" independently of whether a publish
attempt actually succeeds. A failed publish (e.g. a validation error) can still consume
that version number — if you hit "version must increase" on a version you never
successfully published, just bump again and retry.

### 3. `binary` field is a separate version axis entirely

```json
// buildAndReleaseTask/package.json
"binary": "1.8.5"
```

This pins which `appknox-go` CLI release gets downloaded at pipeline runtime
(`buildAndReleaseTask/index.ts` → `installAppknox()`), independent of the extension/task
version above. If a task input needs a CLI flag that a given `appknox-go` version
doesn't support yet (e.g. `--health-score-threshold`), check the CLI's release notes at
https://github.com/appknox/appknox-go/releases and bump this field — bumping the
extension version alone does nothing for this.

---

## Building and packaging

```bash
# from repo root
npm run compile
```

This runs, in order:
1. `cd buildAndReleaseTask && npm run compile` → `tsc` compiles `index.ts` → `index.js`
2. `tfx extension create --manifests vss-extension.json` → produces
   `<Publisher>.<id>-<version>.vsix` in the repo root

Sanity-check the packaged VSIX before publishing — don't trust the version bump blindly:

```bash
unzip -p <Publisher>.<id>-<version>.vsix buildAndReleaseTask/task.json | grep '"id"\|"Patch"'
```

Confirm the GUID matches the one above and the patch number matches what you intended.

---

## Testing before production

1. In `vss-extension.json`, set `"id": "appknox-test"` and `"name": "Appknox-test"`.
2. Build and publish per below.
3. Share the extension with your test Azure DevOps org if not already shared:
   ```bash
   tfx extension publish --vsix <file>.vsix --publisher appknox --token $TFX_TOKEN --share-with <your-test-org>
   ```
4. Install/update it in the test org — find/access your Azure DevOps orgs at
   https://aex.dev.azure.com/ — add the `Appknox` task to a real pipeline, and exercise
   both `thresholdType: risk` and `thresholdType: healthScore` paths (and any other inputs
   the current change touches, e.g. `triggerKnoxiq`, `generatePdfReport`).
5. Only once verified, switch `id`/`name` back to `Appknox` (production), bump the version
   again to a number higher than whatever's currently live, rebuild, and publish.

## Publishing

```bash
tfx extension publish --vsix <Publisher>.<id>-<version>.vsix --publisher appknox --token $TFX_TOKEN
```

Note the console output — Marketplace validation for a new version can take up to ~20
minutes to fully clear even after "Publishing: success" is reported. You can poll status
explicitly:

```bash
tfx extension isvalid --publisher appknox --extension-id <id> \
  --version <version> --service-url https://marketplace.visualstudio.com/ --token $TFX_TOKEN
```

After publishing, the installed-org's "Installed version" in Organization Settings →
Extensions can also lag behind what's live on the Marketplace by a while — that's normal
propagation delay, not a sign anything went wrong.

---

## Using the task in a pipeline

### Task inputs

| Input | Required? | Description |
|---|---|---|
| `filePath` | true | Path to the APK/IPA binary file |
| `accessToken` | true | Appknox API access token |
| `thresholdType` | true | Which threshold to enforce. `risk` requires `riskThreshold` to be set; `healthScore` requires `healthScoreThreshold` to be set. Defaults to `risk` |
| `riskThreshold` | true (when `thresholdType` is `risk`) | `Low` / `Medium` / `High` / `Critical`. Defaults to `Low` |
| `healthScoreThreshold` | true (when `thresholdType` is `healthScore`) | Integer 0–100 |
| `host` | false | Custom Appknox host URL. Leave blank to use the default |

Existing pipelines from before `thresholdType` existed (i.e. ones that only set
`riskThreshold`, with no `thresholdType`) continue to work unchanged — `thresholdType`
defaults to `risk` transparently, and their existing `riskThreshold` value is honored
exactly as before.

### Example — Risk Threshold

```yaml
- task: appknox@2
  inputs:
    filepath: './app/build/outputs/apk/debug/app-debug.apk'
    accessToken: '$(appknoxtoken)'
    thresholdType: 'risk'
    riskThreshold: 'medium'
    host: 'https://secure.appknox.com/'
```

### Example — Health Score Threshold

```yaml
- task: appknox@2
  inputs:
    filepath: './app/build/outputs/apk/debug/app-debug.apk'
    accessToken: '$(appknoxtoken)'
    thresholdType: 'healthScore'
    healthScoreThreshold: '70'
    host: 'https://secure.appknox.com/'
```

`$(appknoxtoken)` is a locked/secret pipeline variable — set it under the pipeline's
**Variables** tab with the lock icon enabled, rather than hardcoding a token in YAML.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `error: unknown flag: --health-score-threshold` | The downloaded `appknox-go` CLI version (`binary` field) predates that flag | Bump `buildAndReleaseTask/package.json` → `binary` to a CLI version that supports it |
| `Version number must increase each time an extension is published` | One of the three version fields wasn't bumped, or a prior failed publish already consumed that version number | Bump all three version fields together, even past a version that "should" be free |
| `Task ID mismatch between extension versions` | `task.json`'s `"id"` GUID doesn't match a previously published version | For `Appknox` (production): restore the correct GUID exactly, never regenerate it. For `appknox-test`: see "Known drift on `appknox-test`" above — that listing currently expects the *wrong* GUID |
| Pipeline runs an old plugin version despite publishing a new one | Marketplace validation delay, or the org hasn't pulled the update yet | Check Organization Settings → Extensions for "Installed version"; allow time, or reinstall to force a refresh |
| `Only one of riskThreshold or healthScoreThreshold can be provided` still shows even though the field is hidden in the UI | `visibleRule` only hides a field in the designer — it doesn't clear a previously-typed value | Re-check the actual `thresholdType` selection; this was superseded by the mandatory `thresholdType` selector, which makes the conflict structurally impossible |
