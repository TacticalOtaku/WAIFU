<div align="center">

# WAIFU: World Audit & Integrity

**Diagnostic report workspace and safe auto-fix toolkit for Foundry VTT v14+** — audit heavy multi-level scenes, broken `@UUID` references, bloated world settings, and orphaned module flags with inline SVG charts and exportable reports.

[![GitHub Release](https://img.shields.io/github/v/release/TacticalOtaku/WAIFU?style=flat-square&color=b8860b)](https://github.com/TacticalOtaku/WAIFU/releases/latest)
[![Release Workflow](https://github.com/TacticalOtaku/WAIFU/actions/workflows/release.yml/badge.svg)](https://github.com/TacticalOtaku/WAIFU/actions/workflows/release.yml)
[![Foundry VTT](https://img.shields.io/badge/Foundry%20VTT-v14-ff6400?style=flat-square)](https://foundryvtt.com/)
[![Languages](https://img.shields.io/badge/Languages-EN%20%7C%20RU-2e7d32?style=flat-square)](lang/)
[![License: MIT](https://img.shields.io/badge/License-MIT-3b82f6?style=flat-square)](module.json)

[Installation](#installation) · [Opening WAIFU](#opening-waifu) · [Workspace](#workspace) · [Diagnostics & Auto-Fix](#diagnostics--auto-fix) · [Reports & Charts](#reports--charts) · [Settings & API](#settings--api) · [Development](#development)

</div>

---

**WAIFU** inspects your entire Foundry VTT world in seconds, scores overall world integrity (`0–100%`), visualizes bottlenecks with built-in SVG charts and statistical distributions, and offers **safe, reversible auto-fixes** with optional JSON backups before cleanup.

> [!NOTE]
> Built specifically for **Foundry VTT v14** (including multi-level `Scene.levels`, `ApplicationV2`, and **Loreframe** journal blocks) with full **English** and **Русский** localization. Designed in the visual language of **AIM: Actor Window** (`Night` & `Parchment` themes, 6 accent palettes, and bundled **Onest Variable** typography).

---

## Installation

### Via Manifest URL (Recommended)

In Foundry VTT Setup → **Add-on Modules** → **Install Module**, paste the Manifest URL:

```text
https://github.com/TacticalOtaku/WAIFU/releases/latest/download/module.json
```

### Manual / Offline Archive

1. Download `waifu-v<version>.zip` from [GitHub Releases](https://github.com/TacticalOtaku/WAIFU/releases/latest).
2. Extract it into your Foundry `Data/modules/waifu` directory.
3. Launch your world and enable **WAIFU: World Audit & Integrity** under **Manage Modules**.

---

## Opening WAIFU

Any **GM** user can open the diagnostic dashboard in four ways:

| Entry Point | Where to find it |
| --- | --- |
| **Scene Controls** | Token Tools (`Tokens` layer) → stethoscope icon (**WAIFU: World Audit & Integrity**) |
| **Settings Sidebar** | Game Settings tab → **Open World Audit (WAIFU)** button |
| **Module Settings** | Configure Settings → WAIFU → **Open WAIFU Audit** |
| **Macro / Console** | `game.modules.get("waifu").api.open()` or `WAIFU.open()` |

---

## Workspace

WAIFU uses a dedicated **report-first workspace** (`Masthead` + `Report Outline Sidebar` + `Analytical Viewport`), responsive down to narrow windows (`< 860 px`):

| Section | Purpose |
| --- | --- |
| **Executive Overview** | 4 executive KPI cards, Health Score penalty breakdown, Domain Severity Matrix, Texture Format Donut, Heaviest Scenes, Top Storage Namespaces, `@UUID` Integrity Donut, Scene Metric Distributions (`Min / Avg / Median / P95 / Max`), and prioritized 1-click Auto-Fixes. |
| **Scenes & Media** | Texture format mix bar, Megapixels vs Limit chart, search/filter chips (`All`, `Issues Only`, `PNG / Raster`, `Walls / Lights / Anim`), sortable scene table, and per-asset or batch WebP conversion & wall cleanup. |
| **`@UUID` Integrity** | Link validity bar, top offending documents chart, filters (`All`, `Journals`, `Flags / Loreframe`, `Actors & Items`, `With Candidate`), ranked fuzzy replacement selector, 1-click replace, and safe unlink. |
| **Settings & Flags** | Database allocation donut & reclaimable space bar, top namespaces chart, World Settings & Document Flags tables with JSON payload inspection, backup snapshots, and orphan deletion. |
| **Full Report** | Interactive switcher between **Visual Report (Charts)**, **Markdown**, and **Journal Preview**, plus exports to `.html`, `.md`, `.json`, clipboard, and Foundry `JournalEntry`. |

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
| `maxWalls` | `300` | Flag scenes with more wall segments |
| `maxLights` | `40` | Flag scenes with more ambient light sources |
| `maxAnimations` | `15` | Flag scenes exceeding combined animated lights, video tiles/art, animated tokens, and weather |
| `maxSettingBytes` | `16384` B (16 KB) | Flag oversized world settings |
| `maxFlagBytes` | `32768` B (32 KB) | Flag oversized document flag namespaces |
| `webpQuality` | `0.85` | WebP encoding quality (`0.50–1.00`) |
| `downscaleOnConvert` | `false` | Proportionally downscale oversized textures to `maxTextureResolution` during WebP conversion |
| `includeChatMessages` | `false` | Also scan `game.messages` for orphaned module flags |

### Public Macro / Module API

```js
const waifu = game.modules.get("waifu").api;

// Open the diagnostic report window (auto-scans on first open)
waifu.open();

// Run an audit programmatically (with optional threshold overrides)
const report = await waifu.runAudit({ maxWalls: 250 });

// Export as "markdown", "html", or "json" in "en" or "ru"
const html = waifu.exportReport(report, "html", "en");
const md = waifu.exportReport(report, "markdown", "ru");
```

---

## Development

Requires **Node.js ≥ 24** (`node --test` and zero runtime dependencies):

```sh
npm run check     # Static manifest, i18n key parity (en/ru), and syntax checks + unit tests
npm run deploy    # Copy module runtime files (including assets/fonts) into local Foundry Data/modules/waifu
npm run package   # Build dist/waifu-v<version>.zip and dist/module.json
npm run release   # Run checks and build release archive
```

---

## Author & License

Created by [TacticalOtaku](https://github.com/TacticalOtaku) · Licensed under the [MIT License](module.json).
Bundled UI typeface: [Onest Variable](assets/fonts/OFL-onest.txt) (`SIL Open Font License 1.1`).
