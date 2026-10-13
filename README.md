# Pixname

Desktop app (Tauri 2) that renames media files to the Pixwel ingest filename standard, e.g.

```
PASSENGER_SOCIAL_EXPLAINER-VERTICAL-30_GRK_SUB_DATE_PRORES_1920p2398.mov
```

Names are rendered by the real `@pixwel/pixwel-sdk` (`Ingest.renderFilename` and `Ingest.mapFromMediainfo`),
the same code slurpee3 uses, so output matches what ingest produces.

## Installing

**macOS (no Gatekeeper prompt)**: with the [GitHub CLI](https://cli.github.com) logged in to an account that can see this repo:

```bash
gh release download -R Pixwel/pixname -p '*.app.tar.gz' -O - | tar -xz -C /Applications
```

Run the same command again to update. Builds aren't notarized yet, so a `.dmg` downloaded in a browser is
blocked on first launch. To allow it, go to **System Settings → Privacy & Security → Open Anyway**.

**Windows**: download the `.exe` installer from [Releases](https://github.com/Pixwel/pixname/releases).
If SmartScreen appears, choose **More info → Run anyway**.

## Using it

1. **Settings**: choose the environment and paste a service account (`svc_…`) or personal (`pat_…`) token.
2. Browse projects, then assets.
3. Drop files or folders:
   - **on an asset**: the files are assigned to that asset
   - **on a project**: assets are matched automatically
   - **anywhere else**: the project and asset are matched automatically
4. Review the proposed names, fix anything flagged, then click **Rename**. **Undo last rename** reverts the most recent batch.

## Where context comes from (later wins)

| Source | Gives |
|---|---|
| File name: a strict port of slurpee3 `parse.js`, plus loose hints for messy names (`GREEK`, `subs`, `textless`, `REV2`) | project prefix, asset, language/country, tags, extra |
| Folders inside the drop, nearest first (`Passenger/Social/Explainer 30/GRK Subs/…`) | project, asset type, asset, language, sub/dub, text, when the file name doesn't say |
| ffprobe tag rules (`/tags` `ffprobeRules`) | codec, frame rate, scan, resolution |
| mediainfo (via the SDK), or ffprobe output shaped like mediainfo | resolution, frame rate, standard, codec, aspect, scan |
| Work request + tag (optional, per file) | language, territory, TXTD, SUB/DUB, tag token, REV |
| Your edits | anything |

Fuzzy matching also weighs the file's running time against each asset's length, and numbers in the name (`15` vs `30`).

## Requirements

- `ffprobe` (or `mediainfo`, which is preferred when installed) on PATH, or set in Settings.
  Without either, names are still built, but there are no codec/resolution tokens.

## Development

```bash
npm install
npm run tauri dev     # run the app
npm test              # naming/matching tests (vitest)
npm run tauri build   # bundle for the current OS
```

- `src-tauri/src/lib.rs`: API proxy (avoids CORS), folder expansion, probing, rename/undo journal
- `src/lib/propose.ts`: merges all context and calls the SDK
- `src/lib/parse.ts`: port of slurpee3's filename parser
- `src/lib/fuzzy.ts`: project/asset ranking and folder hints
- `src/data/`: platform fixtures, used when the API can't provide tags/types/territories/languages

## Releasing

1. Bump `version` in `src-tauri/tauri.conf.json` (and `package.json` / `src-tauri/Cargo.toml` to match).
2. Commit, then tag and push: `git tag v0.2.0 && git push origin main v0.2.0`.
3. `.github/workflows/release.yml` builds a universal macOS `.dmg` and Windows `.exe`/`.msi`, then publishes them on the GitHub release.

The builds are unsigned (macOS uses ad-hoc signing). To sign and notarize, add Apple `APPLE_CERTIFICATE`/`APPLE_ID`/etc.
secrets and a Windows code-signing certificate, following the Tauri signing guides.
