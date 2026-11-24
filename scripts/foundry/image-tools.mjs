import { isAudioAsset, isDataOrExternalUrl, isVideoAsset, suggestWebpTarget } from "../core/utils.mjs";

/**
 * Probe image, video, or audio dimensions, byte size, and missing (404) status for a single asset path.
 * @param {string} src
 * @param {number} timeoutMs
 * @param {{ signal?: AbortSignal }} options
 * @returns {Promise<{ width: number, height: number, byteSize: number | null, estimated: boolean, missing: boolean, statusCode: number | null }>}
 */
export async function probeMediaAsset(src, timeoutMs = 4000, options = {}) {
  if (!src || typeof src !== "string") {
    return { width: 0, height: 0, byteSize: null, estimated: true, missing: false, statusCode: null };
  }

  const audio = isAudioAsset(src);
  const video = !audio && isVideoAsset(src);
  const [dimensions, headInfo] = await Promise.all([
    audio
      ? Promise.resolve({ width: 0, height: 0, errored: false, timedOut: false })
      : video
        ? probeVideoDimensions(src, timeoutMs)
        : probeImageDimensions(src, timeoutMs),
    probeResourceHead(src, timeoutMs, options?.signal)
  ]);

  const external = isDataOrExternalUrl(src);
  const httpMissing = headInfo.statusCode === 404 || headInfo.statusCode === 410;
  const mediaMissing =
    !external &&
    !audio &&
    dimensions.errored &&
    !dimensions.timedOut &&
    headInfo.statusCode !== 200;
  const missing = Boolean(httpMissing || mediaMissing);

  return {
    width: dimensions.width,
    height: dimensions.height,
    byteSize: headInfo.byteSize,
    estimated: audio ? false : dimensions.width === 0,
    missing,
    statusCode: headInfo.statusCode
  };
}

/**
 * Probe multiple unique media paths with bounded concurrency, progress reporting, and cancellation.
 * @param {Iterable<string>} sources
 * @param {number | { concurrency?: number, signal?: AbortSignal, onProgress?: (info: { completed: number, total: number, src: string }) => void }} optionsOrConcurrency
 * @returns {Promise<Map<string, { width: number, height: number, byteSize: number | null, estimated: boolean, missing: boolean, statusCode: number | null }>>}
 */
export async function probeMediaBatch(sources, optionsOrConcurrency = 6) {
  const opts =
    typeof optionsOrConcurrency === "number"
      ? { concurrency: optionsOrConcurrency }
      : optionsOrConcurrency ?? {};
  const concurrency = Math.max(1, Number(opts.concurrency) || 6);
  const signal = opts.signal;
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;

  const unique = [...new Set([...sources].filter(Boolean))];
  const results = new Map();
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (cursor < unique.length) {
      if (signal?.aborted) break;
      const idx = cursor;
      cursor += 1;
      const src = unique[idx];
      try {
        results.set(src, await probeMediaAsset(src, 4000, { signal }));
      } catch {
        results.set(src, {
          width: 0,
          height: 0,
          byteSize: null,
          estimated: true,
          missing: false,
          statusCode: null
        });
      }
      completed += 1;
      onProgress?.({ completed, total: unique.length, src });
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
      resolve({ width: 0, height: 0, errored: false, timedOut: true });
    }, timeoutMs);

    const finish = (width, height, errored = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ width, height, errored, timedOut: false });
    };

    img.decoding = "async";
    img.onload = () => finish(img.naturalWidth || 0, img.naturalHeight || 0, false);
    img.onerror = () => finish(0, 0, true);
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
      resolve({ width: 0, height: 0, errored: false, timedOut: true });
    }, timeoutMs);

    const finish = (width, height, errored = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve({ width, height, errored, timedOut: false });
    };

    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => finish(video.videoWidth || 0, video.videoHeight || 0, false);
    video.onerror = () => finish(0, 0, true);
    video.src = src;
  });
}

async function probeResourceHead(src, timeoutMs, externalSignal = null) {
  // Only issue HEAD for relative/same-origin URLs so remote hosts without CORS do not fail noisily.
  if (/^https?:\/\//i.test(src) && !src.startsWith(window.location.origin)) {
    return { byteSize: null, statusCode: null };
  }
  if (src.startsWith("data:") || src.startsWith("blob:")) {
    return { byteSize: null, statusCode: null };
  }

  try {
    const timeoutSig = AbortSignal.timeout(timeoutMs);
    const signal =
      externalSignal && typeof AbortSignal.any === "function"
        ? AbortSignal.any([timeoutSig, externalSignal])
        : timeoutSig;
    const response = await fetch(src, { method: "HEAD", signal });
    const statusCode = response.status;
    if (!response.ok) return { byteSize: null, statusCode };
    const len = response.headers.get("content-length");
    const parsed = len ? Number.parseInt(len, 10) : NaN;
    return {
      byteSize: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
      statusCode
    };
  } catch {
    return { byteSize: null, statusCode: null };
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
  const timeoutSig = AbortSignal.timeout(30_000);
  const signal =
    options.signal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([timeoutSig, options.signal])
      : timeoutSig;

  const response = await fetch(src, { signal });
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
 * Convert an image asset to WebP and upload it via Foundry FilePicker, skipping if larger when configured.
 * @param {string} src
 * @param {{ worldId: string, quality?: number, maxResolution?: number, downscale?: boolean, skipIfLarger?: boolean, signal?: AbortSignal }} options
 * @returns {Promise<{ skipped?: boolean, reason?: string, targetPath: string, originalBytes: number, webpBytes: number, width: number, height: number }>}
 */
export async function convertAndUploadWebp(src, options) {
  if (options?.signal?.aborted) {
    throw new DOMException("Conversion aborted", "AbortError");
  }
  const FilePickerImpl = getFilePickerImpl();
  const encoded = await encodeAssetToWebp(src, options);
  const skipIfLarger = options?.skipIfLarger !== false;
  if (skipIfLarger && !options?.downscale && encoded.webpBytes >= encoded.originalBytes) {
    return {
      skipped: true,
      reason: "larger-than-original",
      targetPath: src,
      originalBytes: encoded.originalBytes,
      webpBytes: encoded.webpBytes,
      width: encoded.width,
      height: encoded.height
    };
  }

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
    skipped: false,
    targetPath: uploadedPath,
    originalBytes: encoded.originalBytes,
    webpBytes: encoded.webpBytes,
    width: encoded.width,
    height: encoded.height
  };
}

/**
 * List files inside `worlds/<worldId>/waifu-optimized` not referenced by active world documents.
 * @param {string} worldId
 * @param {Set<string>} referencedPaths
 * @returns {Promise<Array<{ path: string, filename: string }>>}
 */
export async function findUnusedOptimizedFiles(worldId, referencedPaths) {
  const FilePickerImpl = getFilePickerImpl();
  if (!FilePickerImpl) return [];
  const dir = `worlds/${worldId}/waifu-optimized`;
  try {
    const listing = await FilePickerImpl.browse("data", dir);
    const normalizedRefs = new Set(
      [...(referencedPaths ?? [])].map((p) => {
        const clean = String(p ?? "").trim().split(/[?#]/, 1)[0].replace(/^\/+/, "");
        try {
          return decodeURIComponent(clean);
        } catch {
          return clean;
        }
      })
    );

    const unused = [];
    for (const filePath of listing?.files ?? []) {
      const clean = String(filePath ?? "").trim().replace(/^\/+/, "");
      let decoded = clean;
      try {
        decoded = decodeURIComponent(clean);
      } catch {
        // Keep clean string
      }
      if (!normalizedRefs.has(clean) && !normalizedRefs.has(decoded)) {
        unused.push({
          path: clean,
          filename: clean.split("/").pop() || clean
        });
      }
    }
    return unused;
  } catch {
    return [];
  }
}
