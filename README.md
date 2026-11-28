<div align="center">

**English** · [Русский](README.ru.md)

# WAIFU: World Audit & Integrity

Diagnostic dashboard and safe auto-fix toolkit for Foundry VTT v14+.

Audit multi-level scenes, broken `@UUID` links, oversized world settings, leftover module flags, and individual actors or items from one window.

[![Release](https://img.shields.io/github/v/release/TacticalOtaku/WAIFU?style=flat-square&label=Release&color=b8860b)](https://github.com/TacticalOtaku/WAIFU/releases/latest)
[![Release Workflow](https://img.shields.io/github/actions/workflow/status/TacticalOtaku/WAIFU/release.yml?style=flat-square&label=Release%20CI)](https://github.com/TacticalOtaku/WAIFU/actions/workflows/release.yml)
[![Foundry VTT](https://img.shields.io/badge/Foundry_VTT-v14-ff6400?style=flat-square)](https://foundryvtt.com/)
[![Languages](https://img.shields.io/badge/Languages-EN_%7C_RU-2e7d32?style=flat-square)](lang/)
[![License: MIT](https://img.shields.io/badge/License-MIT-3b82f6?style=flat-square)](LICENSE)

[Installation](#installation) · [Opening WAIFU](#opening-waifu) · [Workspace](#workspace) · [Diagnostics & Auto-Fix](#diagnostics--auto-fix) · [Reports & Charts](#reports--charts) · [Settings & API](#settings--api) · [Development](#development)

</div>

---

## Installation

In Foundry VTT (**Setup → Add-on Modules → Install Module**), paste the Manifest URL:

```text
https://github.com/TacticalOtaku/WAIFU/releases/latest/download/module.json
```

**Requirements:** Foundry VTT 14, any game system, no external dependencies.  
**Manual install:** Download `waifu-v<version>.zip` from [GitHub Releases](https://github.com/TacticalOtaku/WAIFU/releases/latest), extract it into `Data/modules/waifu`, and enable **WAIFU: World Audit & Integrity** under **Manage Modules**.

---

## Overview

WAIFU scans your Foundry VTT world and scores overall health (`0–100%`). It tracks scene media and geometry bloat, broken links, oversized database settings, and orphaned module flags in one report.

The first time you open WAIFU with no saved data, it runs a world scan automatically and saves the result. Later opens load that saved report instead of scanning again, and cleanups patch the report in place. When you want fresh numbers after manual edits or module changes, start a scan from the header button.

> [!NOTE]
> Built for Foundry VTT v14 (multi-level `Scene.levels`, `ApplicationV2`, and Loreframe journal blocks) with full English and Russian localization. Styled to match AIM: Actor Window with Night and Parchment themes, six accents, and bundled Onest Variable fonts.

---

## Opening WAIFU

GMs can launch WAIFU from four places:

| Entry Point | Where to find it |
| --- | --- |
| **Scene Controls** | Token Tools (`Tokens` layer) → stethoscope icon (**WAIFU: World Audit & Integrity**) or boxes icon (**WAIFU: Actors & Items Audit**) |
| **Settings Sidebar** | Game Settings tab → **Open World Audit (WAIFU)** |
| **Module Settings** | Configure Settings → WAIFU → **Open WAIFU Audit** or **Open Actors & Items Audit** |
| **Macro / Console** | `game.modules.get("waifu").api.open()`, `WAIFU.open()`, or `WAIFU.openEntityAudit()` |

---

## Workspace

The UI uses a hub-and-drilldown layout: a compact header, a bento hub grid, and in-place views with slide-over scene drawers. Below `860 px` width, the grid collapses into stacked summary cards.

| View | Summary on Hub & Details View |
| --- | --- |
| **1 · Integrity Score & Trend** | `270°` health gauge, score deduction bar, scan sparkline, and JSON comparison. Opens full trend charts, penalty breakdown, severity matrix, and `Min / Avg / Median / P95 / Max` scene distributions. |
| **2 · Auto-Fix & Maintenance** | Top three prioritized fixes and maintenance alerts. Opens the dry-run fix queue with checkboxes, default JSON backup option, chat pruning, stale combat removal, 404 media scan, unused `waifu-optimized` files, and ignore rules. |
| **3 · Scenes & Media** | Healthy vs heavy scene counts, WebP/PNG ratio bar, and top two heaviest scenes. Clicking a card opens the slide-over Scene Drawer; the full view adds resolution charts, filters, `Shift+Click` multi-select for batch actions (WebP conversion, walls, tokens, lights, ignore), sortable `Scene.levels` and `Tile` tables, and canvas ping. |
| **4 · `@UUID` Integrity** | Link validity bar and top offending documents. Full view charts link health across `JournalEntry`, Loreframe blocks, `Actor`, `Item`, `RollTable`, `Macro`, and `Scene`, checks `#anchor` targets, and supports filtering, fuzzy suggestions, manual catalog picking, optional `{label}` sync, and single-click or batch replace, unlink, and ignore. |
| **5 · Database Storage & Flags** | Reclaimable DB footprint and top offending namespaces. Full view breaks down storage by module, lets you inspect raw JSON payloads, multi-select (`Shift+Click`) to delete or ignore without re-scanning, download backups, or restore from JSON. |
| **6 · Report Studio & Thresholds** | Active threshold tiles and `.html` / `.md` / `.json` / `Journal` export buttons. Full view pairs deferred, revision-cached Visual, Markdown, and Journal previews beside inline editors for all 15 thresholds. |
| **7 · Actors & Items JSON Audit** | Inline view plus standalone pop-out window (`WAIFU.openEntityAudit()`), empty by default. Drop an `Actor`, `Item`, `Folder` (recursive subfolders), or `Actor`/`Item` `Compendium` to inspect and clean leftover flags, `prototypeToken` flags, `ActiveEffect.changes`, `@UUID` links, and `modules/<id>/` strings from deleted or disabled modules without running a world audit. |

### Persistence and Progress Overlay

- **First auto-scan only:** WAIFU auto-scans once when no report is stored and keeps the last report across reloads. Later world scans are manual.
- **Local updates on cleanup:** Deleting settings or flags, fixing links, cleaning scenes, or adding ignore rules updates the saved report locally with no follow-up scan.
- **Status overlay:** Audits, batch auto-fixes, deletions, WebP conversions, and JSON cleanups dim the workspace behind a centered progress ring showing completion percentage, current stage, exact item key or path, and a Cancel button where supported.

### Themes and Typography

Switch between Night (dark slate) and Parchment (warm light) themes and six accents (`Brass`, `Embers`, `Arcane`, `Forest`, `Frost`, `Rose`) from the palette menu in the header. Labels and tabular numbers use the bundled Onest Variable font (`OFL-1.1`) for offline Cyrillic and Latin rendering.

---

## Diagnostics & Auto-Fix

### 1. Heavy Scenes & Media (`v14` Multi-Level Ready)

Checks `Scene.levels` (backgrounds and foregrounds), top-level scene art, placed `Tile` textures, `Wall` segments, `AmbientLight` sources, `Token` lights and video textures, `Drawing` videos, and scene weather.

- **Detects:**
  - Textures wider than `4096 px` or above `18 MP`
  - Uncompressed or legacy raster formats (`PNG`, `JPG`, `JPEG`, `BMP`, `TGA`, `TIFF`, `GIF`) instead of `WebP`
  - Scenes above wall (`> 300`), ambient light (`> 40`), or animation (`> 15`) limits
  - Zero-length walls and exact-duplicate wall segments (matching door type, movement/sense restrictions, elevation, and v14 levels)
- **Auto-fixes:**
  - **In-browser WebP conversion:** Re-encodes raster textures via `OffscreenCanvas` or `<canvas>` and uploads via Foundry `FilePicker`. Original files stay untouched on disk.
  - **Protected paths:** Files under `modules/`, `systems/`, `icons/`, and `ui/` are never overwritten in place; converted `.webp` files go to `worlds/<worldId>/waifu-optimized/` and scene, level, and tile paths update automatically.
  - **Geometry and lights:** Removes redundant or zero-length walls and can clear animations on ambient lights.

### 2. Broken `@UUID` Scanner

Walks `JournalEntry` and `JournalEntryPage` (`text.content`, `text.markdown`, `system`, `flags` including `data-loreframe-template` HTML blocks and dotted flag keys), plus `Actor`, embedded `Item`, and embedded `ActiveEffect`.

- **Validates:** `@UUID[...]{...}` enrichers, `<a data-uuid="...">` links, `#anchor` headings, relative `.SubDoc.id` links, and plain UUIDs under link fields in `flags` or `system`.
- **Auto-fix:** Ranks matches across world documents and loaded compendium packs by `Document` type and Dice bigram similarity. Supports single-click replace, batch replacement for 100% exact matches, and safe unlinking that keeps visible text.

### 3. World Settings & Orphaned Flags

Measures UTF-8 JSON byte sizes across `WorldSettings` and world/embedded document flag namespaces (and `game.messages` when enabled).

| Status | Meaning | Auto-Cleanup Behavior |
| --- | --- | --- |
| **Orphaned** | Module ID is no longer installed in `game.modules` | Included in orphan cleanup (with optional JSON backup) |
| **Disabled** | Module is installed, currently inactive | Highlighted for review; skipped during batch orphan cleanup |
| **Bloated Active** | Active module/core/system data exceeding byte threshold | Inspectable and manually deletable if stale cache |

> [!IMPORTANT]
> Before deleting any world setting or flag namespace, WAIFU defaults to downloading `waifu-storage-backup-<worldId>-<timestamp>.json` with keys, target UUIDs, and live flag payloads so changes can be restored later.

---

## Reports & Charts

Every scan exports in four formats:

- **Visual HTML Report (`.html`):** Standalone HTML file with eight inline SVG charts, Night/Parchment toggle, and `@media print` rules for PDF export.
- **Markdown Report (`.md`):** Score penalty tables, Unicode bar charts, `Min / Avg / Median / P95 / Max` scene metrics, top namespaces, and findings tables.
- **Foundry Journal Entry:** Creates a `JournalEntry` inside your world using semantic HTML tables compatible with ProseMirror.
- **JSON Report (`.json`):** Machine-readable output (`schemaVersion: 2`) with `summary`, `statistics`, and full finding lists.

<details>
<summary><strong>World Health Score formula (0–100%)</strong></summary>

Starts at `100` and subtracts capped penalties across five categories:

- **Scenes:** `criticalScenes * 14 + warningScenes * 5`
- **PNG Media:** `min(25, pngAssets * 3)`
- **Broken `@UUID`:** `min(35, brokenUuids * 3)`
- **World Settings:** `min(18, bloatedSettings * 4 + orphanedSettings * 2)`
- **Document Flags:** `min(20, orphanedNamespaces * 4 + bloatedFlagEntries * 3)`

States: Healthy (`85–100%`), Attention / Warning (`60–84%`), Critical (`< 60%`).

</details>

---

## Settings & API

### Configurable Thresholds

| Setting | Default | Purpose |
| --- | --- | --- |
| `maxTextureResolution` | `4096` px | Flag map or tile textures wider/taller than this edge limit |
| `maxMegapixels` | `18` MP | Flag textures exceeding `width × height / 1,000,000` |
| `maxAssetBytes` | `15728640` B (15 MB) | Flag scene or tile assets larger than this HTTP byte size |
| `maxWalls` | `300` | Flag scenes above this wall segment count |
| `maxLights` | `40` | Flag scenes above this ambient light count |
| `maxAnimations` | `15` | Flag scenes above this total of animated lights, video tiles/art, animated tokens, and weather |
| `nearDuplicateWallTolerance` | `2` px | Endpoint distance threshold for near-duplicate walls (`0` disables) |
| `maxSettingBytes` | `16384` B (16 KB) | Byte limit for world settings |
| `maxFlagBytes` | `32768` B (32 KB) | Byte limit for document flag namespaces |
| `webpQuality` | `0.85` | WebP encoding quality (`0.50–1.00`) |
| `downscaleOnConvert` | `false` | Downscale oversized textures down to `maxTextureResolution` while converting to WebP |
| `skipLargerWebp` | `true` | Skip uploading WebP if the encoded file is larger than the original (when not downscaling) |
| `uuidMinAutoConfidence` | `1.0` | Minimum match score (`0.75–1.00`) required for batch `@UUID` replacement |
| `maxChatMessages` | `1000` | Message threshold before flagging chat log size |
| `includeChatMessages` | `false` | Include `game.messages` when checking for orphaned module flags |

### Public Macro / Module API

```js
const waifu = game.modules.get("waifu").api;

// Open the diagnostic report window (auto-scans only on first run; restores saved report afterwards)
waifu.open();

// Open the standalone empty-by-default drag-and-drop Actors & Items JSON audit window
waifu.openEntityAudit();

// Read the last persisted audit report without scanning
const lastReport = waifu.getLastReport();

// Run an audit programmatically (with optional threshold overrides)
const report = await waifu.runAudit({ maxWalls: 250 });

// Export as "markdown", "html", or "json" in "en" or "ru"
const html = waifu.exportReport(report, "html", "en");
const md = waifu.exportReport(report, "markdown", "ru");
```

---

## Development

Requires Node.js ≥ 24 (`node --test`, zero runtime dependencies). Pushing a `v*` tag runs checks and publishes the ZIP archive and `module.json` via [release.yml](.github/workflows/release.yml).

```bash
npm run check     # Static manifest, i18n key parity (en/ru), and syntax checks + unit tests
npm run deploy    # Copy module runtime files (including assets/fonts) into local Foundry Data/modules/waifu
npm run package   # Build dist/waifu-v<version>.zip and dist/module.json
npm run release   # Run checks and build release archive
```

### Project Docs

| Document | Purpose |
| --- | --- |
| [CHANGELOG.md](CHANGELOG.md) | Version-by-version release notes |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Issue reporting guidelines |

---

## AI Disclosure

AI tools assisted with drafting code, refactoring, tests, documentation, and translations. TacticalOtaku reviewed, tested, and maintains all architecture, code, UI copy, and English/Russian translations, and remains the sole author of the module.

All bundled files follow Foundry VTT's [AI Content Policy](https://foundryvtt.com/article/ai-policy/). No pre-generated AI art, audio, or lore assets are included.

---

## Feedback & License

Pull Requests are closed on this repository. Send bug reports and feature requests through [GitHub Issues](https://github.com/TacticalOtaku/WAIFU/issues) (see [CONTRIBUTING.md](CONTRIBUTING.md)).

Created by [TacticalOtaku](https://github.com/TacticalOtaku) · Licensed under the MIT License ([LICENSE](LICENSE)).  
Bundled UI typeface (`SIL Open Font License 1.1`): [Onest Variable](assets/fonts/OFL-onest.txt).
