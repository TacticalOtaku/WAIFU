import { DEFAULT_THRESHOLDS, SEVERITY_ORDER } from "../constants.mjs";
import {
  formatBytes,
  getMediaExtension,
  isPngAsset,
  isUnoptimizedRasterAsset,
  isVideoAsset,
  isWebpAsset
} from "./utils.mjs";

/**
 * Collect unique media texture slots from a v14 Scene snapshot (levels + scene fallback + tiles).
 * @param {Object} scene
 * @returns {Array<Object>}
 */
export function collectSceneImageSlots(scene) {
  const slots = [];
  const levels = Array.isArray(scene.levels) ? scene.levels : [];
  const seenLevelPaths = new Set();

  for (const level of levels) {
    if (!level) continue;
    const levelLabel = level.name || level.id || "Level";
    if (level.backgroundSrc) {
      seenLevelPaths.add(`bg:${level.backgroundSrc}`);
      slots.push({
        slotType: "level-background",
        levelId: level.id,
        levelName: levelLabel,
        tileId: null,
        src: level.backgroundSrc,
        fallbackWidth: Number(level.width) || Number(scene.width) || 0,
        fallbackHeight: Number(level.height) || Number(scene.height) || 0
      });
    }
    if (level.foregroundSrc) {
      seenLevelPaths.add(`fg:${level.foregroundSrc}`);
      slots.push({
        slotType: "level-foreground",
        levelId: level.id,
        levelName: levelLabel,
        tileId: null,
        src: level.foregroundSrc,
        fallbackWidth: Number(level.width) || Number(scene.width) || 0,
        fallbackHeight: Number(level.height) || Number(scene.height) || 0
      });
    }
  }

  // Fallback for scenes with top-level background/foreground not represented in levels
  if (scene.backgroundSrc && !seenLevelPaths.has(`bg:${scene.backgroundSrc}`)) {
    slots.push({
      slotType: "scene-background",
      levelId: null,
      levelName: null,
      tileId: null,
      src: scene.backgroundSrc,
      fallbackWidth: Number(scene.width) || 0,
      fallbackHeight: Number(scene.height) || 0
    });
  }
  if (scene.foregroundSrc && !seenLevelPaths.has(`fg:${scene.foregroundSrc}`)) {
    slots.push({
      slotType: "scene-foreground",
      levelId: null,
      levelName: null,
      tileId: null,
      src: scene.foregroundSrc,
      fallbackWidth: Number(scene.width) || 0,
      fallbackHeight: Number(scene.height) || 0
    });
  }

  const tiles = Array.isArray(scene.tiles) ? scene.tiles : [];
  for (const tile of tiles) {
    if (!tile?.src) continue;
    slots.push({
      slotType: "tile",
      levelId: tile.levelId ?? null,
      levelName: null,
      tileId: tile.id,
      src: tile.src,
      fallbackWidth: Number(tile.width) || 0,
      fallbackHeight: Number(tile.height) || 0
    });
  }

  return slots;
}

/**
 * Identify zero-length, exact-duplicate, and optional near-duplicate wall segments on a scene.
 * @param {Array<Object>} walls
 * @param {{ nearTolerance?: number }} options
 * @returns {{ zeroLengthIds: string[], duplicateIds: string[], nearDuplicateIds: string[] }}
 */
export function findRedundantWalls(walls, options = {}) {
  const zeroLengthIds = [];
  const duplicateIds = [];
  const nearDuplicateIds = [];
  const nearTolerance = Math.max(0, Number(options?.nearTolerance) || 0);
  const seenSignatures = new Set();
  const keptByPropKey = new Map();

  for (const wall of walls ?? []) {
    const coords = Array.isArray(wall?.c) ? wall.c : [];
    if (coords.length < 4) continue;
    const [x1, y1, x2, y2] = coords.map(Number);
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
      continue;
    }
    if (x1 === x2 && y1 === y2) {
      if (wall.id) zeroLengthIds.push(wall.id);
      continue;
    }

    // Normalize endpoint order so reversed identical segments deduplicate safely
    const forward = x1 < x2 || (x1 === x2 && y1 <= y2);
    const ax = forward ? x1 : x2;
    const ay = forward ? y1 : y2;
    const bx = forward ? x2 : x1;
    const by = forward ? y2 : y1;
    const levelsKey = Array.isArray(wall.levels) ? [...wall.levels].sort().join(",") : "";
    const propKey = [
      wall.move ?? "",
      wall.sight ?? "",
      wall.light ?? "",
      wall.sound ?? "",
      wall.door ?? 0,
      wall.elevation ?? "",
      levelsKey
    ].join("|");
    const signature = `${ax},${ay}|${bx},${by}|${propKey}`;

    if (seenSignatures.has(signature)) {
      if (wall.id) duplicateIds.push(wall.id);
      continue;
    }
    seenSignatures.add(signature);

    if (nearTolerance > 0 && wall.id) {
      const bucket = keptByPropKey.get(propKey) ?? [];
      const isNearDup = bucket.some(
        (prev) =>
          Math.hypot(ax - prev.ax, ay - prev.ay) <= nearTolerance &&
          Math.hypot(bx - prev.bx, by - prev.by) <= nearTolerance
      );
      if (isNearDup) {
        nearDuplicateIds.push(wall.id);
        continue;
      }
      bucket.push({ ax, ay, bx, by });
      keptByPropKey.set(propKey, bucket);
    }
  }

  return { zeroLengthIds, duplicateIds, nearDuplicateIds };
}

/**
 * Evaluate flags, severity, and heaviness score for an already-collected scene snapshot.
 * @param {Object} sceneData
 * @param {Partial<typeof DEFAULT_THRESHOLDS>} customThresholds
 * @returns {Object}
 */
export function evaluateSceneMetrics(sceneData, customThresholds = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...customThresholds };
  const assets = Array.isArray(sceneData.assets) ? sceneData.assets : [];
  const extraMissingMedia = Array.isArray(sceneData.extraMissingMedia)
    ? sceneData.extraMissingMedia
    : [];
  const redundantWallIds = Array.isArray(sceneData.redundantWallIds)
    ? sceneData.redundantWallIds
    : [];
  const nearDuplicateWallIds = Array.isArray(sceneData.nearDuplicateWallIds)
    ? sceneData.nearDuplicateWallIds
    : [];
  const orphanedTokenIds = Array.isArray(sceneData.orphanedTokenIds)
    ? sceneData.orphanedTokenIds
    : [];
  const wallsCount = Number(sceneData.wallsCount) || 0;
  const lightsCount = Number(sceneData.lightsCount) || 0;
  const animationsCount = Number(sceneData.animationsCount) || 0;
  const isIgnored = Boolean(sceneData.isIgnored);

  const maxAsset = assets.reduce(
    (best, item) => (item.maxEdge > best.maxEdge || item.megapixels > best.megapixels ? item : best),
    { width: 0, height: 0, maxEdge: 0, megapixels: 0 }
  );

  const pngAssets = assets.filter((asset) => asset.isPng);
  const unoptimizedAssets = assets.filter((asset) => asset.isUnoptimizedRaster);
  const oversizedAssets = assets.filter((asset) => asset.isOversized);
  const missingAssets = assets.filter((asset) => asset.isMissing);
  const heavyBytesAssets = assets.filter((asset) => asset.isHeavyBytes);
  const totalKnownAssetBytes = assets.reduce(
    (sum, asset) => sum + (Number.isFinite(asset.byteSize) && asset.byteSize > 0 ? asset.byteSize : 0),
    0
  );
  const missingMediaCount = missingAssets.length + extraMissingMedia.length;

  const flags = {
    hasPng: pngAssets.length > 0,
    hasUnoptimizedRaster: unoptimizedAssets.length > 0,
    hasOversizedAsset: oversizedAssets.length > 0,
    hasMissingAsset: missingMediaCount > 0,
    hasHeavyBytes: heavyBytesAssets.length > 0,
    excessiveWalls: wallsCount > thresholds.maxWalls,
    excessiveLights: lightsCount > thresholds.maxLights,
    excessiveAnimations: animationsCount > thresholds.maxAnimations,
    hasRedundantWalls: redundantWallIds.length > 0,
    hasNearDuplicateWalls: nearDuplicateWallIds.length > 0,
    hasOrphanedTokens: orphanedTokenIds.length > 0
  };

  let severity = "ok";
  const hasSevereDimensions = oversizedAssets.some(
    (asset) =>
      asset.maxEdge > thresholds.maxTextureResolution * 1.5 ||
      asset.megapixels > thresholds.maxMegapixels * 1.5
  );
  const hasSeverePng = pngAssets.some((asset) => asset.maxEdge >= 2048 || asset.isOversized);
  const hasSevereBytes = heavyBytesAssets.some(
    (asset) => asset.byteSize > (Number(thresholds.maxAssetBytes) || 15 * 1024 * 1024) * 2
  );
  const hasSeverePlaceables =
    wallsCount > thresholds.maxWalls * 1.5 ||
    lightsCount > thresholds.maxLights * 1.5 ||
    animationsCount > thresholds.maxAnimations * 1.5;

  if (!isIgnored) {
    if (missingMediaCount > 0 || hasSevereDimensions || hasSeverePng || hasSevereBytes || hasSeverePlaceables) {
      severity = "critical";
    } else if (
      flags.hasUnoptimizedRaster ||
      flags.hasOversizedAsset ||
      flags.hasHeavyBytes ||
      flags.excessiveWalls ||
      flags.excessiveLights ||
      flags.excessiveAnimations ||
      flags.hasRedundantWalls ||
      flags.hasNearDuplicateWalls ||
      flags.hasOrphanedTokens
    ) {
      severity = "warning";
    }
  }

  // Compute deterministic heaviness score for sorting worst offenders first
  const score =
    (maxAsset.megapixels || 0) * 3 +
    pngAssets.length * 18 +
    (unoptimizedAssets.length - pngAssets.length) * 8 +
    missingMediaCount * 24 +
    heavyBytesAssets.length * 10 +
    Math.max(0, wallsCount - thresholds.maxWalls) * 0.2 +
    Math.max(0, lightsCount - thresholds.maxLights) * 1.5 +
    Math.max(0, animationsCount - thresholds.maxAnimations) * 3 +
    redundantWallIds.length * 0.5 +
    nearDuplicateWallIds.length * 0.3 +
    orphanedTokenIds.length * 1;

  return {
    maxResolution: {
      width: maxAsset.width,
      height: maxAsset.height,
      maxEdge: maxAsset.maxEdge,
      megapixels: maxAsset.megapixels
    },
    missingMediaCount,
    heavyBytesCount: heavyBytesAssets.length,
    totalKnownAssetBytes,
    formattedTotalAssetBytes: totalKnownAssetBytes > 0 ? formatBytes(totalKnownAssetBytes) : "",
    pngCount: pngAssets.length,
    unoptimizedCount: unoptimizedAssets.length,
    oversizedCount: oversizedAssets.length,
    flags,
    severity,
    heavinessScore: Number(score.toFixed(1)),
    hasIssues: !isIgnored && severity !== "ok"
  };
}

/**
 * Audit a single normalized Scene snapshot against configured performance thresholds.
 * @param {Object} scene
 * @param {Map<string, { width: number, height: number, byteSize: number | null, estimated?: boolean }>} assetMetaMap
 * @param {Partial<typeof DEFAULT_THRESHOLDS>} customThresholds
 * @returns {Object}
 */
export function analyzeScene(scene, assetMetaMap = new Map(), customThresholds = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...customThresholds };
  const rawSlots = collectSceneImageSlots(scene);

  const assets = rawSlots.map((slot) => {
    const meta = assetMetaMap.get(slot.src);
    const isMissing = Boolean(meta?.missing);
    const width = isMissing ? 0 : Number(meta?.width) || slot.fallbackWidth || 0;
    const height = isMissing ? 0 : Number(meta?.height) || slot.fallbackHeight || 0;
    const estimated = !isMissing && !meta?.width && width > 0;
    const maxEdge = Math.max(width, height);
    const megapixels = width > 0 && height > 0 ? Number(((width * height) / 1_000_000).toFixed(2)) : 0;
    const ext = getMediaExtension(slot.src);
    const png = isPngAsset(slot.src);
    const unoptimizedRaster = isUnoptimizedRasterAsset(slot.src);
    const video = isVideoAsset(slot.src);
    const byteSize = meta?.byteSize ?? null;
    const isHeavyBytes =
      !isMissing &&
      Number.isFinite(byteSize) &&
      Number(thresholds.maxAssetBytes) > 0 &&
      byteSize > Number(thresholds.maxAssetBytes);
    const oversized =
      !video &&
      !isMissing &&
      (maxEdge > thresholds.maxTextureResolution || megapixels > thresholds.maxMegapixels);

    return {
      ...slot,
      ext,
      width,
      height,
      maxEdge,
      megapixels,
      byteSize,
      formattedByteSize: Number.isFinite(byteSize) && byteSize > 0 ? formatBytes(byteSize) : "",
      estimated,
      isMissing,
      statusCode: meta?.statusCode ?? null,
      isHeavyBytes,
      isPng: png,
      isWebp: isWebpAsset(slot.src),
      isUnoptimizedRaster: unoptimizedRaster,
      isVideo: video,
      isOversized: oversized,
      canAutoConvert: unoptimizedRaster && !isMissing && !slot.src.startsWith("data:")
    };
  });

  const walls = Array.isArray(scene.walls) ? scene.walls : [];
  const lights = Array.isArray(scene.lights) ? scene.lights : [];
  const tokens = Array.isArray(scene.tokens) ? scene.tokens : [];
  const drawings = Array.isArray(scene.drawings) ? scene.drawings : [];
  const sounds = Array.isArray(scene.sounds) ? scene.sounds : [];
  const regions = Array.isArray(scene.regions) ? scene.regions : [];

  const { zeroLengthIds, duplicateIds, nearDuplicateIds } = findRedundantWalls(walls, {
    nearTolerance: thresholds.nearDuplicateWallTolerance ?? 0
  });
  const redundantWallIds = [...zeroLengthIds, ...duplicateIds];
  const doorsCount = walls.filter((wall) => Number(wall?.door) > 0).length;

  const orphanedTokenIds = tokens
    .filter((token) => token?.actorId && token.actorExists === false)
    .map((token) => token.id)
    .filter(Boolean);

  const animatedLightIds = lights
    .filter((light) => light?.animationType && light.animationType !== "none")
    .map((light) => light.id)
    .filter(Boolean);

  const animatedTokensCount = tokens.filter(
    (token) =>
      (token?.lightAnimationType && token.lightAnimationType !== "none") ||
      isVideoAsset(token?.textureSrc)
  ).length;

  const videoTilesCount = assets.filter((asset) => asset.slotType === "tile" && asset.isVideo).length;
  const videoLevelAssetsCount = assets.filter(
    (asset) => asset.slotType !== "tile" && asset.isVideo
  ).length;
  const videoDrawingsCount = drawings.filter((drawing) => isVideoAsset(drawing?.src)).length;
  const hasWeather = Boolean(scene.weather && scene.weather !== "none");

  const animationsCount =
    animatedLightIds.length +
    animatedTokensCount +
    videoTilesCount +
    videoLevelAssetsCount +
    videoDrawingsCount +
    (hasWeather ? 1 : 0);

  const extraMissingMedia = [];
  for (const token of tokens) {
    if (token?.textureSrc && assetMetaMap.get(token.textureSrc)?.missing) {
      extraMissingMedia.push({ slotType: "token", id: token.id, src: token.textureSrc });
    }
  }
  for (const drawing of drawings) {
    if (drawing?.src && assetMetaMap.get(drawing.src)?.missing) {
      extraMissingMedia.push({ slotType: "drawing", id: drawing.id, src: drawing.src });
    }
  }
  for (const sound of sounds) {
    if (sound?.path && assetMetaMap.get(sound.path)?.missing) {
      extraMissingMedia.push({ slotType: "sound", id: sound.id, src: sound.path });
    }
  }

  const isIgnored = Boolean(customThresholds.ignoredSceneIds?.has?.(scene.id));
  const evaluated = evaluateSceneMetrics(
    {
      assets,
      extraMissingMedia,
      wallsCount: walls.length,
      lightsCount: lights.length,
      animationsCount,
      redundantWallIds,
      nearDuplicateWallIds: nearDuplicateIds,
      orphanedTokenIds,
      isIgnored
    },
    thresholds
  );

  return {
    id: scene.id,
    uuid: scene.uuid ?? `Scene.${scene.id}`,
    name: scene.name || scene.id,
    active: Boolean(scene.active),
    isIgnored,
    levelsCount: Array.isArray(scene.levels) && scene.levels.length > 0 ? scene.levels.length : 1,
    tilesCount: Array.isArray(scene.tiles) ? scene.tiles.length : 0,
    tokensCount: tokens.length,
    orphanedTokenIds,
    soundsCount: sounds.length,
    regionsCount: regions.length,
    wallsCount: walls.length,
    doorsCount,
    redundantWallIds,
    zeroLengthWallIds: zeroLengthIds,
    duplicateWallIds: duplicateIds,
    nearDuplicateWallIds: nearDuplicateIds,
    lightsCount: lights.length,
    animatedLightIds,
    animationsCount,
    animationBreakdown: {
      animatedLights: animatedLightIds.length,
      animatedTokens: animatedTokensCount,
      videoTiles: videoTilesCount,
      videoLevelAssets: videoLevelAssetsCount,
      videoDrawings: videoDrawingsCount,
      weather: hasWeather ? 1 : 0
    },
    assets,
    extraMissingMedia,
    ...evaluated
  };
}

/**
 * Aggregate an array of analyzed scene objects into the standard `report.scenes` section.
 * @param {Array<Object>} scenesList
 * @returns {Object}
 */
export function summarizeScenes(scenesList) {
  const allResults = [...(scenesList ?? [])].toSorted(
    (a, b) =>
      Number(a.isIgnored) - Number(b.isIgnored) ||
      SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
      b.heavinessScore - a.heavinessScore ||
      a.name.localeCompare(b.name)
  );

  const results = allResults.filter((scene) => !scene.isIgnored);
  const ignoredItems = allResults.filter((scene) => scene.isIgnored);
  const heavyScenes = results.filter((scene) => scene.hasIssues);
  const convertibleAssets = results.flatMap((scene) =>
    (scene.assets ?? [])
      .filter((asset) => asset.canAutoConvert)
      .map((asset) => ({ ...asset, sceneId: scene.id, sceneName: scene.name }))
  );
  const pngAssets = convertibleAssets.filter((asset) => asset.isPng);
  const oversizedAssets = results.flatMap((scene) =>
    (scene.assets ?? [])
      .filter((asset) => asset.isOversized)
      .map((asset) => ({ ...asset, sceneId: scene.id, sceneName: scene.name }))
  );

  const redundantWallsTotal = results.reduce(
    (sum, scene) => sum + (scene.redundantWallIds?.length ?? 0),
    0
  );
  const nearDuplicateWallsTotal = results.reduce(
    (sum, scene) => sum + (scene.nearDuplicateWallIds?.length ?? 0),
    0
  );
  const missingMediaTotal = results.reduce(
    (sum, scene) => sum + (scene.missingMediaCount ?? 0),
    0
  );
  const orphanedTokensTotal = results.reduce(
    (sum, scene) => sum + (scene.orphanedTokenIds?.length ?? 0),
    0
  );
  const heavyBytesAssetsTotal = results.reduce(
    (sum, scene) => sum + (scene.heavyBytesCount ?? 0),
    0
  );

  return {
    totalScenes: results.length,
    ignoredCount: ignoredItems.length,
    ignoredItems,
    heavyScenesCount: heavyScenes.length,
    criticalCount: results.filter((s) => s.severity === "critical").length,
    warningCount: results.filter((s) => s.severity === "warning").length,
    pngAssetsCount: pngAssets.length,
    unoptimizedAssetsCount: convertibleAssets.length,
    oversizedAssetsCount: oversizedAssets.length,
    heavyBytesAssetsTotal,
    missingMediaTotal,
    redundantWallsTotal,
    nearDuplicateWallsTotal,
    orphanedTokensTotal,
    totalWalls: results.reduce((sum, s) => sum + (s.wallsCount ?? 0), 0),
    totalLights: results.reduce((sum, s) => sum + (s.lightsCount ?? 0), 0),
    totalAnimations: results.reduce((sum, s) => sum + (s.animationsCount ?? 0), 0),
    items: results,
    allItems: allResults,
    convertibleAssets
  };
}

/**
 * Audit all scenes in a world and return sorted scene diagnostics plus aggregates.
 * @param {Array<Object>} scenes
 * @param {Map<string, Object>} assetMetaMap
 * @param {Partial<typeof DEFAULT_THRESHOLDS> & { ignoredSceneIds?: Set<string> }} customThresholds
 * @returns {Object}
 */
export function auditScenes(scenes, assetMetaMap = new Map(), customThresholds = {}) {
  const analyzed = (scenes ?? []).map((scene) => analyzeScene(scene, assetMetaMap, customThresholds));
  return summarizeScenes(analyzed);
}
