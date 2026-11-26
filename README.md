<div align="center">

**English** · [Русский](README.ru.md)

# WAIFU: World Audit & Integrity

**Diagnostic report workspace and safe auto-fix toolkit for Foundry VTT v14+**

Inspect heavy multi-level scenes, broken `@UUID` references, bloated world settings, and orphaned module flags with inline SVG charts and exportable reports.

[![Release](https://img.shields.io/github/v/release/TacticalOtaku/WAIFU?style=flat-square&label=Release&color=b8860b)](https://github.com/TacticalOtaku/WAIFU/releases/latest)
[![Release Workflow](https://img.shields.io/github/actions/workflow/status/TacticalOtaku/WAIFU/release.yml?style=flat-square&label=Release%20CI)](https://github.com/TacticalOtaku/WAIFU/actions/workflows/release.yml)
[![Foundry VTT](https://img.shields.io/badge/Foundry_VTT-v14-ff6400?style=flat-square)](https://foundryvtt.com/)
[![Languages](https://img.shields.io/badge/Languages-EN_%7C_RU-2e7d32?style=flat-square)](lang/)
[![License: MIT](https://img.shields.io/badge/License-MIT-3b82f6?style=flat-square)](LICENSE)

[Installation](#installation) · [Opening WAIFU](#opening-waifu) · [Workspace](#workspace) · [Diagnostics & Auto-Fix](#diagnostics--auto-fix) · [Reports & Charts](#reports--charts) · [Settings & API](#settings--api) · [Development](#development)

</div>

---

## Installation

In Foundry VTT (**Setup → Add-on Modules → Install Module**), paste the **Manifest URL**:

```text
https://github.com/TacticalOtaku/WAIFU/releases/latest/download/module.json
```

**Requirements:** Foundry VTT **14** (system-agnostic; zero runtime dependencies).  
**Manual install:** Download `waifu-v<version>.zip` from [GitHub Releases](https://github.com/TacticalOtaku/WAIFU/releases/latest), extract it into `Data/modules/waifu`, and enable **WAIFU: World Audit & Integrity** under **Manage Modules**.

---

## Overview

**WAIFU** inspects your entire Foundry VTT world in seconds, scores overall world integrity (`0–100%`), visualizes bottlenecks with built-in SVG charts and statistical distributions, persists the latest report across reloads/re-logins (running automatically only on first launch when no audit exists yet, with all subsequent scans triggered manually), and offers **safe, reversible auto-fixes** with optional JSON backups and instant local report updates without re-scanning after every cleanup.

> [!NOTE]
> Built specifically for **Foundry VTT v14** (including multi-level `Scene.levels`, `ApplicationV2`, and **Loreframe** journal blocks) with full **English** and **Русский** localization. Designed in the visual language of **AIM: Actor Window** (`Night` & `Parchment` themes, 6 accent palettes, and bundled **Onest Variable** typography).

---

## Opening WAIFU

Any **GM** user can open the diagnostic dashboard in four ways:

| Entry Point | Where to find it |
| --- | --- |
| **Scene Controls** | Token Tools (`Tokens` layer) → stethoscope (**WAIFU: World Audit & Integrity**) or boxes icon (**WAIFU: Actors & Items Audit**) |
| **Settings Sidebar** | Game Settings tab → **Open World Audit (WAIFU)** button |
| **Module Settings** | Configure Settings → WAIFU → **Open WAIFU Audit** or **Open Actors & Items Audit** |
| **Macro / Console** | `game.modules.get("waifu").api.open()`, `WAIFU.open()`, or `WAIFU.openEntityAudit()` |

---

## Workspace

WAIFU uses a **3-level Hub-and-Drilldown workspace** (`Compact Masthead` → `6-Window Bento Hub` → `In-Place Drill-Downs & Level 2 Drawers`), automatically collapsing into stacked quick-summary cards in narrow windows (`< 860 px`):

| Sub-Window / Level 1 View | Summary on Hub (Level 0) & Full Drill-Down Details (Level 1 / 2) |
| --- | --- |
| **1 · Integrity Score & Trend** | 270° health gauge, score deduction progress bar, scan sparkline & comparison CTA → full Health Trend chart with delta pills, itemized penalty breakdown, Domain Severity Matrix table, and Scene Metric Distributions (`Min / Avg / Median / P95 / Max`). |
| **2 · Auto-Fix & Maintenance** | Top 3 prioritized safe fixes with 1-click triggers and maintenance alert badges → interactive **Dry-Run Queue** with per-fix checkboxes, default JSON backup checkbox, plus Chat Log archiving, Stale Combats cleanup, Non-Scene 404 Media, Unused `waifu-optimized`, and Ignore Rules manager. |
| **3 · Scenes & Media** | Clean vs problematic scene KPIs, WebP vs PNG mix bar, top 2 heaviest scenes (click directly opens the **Level 2 Scene Drawer**) → resolution chart (`MP` vs limit), search/filter chips, multi-select checkboxes (`Shift+Click` range & select-all visible) for batch WebP/walls/tokens/lights/ignore actions, sortable `Scene.levels` & `Tile` table, canvas focus/ping, and per-asset/batch WebP conversion. |
| **4 · `@UUID` Integrity** | Valid link percentage bar and top offending docs → integrity/top-docs charts, extended coverage (`JournalEntry`, `Loreframe`, `Actor`, `Item`, `RollTable`, `Macro`, `Scene`), `#anchor` verification, filters, multi-select replace/unlink/ignore bar, fuzzy selector, manual catalog picker, optional `{label}` sync, 1-click replace, and safe unlink. |
| **5 · Database Storage & Flags** | Reclaimable DB footprint bar and top namespaces → allocation donut, top namespaces chart, sortable World Settings & Document Flags tables with multi-select checkboxes (`Shift+Click` range & select-all visible) for batch delete/ignore without triggering a re-audit, interactive JSON inspection, per-document flag deletion, JSON Backup & **JSON Restore**, and Chat/Combat maintenance. |
| **6 · Report Studio & Thresholds** | Quick threshold summary tiles and `.html` / `.md` / `.json` / `Journal` export strip → deferred, revision-cached **Report Preview** switcher (**Visual**, **Markdown**, **Journal**) paired side-by-side with inline editing for all **15 audit thresholds** and toggles. |
| **7 · Actors & Items JSON Audit** | Inline 7th Hub view & dedicated standalone window (`WAIFU.openEntityAudit()`), **empty by default** — drag and drop any `Actor`, `Item`, `Folder` (recursive subfolders), or `Actor`/`Item` `Compendium` to find and safely clean leftover flags, `prototypeToken` flags, `ActiveEffect.changes`, and residual `@UUID` / `modules/<id>/` strings from deleted or inactive modules without triggering a full world audit. |

### Tinted Busy Progress Overlay & Persistence

- **First Auto-Audit Only**: WAIFU runs a world scan automatically only on first launch (when no saved report exists) and persists the last report across reloads. All subsequent world audits are triggered manually via **Run Audit**.
- **Instant Local Reconciliation**: Cleaning, deleting, replacing, unlinking, or ignoring items updates the persisted report locally instead of re-running the world audit.
- **Circular Status Overlay**: Every audit, batch fix, deletion, or JSON cleanup dims the window behind a centered progress ring with live percentage, active stage title, and the exact target key/path being processed (plus **Cancel** for cancellable queues).

### Themes & Typography

Switch between **Night** (dark slate) and **Parchment** (warm light) themes and **6 accents** (`Brass`, `Embers`, `Arcane`, `Forest`, `Frost`, `Rose`) directly from the palette button in the masthead. UI labels and tabular numbers use the bundled **Onest Variable** font (`OFL-1.1`) for crisp Cyrillic and Latin rendering offline.

---

## Diagnostics & Auto-Fix

### 1. Heavy Scenes & Media (`v14` Multi-Level Ready)

Scans `Scene.levels` (backgrounds & foregrounds), top-level scene art, placed `Tile` textures, `Wall` segments, `AmbientLight` sources, `Token` lights/video textures, `Drawing` videos, and scene `weather`.

- **Detects:**
  - Oversized textures exceeding max edge (`4096 px`) or megapixel budget (`18 MP`)
  - Unoptimized raster formats (`PNG`, `JPG`, `JPEG`, `BMP`, `TGA`, `TIFF`, `GIF`) instead of `WebP`
  - Excessive walls (`> 300`), ambient lights (`> 40`), or active animations (`> 15`)
  - Zero-length walls and exact-duplicate wall segments (respecting door type, restrictions, elevation, and v14 `levels`)
- **Safe Auto-Fixes:**
  - **In-browser WebP Conversion:** Re-encodes raster textures via Canvas (`OffscreenCanvas` / `<canvas>`) and uploads via Foundry `FilePicker`. Original files are never deleted from disk.
  - **Protected Path Safety:** Assets inside `modules/`, `systems/`, `icons/`, `ui/`, etc. are never overwritten in place — WAIFU writes converted `.webp` files to `worlds/<worldId>/waifu-optimized/` and updates the Scene/Level/Tile references automatically.
  - **Geometry & Animation Cleanup:** Deduplicates redundant/zero-length walls and optionally clears animation presets on ambient lights.

### 2. Broken `@UUID` Scanner

Recursively walks `JournalEntry` & `JournalEntryPage` (`text.content`, `text.markdown`, `system`, `flags` — including `data-loreframe-template` HTML blocks and dot-containing flag keys), plus `Actor`, embedded `Item`, and embedded `ActiveEffect`.

- **Validates:** `@UUID[...]{...}` enrichers, `<a data-uuid="...">` links, `#anchor` targets, relative `.SubDoc.id` references, and bare UUIDs under relation/link keys in `flags` / `system`.
- **Auto-Fix:** Ranks candidates across World documents and loaded Compendium packs by `Document` type and Dice bigram similarity; supports **1-click replacement**, **batch apply for `100%` exact matches**, or **safe unlinking** that keeps visible text intact.

### 3. World Settings & Orphaned Flags

Measures UTF-8 JSON byte sizes across `WorldSettings` and world/embedded document flag namespaces (optionally including `game.messages`).

| Status | Meaning | Auto-Cleanup Behavior |
| --- | --- | --- |
| **Orphaned** | Module ID is no longer installed in `game.modules` | Included in orphan cleanup (with optional JSON backup) |
| **Disabled** | Module is installed, currently inactive | Flagged for visibility; **never** touched by batch orphan cleanup |
| **Bloated Active** | Active module/core/system data exceeding byte threshold | Inspectable & manually deletable if stale cache |

> [!IMPORTANT]
> Before deleting any world setting or flag namespace, WAIFU offers a **Download JSON backup** checkbox (enabled by default) that exports `waifu-storage-backup-<worldId>-<timestamp>.json` containing keys, targets, and live flag payloads.

---

## Reports & Charts

Every scan generates an executive report with inline SVG visualizations and statistical summaries:

- **Visual HTML Report (`.html`)** — Standalone, self-contained HTML file with all 8 SVG charts, Night/Parchment theme switcher, and `@media print` rules for saving cleanly to PDF.
- **Markdown Report (`.md`)** — Structured Markdown with score penalty tables, Unicode distribution bars, `Min / Avg / Median / P95 / Max` scene statistics, top namespaces, and findings tables.
- **Foundry Journal Entry** — Creates a `JournalEntry` in your world using clean semantic HTML tables compatible with ProseMirror.
- **JSON Report (`.json`)** — Full machine-readable report (`schemaVersion: 2`) including `summary`, `statistics`, and raw item lists.

<details>
<summary><strong>World Health Score formula (0–100%)</strong></summary>

Starts at `100` and deducts points across five capped categories:

- **Scenes:** `criticalScenes * 14 + warningScenes * 5`
- **PNG Media:** `min(25, pngAssets * 3)`
- **Broken `@UUID`:** `min(35, brokenUuids * 3)`
- **World Settings:** `min(18, bloatedSettings * 4 + orphanedSettings * 2)`
- **Document Flags:** `min(20, orphanedNamespaces * 4 + bloatedFlagEntries * 3)`

States: **Healthy** (`85–100%`), **Attention / Warning** (`60–84%`), **Critical** (`< 60%`).

</details>

---

## Settings & API

### Configurable Thresholds

| Setting | Default | Description |
| --- | --- | --- |
| `maxTextureResolution` | `4096` px | Flag map/tile textures exceeding this pixel edge |
| `maxMegapixels` | `18` MP | Flag textures exceeding `width × height / 1,000,000` |
| `maxAssetBytes` | `15728640` B (15 MB) | Flag scene/tile textures whose HTTP size exceeds this byte limit |
| `maxWalls` | `300` | Flag scenes with more wall segments |
| `maxLights` | `40` | Flag scenes with more ambient light sources |
| `maxAnimations` | `15` | Flag scenes exceeding combined animated lights, video tiles/art, animated tokens, and weather |
| `nearDuplicateWallTolerance` | `2` px | Flag matching walls within this endpoint snap distance (`0` disables) |
| `maxSettingBytes` | `16384` B (16 KB) | Flag oversized world settings |
| `maxFlagBytes` | `32768` B (32 KB) | Flag oversized document flag namespaces |
| `webpQuality` | `0.85` | WebP encoding quality (`0.50–1.00`) |
| `downscaleOnConvert` | `false` | Proportionally downscale oversized textures to `maxTextureResolution` during WebP conversion |
| `skipLargerWebp` | `true` | Skip uploading WebP when encoded bytes exceed original file size (when not downscaling) |
| `uuidMinAutoConfidence` | `1.0` | Minimum match confidence (`0.75–1.00`) for batch `@UUID` replacement |
| `maxChatMessages` | `1000` | Flag bloated world chat logs exceeding this message count |
| `includeChatMessages` | `false` | Also scan `game.messages` for orphaned module flags |

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

Requires **Node.js ≥ 24** (`node --test` and zero runtime dependencies). Tagged releases (`v*`) run checks and publish the ZIP archive and `module.json` via [release.yml](.github/workflows/release.yml).

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

AI-assisted tools were used during development for tasks such as code drafting, refactoring, tests, documentation, and localization drafts. All architecture, code, behavior, user-facing copy, and Russian/English translations are reviewed, tested, and maintained by **TacticalOtaku**, who retains sole authorship and responsibility for the module.

All bundled package assets and user-facing materials comply with Foundry VTT's [AI Content Policy](https://foundryvtt.com/article/ai-policy/) — no pre-generated AI art, audio, or lore assets are included.

---

## Feedback & License

Pull Requests are disabled on this repository; bug reports and feature suggestions are welcome via [GitHub Issues](https://github.com/TacticalOtaku/WAIFU/issues) (see [CONTRIBUTING.md](CONTRIBUTING.md)).

Created by [TacticalOtaku](https://github.com/TacticalOtaku) · Licensed under the **MIT License** ([LICENSE](LICENSE)).  
Bundled UI typeface (`SIL Open Font License 1.1`): [Onest Variable](assets/fonts/OFL-onest.txt).
