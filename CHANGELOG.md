# Changelog

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
