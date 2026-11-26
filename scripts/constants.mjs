/**
 * Shared constants, default audit thresholds, and media extension tables for WAIFU.
 */

export const MODULE_ID = "waifu";
export const MODULE_TITLE = "WAIFU: World Audit & Integrity";

export const IGNORE_RULES_SETTING = "ignoreRules";
export const AUDIT_HISTORY_SETTING = "auditHistory";
export const LAST_AUDIT_REPORT_SETTING = "lastAuditReport";
export const MAX_HISTORY_ENTRIES = 15;

export const DEFAULT_THRESHOLDS = Object.freeze({
  maxTextureResolution: 4096,
  maxMegapixels: 18,
  maxAssetBytes: 15 * 1024 * 1024,
  maxWalls: 300,
  maxLights: 40,
  maxAnimations: 15,
  nearDuplicateWallTolerance: 2,
  maxSettingBytes: 16 * 1024,
  maxFlagBytes: 32 * 1024,
  webpQuality: 0.85,
  downscaleOnConvert: false,
  skipLargerWebp: true,
  uuidMinAutoConfidence: 1.0,
  maxChatMessages: 1000
});

export const DEFAULT_IGNORE_RULES = Object.freeze({
  scenes: [],
  settings: [],
  flags: [],
  uuids: []
});

export const THEME_OPTIONS = Object.freeze(["night", "parchment"]);
export const ACCENT_OPTIONS = Object.freeze([
  "brass",
  "embers",
  "arcane",
  "forest",
  "frost",
  "rose"
]);

export const PNG_EXTENSIONS = new Set(["png"]);
export const UNOPTIMIZED_RASTER_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "bmp",
  "tga",
  "tif",
  "tiff",
  "gif"
]);
export const WEBP_EXTENSIONS = new Set(["webp"]);
export const VIDEO_EXTENSIONS = new Set(["webm", "mp4", "m4v", "ogv"]);
export const AUDIO_EXTENSIONS = new Set(["ogg", "mp3", "wav", "flac", "opus", "m4a", "aac"]);

export const CORE_NAMESPACES = new Set(["core", "world"]);

export const SEVERITY_ORDER = Object.freeze({
  critical: 3,
  warning: 2,
  info: 1,
  ok: 0
});

export const WORLD_FLAG_COLLECTIONS = Object.freeze([
  "scenes",
  "actors",
  "items",
  "journal",
  "tables",
  "cards",
  "macros",
  "playlists",
  "combats",
  "folders",
  "users"
]);

export const PROTECTED_UPLOAD_PREFIXES = Object.freeze([
  "modules/",
  "systems/",
  "icons/",
  "ui/",
  "scripts/",
  "css/",
  "fonts/",
  "lang/",
  "cards/"
]);
