import { isVideoAsset, suggestWebpTarget } from "../core/utils.mjs";

/**
 * Probe image or video dimensions and byte size for a single asset path.
 * @param {string} src
 * @param {number} timeoutMs
 * @returns {Promise<{ width: number, height: number, byteSize: number | null, estimated: boolean }>}
 */
export async function probeMediaAsset(src, timeoutMs = 4000) {
  if (!src || typeof src !== "string") {
    return { width: 0, height: 0, byteSize: null, estimated: true };
  }

  const [dimensions, byteSize] = await Promise.all([
    isVideoAsset(src) ? probeVideoDimensions(src, timeoutMs) : probeImageDimensions(src, timeoutMs),
    probeByteSize(src, timeoutMs)
  ]);

  return {
    width: dimensions.width,
    height: dimensions.height,
    byteSize,
    estimated: dimensions.width === 0
  };
}

/**
 * Probe multiple unique media paths with bounded concurrency.
 * @param {Iterable<string>} sources
 * @param {number} concurrency
 * @returns {Promise<Map<string, { width: number, height: number, byteSize: number | null, estimated: boolean }>>}
 */
export async function probeMediaBatch(sources, concurrency = 6) {
  const unique = [...new Set([...sources].filter(Boolean))];
  const results = new Map();
  let cursor = 0;

  async function worker() {
    while (cursor < unique.length) {
      const idx = cursor;
      cursor += 1;
      const src = unique[idx];
      try {
        results.set(src, await probeMediaAsset(src));
      } catch {
        results.set(src, { width: 0, height: 0, byteSize: null, estimated: true });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, unique.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function probeImageDimensions(src, timeoutMs) {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ width: 0, height: 0 });
    }, timeoutMs);

    const finish = (width, height) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ width, height });
    };

    img.decoding = "async";
    img.onload = () => finish(img.naturalWidth || 0, img.naturalHeight || 0);
    img.onerror = () => finish(0, 0);
    img.src = src;
  });
}

function probeVideoDimensions(src, timeoutMs) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      video.removeAttribute("src");
      video.load();
      resolve({ width: 0, height: 0 });
    }, timeoutMs);

    const finish = (width, height) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve({ width, height });
    };

    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => finish(video.videoWidth || 0, video.videoHeight || 0);
    video.onerror = () => finish(0, 0);
    video.src = src;
  });
}

async function probeByteSize(src, timeoutMs) {
  // Only issue HEAD for relative/same-origin URLs so remote hosts without CORS do not fail noisily.
  if (/^https?:\/\//i.test(src) && !src.startsWith(window.location.origin)) {
    return null;
  }
  if (src.startsWith("data:") || src.startsWith("blob:")) return null;

  try {
    const response = await fetch(src, {
      method: "HEAD",
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) return null;
    const len = response.headers.get("content-length");
    const parsed = len ? Number.parseInt(len, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Convert an image path into a WebP Blob in the browser, optionally downscaling oversized dimensions.
 * @param {string} src
 * @param {{ quality?: number, maxResolution?: number, downscale?: boolean }} options
 * @returns {Promise<{ blob: Blob, originalBytes: number, webpBytes: number, width: number, height: number }>}
 */
export async function encodeAssetToWebp(src, options = {}) {
  const quality = Math.min(1, Math.max(0.5, Number(options.quality) || 0.85));
  const maxResolution = Number(options.maxResolution) || 4096;
  const downscale = Boolean(options.downscale);

  const response = await fetch(src, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while loading ${src}`);
  }

  const originalBlob = await response.blob();
  const bitmap = await createImageBitmap(originalBlob);

  try {
    let targetW = bitmap.width;
    let targetH = bitmap.height;
    const maxEdge = Math.max(targetW, targetH);

    if (downscale && maxEdge > maxResolution && maxEdge > 0) {
      const scale = maxResolution / maxEdge;
      targetW = Math.max(1, Math.round(targetW * scale));
      targetH = Math.max(1, Math.round(targetH * scale));
    }

    let webpBlob;
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(targetW, targetH);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      webpBlob = await canvas.convertToBlob({ type: "image/webp", quality });
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      webpBlob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error("Canvas toBlob returned null"))),
          "image/webp",
          quality
        );
      });
    }

    return {
      blob: webpBlob,
      originalBytes: originalBlob.size,
      webpBytes: webpBlob.size,
      width: targetW,
      height: targetH
    };
  } finally {
    bitmap.close();
  }
}

function getFilePickerImpl() {
  return foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
}

/**
 * Ensure a nested Foundry data directory exists before uploading into it.
 * @param {string} directory
 */
async function ensureDataDirectory(directory) {
  const FilePickerImpl = getFilePickerImpl();
  const segments = String(directory ?? "").split("/").filter(Boolean);
  let current = "";
  for (const seg of segments) {
    current = current ? `${current}/${seg}` : seg;
    try {
      await FilePickerImpl.browse("data", current);
    } catch {
      try {
        await FilePickerImpl.createDirectory("data", current);
      } catch {
        // Ignore race or existing directory errors
      }
    }
  }
}

/**
 * Resolve a non-colliding WebP filename inside the target directory.
 * @param {string} directory
 * @param {string} filename
 * @returns {Promise<string>}
 */
async function resolveNonCollidingFilename(directory, filename) {
  const FilePickerImpl = getFilePickerImpl();
  try {
    const listing = await FilePickerImpl.browse("data", directory);
    const existing = new Set((listing?.files ?? []).map((p) => p.split("/").pop()));
    if (!existing.has(filename)) return filename;

    const stem = filename.replace(/\.webp$/i, "");
    let suffix = 1;
    let candidate = `${stem}-waifu.webp`;
    while (existing.has(candidate) && suffix < 100) {
      suffix += 1;
      candidate = `${stem}-waifu-${suffix}.webp`;
    }
    return candidate;
  } catch {
    return filename;
  }
}

/**
 * Convert an image asset to WebP and upload it via Foundry FilePicker.
 * @param {string} src
 * @param {{ worldId: string, quality?: number, maxResolution?: number, downscale?: boolean }} options
 * @returns {Promise<{ targetPath: string, originalBytes: number, webpBytes: number, width: number, height: number }>}
 */
export async function convertAndUploadWebp(src, options) {
  const FilePickerImpl = getFilePickerImpl();
  const encoded = await encodeAssetToWebp(src, options);
  const plan = suggestWebpTarget(src, options.worldId);

  await ensureDataDirectory(plan.directory);
  const finalFilename = await resolveNonCollidingFilename(plan.directory, plan.filename);
  const file = new File([encoded.blob], finalFilename, { type: "image/webp" });

  const uploadResult = await FilePickerImpl.upload(
    "data",
    plan.directory,
    file,
    {},
    { notify: false }
  );

  const uploadedPath = uploadResult?.path || `${plan.directory}/${finalFilename}`;
  return {
    targetPath: uploadedPath,
    originalBytes: encoded.originalBytes,
    webpBytes: encoded.webpBytes,
    width: encoded.width,
    height: encoded.height
  };
}
