# WAIFU: World Audit & Integrity

Foundry VTT **v14+** diagnostic report and safe auto-fix module styled in the visual palette of **AIM: Actor Window** (`Night` and `Parchment` themes with 6 accents), structured as a dedicated analytical reporting workspace.

## Features

- **Report-First Diagnostic Workspace**
  - Top report masthead with quick scan, safe auto-fix, JSON backup, and appearance controls.
  - Left report outline sidebar with a radial World Integrity gauge, domain counts, and active limit snapshot.
  - Inline SVG charts and distribution analytics across all audited domains (severity matrix, texture format mix, heaviest scenes & megapixel limits, `@UUID` validity & fix readiness, and database namespace footprint).
- **Heavy Scenes Audit (`v14` multi-level ready)**
  - Inspects `Scene.levels` backgrounds/foregrounds, top-level scene art, and `Tile` textures.
  - Detects oversized textures (configurable max pixel edge & megapixel budget), **PNG / unoptimized raster formats instead of WebP**, excessive walls, ambient lights, and active scene animations (animated lights, video tiles/backgrounds, animated tokens, weather).
  - **Auto-Fix:** Converts PNG/JPG/BMP/TIFF maps & tiles directly in-browser to `.webp` via Canvas, uploads via Foundry's `FilePicker` (redirecting protected `modules/` or `systems/` paths into `worlds/<id>/waifu-optimized/`), and updates the Scene/Level/Tile paths. Also supports safe zero-length/duplicate wall deduplication and batch clearing of light animations.
- **Broken `@UUID` Scanner (Journals, Loreframe/Flags, Actors)**
  - Recursively scans `JournalEntry` & `JournalEntryPage` (`text.content`, `text.markdown`, `system`, `flags` — including Loreframe and custom journal modules) as well as `Actor`, embedded `Item`, and embedded `ActiveEffect`.
  - Validates `@UUID[...]{...}`, HTML `data-uuid="..."` links, `#anchor` references, relative `.SubDoc.id` links, and bare UUIDs under flag/system relation keys.
  - **Auto-Fix:** Ranks candidate replacements across World documents and loaded Compendium packs by document type and normalized name similarity; supports 1-click replacement, batch exact-match replacement, or safe unlinking that preserves visible text.
- **World Settings & Orphaned Flags Control**
  - Measures UTF-8 JSON payload sizes across `WorldSettings` and all world/embedded document flag namespaces.
  - Separates **deleted/uninstalled modules** (`orphaned`) from **temporarily disabled modules** (`inactive`) and **bloated active namespaces** (`bloated`).
  - **Auto-Fix:** Downloads an optional JSON backup snapshot before selectively or batch-cleaning orphaned world settings and deleted-module flag namespaces.
- **Detailed Report Preview & Export**
  - Built-in **Visual Report** viewer with embedded SVG charts and statistical distributions (`Min / Avg / Median / P95 / Max`), plus **Markdown** and **Foundry Journal** previews.
  - Exports standalone printable **HTML (`.html`)** reports with embedded charts, **Markdown (`.md`)** with statistical tables & visual bars, and **JSON (`.json`)**, copies Markdown to clipboard, or saves a summary straight into a Foundry `JournalEntry`.

## Compatibility

- **Foundry VTT:** v14+
- **Languages:** English (`en`), Русский (`ru`)
- **Public API:** `game.modules.get("waifu").api` (`open()`, `runAudit()`, `exportReport(report, format, lang)` supporting `"markdown"`, `"html"`, and `"json"`)

## Development

```sh
npm run check
npm run package
```

## Author

Created by [TacticalOtaku](https://github.com/TacticalOtaku).
