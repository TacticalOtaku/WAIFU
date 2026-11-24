import {
  AUDIO_EXTENSIONS,
  PNG_EXTENSIONS,
  PROTECTED_UPLOAD_PREFIXES,
  UNOPTIMIZED_RASTER_EXTENSIONS,
  VIDEO_EXTENSIONS,
  WEBP_EXTENSIONS
} from "../constants.mjs";

const TEXT_ENCODER = new TextEncoder();

/**
 * Safely compute the UTF-8 byte length of a string or JSON-serializable value.
 * @param {unknown} value
 * @returns {number}
 */
export function utf8ByteSize(value) {
  if (value === undefined || value === null) return 0;
  if (typeof value === "string") return TEXT_ENCODER.encode(value).length;

  try {
    const seen = new WeakSet();
    const json = JSON.stringify(value, (_key, item) => {
      if (typeof item === "bigint") return item.toString();
      if (item && typeof item === "object") {
        if (seen.has(item)) return "[Circular]";
        seen.add(item);
      }
      return item;
    });
    return json ? TEXT_ENCODER.encode(json).length : 0;
  } catch {
    return TEXT_ENCODER.encode(String(value)).length;
  }
}

/**
 * Format a byte count into a human-readable unit string.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe < 1024) return `${Math.round(safe)} B`;
  const units = ["KB", "MB", "GB"];
  let value = safe / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Extract the lowercase file extension from a URL or asset path, ignoring query/hash.
 * @param {string} src
 * @returns {string}
 */
export function getMediaExtension(src) {
  if (typeof src !== "string" || !src.trim()) return "";
  const trimmed = src.trim();
  if (trimmed.startsWith("data:")) {
    const mimeMatch = /^data:image\/([a-z0-9+.-]+);/i.exec(trimmed);
    return mimeMatch ? mimeMatch[1].toLowerCase() : "";
  }
  const clean = trimmed.split(/[?#]/, 1)[0];
  const lastSegment = clean.split("/").pop() ?? "";
  const dotIdx = lastSegment.lastIndexOf(".");
  if (dotIdx <= 0 || dotIdx === lastSegment.length - 1) return "";
  return lastSegment.slice(dotIdx + 1).toLowerCase();
}

export function isPngAsset(src) {
  return PNG_EXTENSIONS.has(getMediaExtension(src));
}

export function isUnoptimizedRasterAsset(src) {
  return UNOPTIMIZED_RASTER_EXTENSIONS.has(getMediaExtension(src));
}

export function isWebpAsset(src) {
  return WEBP_EXTENSIONS.has(getMediaExtension(src));
}

export function isVideoAsset(src) {
  return VIDEO_EXTENSIONS.has(getMediaExtension(src));
}

export function isAudioAsset(src) {
  return AUDIO_EXTENSIONS.has(getMediaExtension(src));
}

/**
 * Slugify heading text into a Foundry-compatible journal anchor slug.
 * @param {string} text
 * @returns {string}
 */
export function slugifyAnchor(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Extract explicit element IDs and heading slugs from Journal HTML or Markdown text.
 * @param {string} html
 * @param {string} markdown
 * @returns {Set<string>}
 */
export function extractJournalAnchors(html = "", markdown = "") {
  const anchors = new Set();
  const addAnchor = (raw) => {
    const clean = String(raw ?? "").trim().replace(/^#/, "");
    if (!clean) return;
    anchors.add(clean);
    anchors.add(clean.toLowerCase());
    const slug = slugifyAnchor(clean);
    if (slug) anchors.add(slug);
  };

  if (typeof html === "string" && html) {
    const idRegex = /\b(?:id|name)=(["'])([^"']+)\1/gi;
    let match;
    while ((match = idRegex.exec(html)) !== null) {
      addAnchor(match[2]);
    }

    const headingRegex = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
    while ((match = headingRegex.exec(html)) !== null) {
      const plain = match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      addAnchor(plain);
    }
  }

  if (typeof markdown === "string" && markdown) {
    const mdHeadingRegex = /^\s{0,3}#{1,6}\s+(.+?)\s*#*$/gm;
    let match;
    while ((match = mdHeadingRegex.exec(markdown)) !== null) {
      addAnchor(match[1]);
    }
  }

  return anchors;
}

export function isDataOrExternalUrl(src) {
  if (typeof src !== "string") return false;
  const lower = src.trim().toLowerCase();
  return (
    lower.startsWith("data:") ||
    lower.startsWith("blob:") ||
    lower.startsWith("http://") ||
    lower.startsWith("https://")
  );
}

/**
 * Determine whether a Foundry path belongs to a protected/core directory that FilePicker cannot upload into.
 * @param {string} src
 * @returns {boolean}
 */
export function isProtectedFoundryPath(src) {
  if (typeof src !== "string" || !src.trim()) return true;
  if (isDataOrExternalUrl(src)) return true;
  const clean = src.trim().replace(/^\/+/, "");
  return PROTECTED_UPLOAD_PREFIXES.some((prefix) => clean.startsWith(prefix));
}

/**
 * Compute a safe target directory and WebP filename for an image conversion.
 * Writable world/user paths keep the asset in-place; protected module/system/remote paths
 * redirect into `worlds/<worldId>/waifu-optimized`.
 * @param {string} src
 * @param {string} worldId
 * @returns {{ directory: string, filename: string, targetPath: string, redirected: boolean }}
 */
export function suggestWebpTarget(src, worldId = "world") {
  const clean = String(src ?? "").trim().split(/[?#]/, 1)[0].replace(/^\/+/, "");
  const fallbackDir = `worlds/${worldId}/waifu-optimized`;

  let rawBase = "optimized-map";
  if (!clean.startsWith("data:")) {
    const filePart = clean.split("/").pop() ?? "";
    const dotIdx = filePart.lastIndexOf(".");
    const stem = dotIdx > 0 ? filePart.slice(0, dotIdx) : filePart;
    if (stem) rawBase = decodeSafe(stem).replace(/[^a-zA-Z0-9._-]+/g, "-");
  }

  const filename = `${rawBase}.webp`;
  if (isProtectedFoundryPath(clean)) {
    return {
      directory: fallbackDir,
      filename,
      targetPath: `${fallbackDir}/${filename}`,
      redirected: true
    };
  }

  const slashIdx = clean.lastIndexOf("/");
  const directory = slashIdx > 0 ? clean.slice(0, slashIdx) : fallbackDir;
  return {
    directory,
    filename,
    targetPath: `${directory}/${filename}`,
    redirected: false
  };
}

function decodeSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Escape HTML special characters for safe rendering or Journal export.
 * @param {unknown} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Normalize text for fuzzy document-name matching.
 * @param {string} text
 * @returns {string}
 */
export function normalizeForMatch(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Compute Dice bigram similarity in [0, 1] between two strings.
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function diceSimilarity(left, right) {
  const a = normalizeForMatch(left);
  const b = normalizeForMatch(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const bigramsA = new Map();
  for (let i = 0; i < a.length - 1; i += 1) {
    const bg = a.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) ?? 0) + 1);
  }

  let matches = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const bg = b.slice(i, i + 2);
    const count = bigramsA.get(bg) ?? 0;
    if (count > 0) {
      matches += 1;
      bigramsA.set(bg, count - 1);
    }
  }

  return (2 * matches) / ((a.length - 1) + (b.length - 1));
}

/**
 * Format a localized template string using `{key}` placeholders.
 * @param {string} template
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
export function interpolate(template, params = {}) {
  return String(template ?? "").replace(/\{(\w+)\}/g, (full, key) =>
    Object.hasOwn(params, key) ? String(params[key]) : full
  );
}
