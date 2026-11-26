# Changelog

## 1.2.1

### Fixed

- **Scene Drawer slot labels:** Resolved missing slot labels (`undefined (level-background)` / `undefined (tile)`) for healthy assets inside the Level 2 Scene Inspector Drawer by sharing `formatAssetSlotLabel` across all scene assets.
- **Parchment theme heading contrast:** Raised CSS specificity over Foundry v14 `.theme-dark` heading defaults (`h1`–`h4`, card titles, bold labels) with explicit `color: var(--text)` and `text-shadow: none` so Parchment mode maintains high dark-ink contrast.
- **`@UUID` clean-world chart copy:** Updated the empty-state message in **Top Documents with Broken `@UUID`** when links were scanned with zero broken matches (`No broken @UUID references found.` / `Битых ссылок @UUID не найдено.`).
- **Threshold grid legibility:** Made the inline 15-threshold editor responsive (`auto-fit`) with clean multi-line label wrapping so longer setting names remain readable on narrower windows.

### Added

- **Foundry v14 runner & auto-fixer integration test suite:** Added [test/autofix-integration.test.mjs](test/autofix-integration.test.mjs) covering multi-level audits, wall/light/token cleanup, `@UUID` replace & unlink, orphaned storage deletion, chat pruning, stale combats, ignore toggles, and JSON backup/restore.

## 1.2.0

### Added

- **Central Hub & 3-Level Drill-Down Architecture:** Replaced the static sidebar layout with a compact masthead and a 6-card Bento Central Hub (`1 · Integrity Score & Trend`, `2 · Auto-Fix & Maintenance`, `3 · Scenes & Media`, `4 · @UUID Links & Anchors`, `5 · Database Storage & Flags`, `6 · Report, Export & Thresholds`) where every summary window drills down in-place into detailed analytics with a `← All Windows` breadcrumb bar and quick-jump pills.
- **Interactive Dry-Run Auto-Fix Queue:** Dedicated Fix Center view with per-category checkboxes, optional automatic JSON backup toggle (`Download JSON backup before deleting`), and consolidated batch execution alongside Chat Log, Stale Combats, Non-Scene 404 Media, Unused `waifu-optimized`, and Ignore Rules maintenance actions.
- **Level 2 Slide-Over Scene Inspector Drawer:** Opens directly from Hub scene cards or the Scenes table to inspect per-level `Scene.levels` backgrounds/foregrounds and `Tiles`, trigger 1-click WebP conversion, clean walls, disable animated lights, remove orphaned tokens, or focus on the canvas without losing table filters.
- **Inline 15-Threshold Audit Studio:** Edit all 15 audit thresholds and AIM switch toggles right beside live Visual, Markdown, and Journal report previews (`Report Studio`).
- **Compact Hub Visualizations:** Added micro-sparkline (`renderCompactSparklineSvg`), segmented penalty bar (`renderCompactBarHtml`), trend chart gridlines, and narrow (`< 860 px`) stacked list navigation.

### Changed

- **AIM Visual Tokens & Unified Typography:** Updated Night/Parchment surface ladders, contrast-safe `*-soft` badge fills inside nested rows, unified bi-script `--font-display: var(--font-ui)` (`Onest Variable`), and compositor-only `data-motion` animations (`full` / `reduced` / `off`).

## 1.1.0

### Added

- **Missing media & asset byte-size audits:** Detect missing HTTP 404 media references across scenes, actors, tokens, items, and playlists, inspect scene/tile asset file sizes against `maxAssetBytes`, and identify unreferenced files left in `waifu-optimized/`.
- **Wall & token scene cleanup:** Detect near-duplicate walls within `nearDuplicateWallTolerance`, add one-click/batch near-duplicate wall deduplication, clean orphaned tokens missing linked actors, and focus/ping scenes directly on the canvas.
- **Extended `@UUID` and `#anchor` auditing:** Validate `#anchor` targets, relative references, and embedded document links, with a manual document picker (`Pick...`), optional `{label}` sync on replace, and dry-run confirmations.
- **Health history & JSON backup restore:** Track health trend sparklines across scans, compare against exported JSON reports, configure audit ignore rules, restore settings/flags/scene paths/walls from JSON backups, and archive/prune bloated chat logs and stale combats.

### Changed

- **UI & typography polish:** Adopted AIM-consistent `Night` and `Parchment` themes with bundled **Onest Variable** typography, sticky table headers, and themed `DialogV2` confirmation modals.
- **CI workflow:** Added automated static manifest/i18n checks and unit tests via `.github/workflows/ci.yml`.

## 1.0.0

### Added

- **Initial public release:** Report-first Foundry VTT v14 diagnostic dashboard (`Masthead`, `Report Outline Sidebar`, and analytical tabs for `Executive Overview`, `Scenes & Media`, `@UUID Integrity`, `Settings & Flags`, and `Full Report`).
- **World audits & auto-fixes:** Multi-level `Scene.levels` texture/wall/light/animation scanning, in-browser WebP conversion with protected path safety, `@UUID` scanning (including `Loreframe` HTML blocks) with fuzzy replacement/unlinking, orphaned/bloated storage inspection with JSON backups, inline SVG charts, statistical distributions, and exports to standalone `.html`, `.md`, `.json`, and Foundry `JournalEntry`.
- **Bilingual localization:** Full English (`en`) and Russian (`ru`) translations with bundled **Onest Variable** (`OFL-1.1`) fonts.
