import { DEFAULT_THRESHOLDS, SEVERITY_ORDER } from "../constants.mjs";
import {
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
 * Identify zero-length and exact-duplicate wall segments on a scene.
 * @param {Array<Object>} walls
 * @returns {{ zeroLengthIds: string[], duplicateIds: string[] }}
 */
export function findRedundantWalls(walls) {
  const zeroLengthIds = [];
  const duplicateIds = [];
  const seenSignatures = new Set();

  for (const wall of walls ?? []) {
    const coords = Array.isArray(wall?.c) ? wall.c : [];
    if (coords.length < 4) continue;
    const [x1, y1, x2, y2] = coords.map(Number);
    if (x1 === x2 && y1 === y2) {
      if (wall.id) zeroLengthIds.push(wall.id);
      continue;
    }

    // Normalize endpoint order so reversed identical segments deduplicate safely
    const forward = x1 < x2 || (x1 === x2 && y1 <= y2);
    const pA = forward ? `${x1},${y1}` : `${x2},${y2}`;
    const pB = forward ? `${x2},${y2}` : `${x1},${y1}`;
    const levelsKey = Array.isArray(wall.levels) ? [...wall.levels].sort().join(",") : "";
    const signature = [
      pA,
      pB,
      wall.move ?? "",
      wall.sight ?? "",
      wall.light ?? "",
      wall.sound ?? "",
      wall.door ?? 0,
      wall.elevation ?? "",
      levelsKey
    ].join("|");

    if (seenSignatures.has(signature)) {
      if (wall.id) duplicateIds.push(wall.id);
    } else {
      seenSignatures.add(signature);
    }
  }

  return { zeroLengthIds, duplicateIds };
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
    const width = Number(meta?.width) || slot.fallbackWidth || 0;
    const height = Number(meta?.height) || slot.fallbackHeight || 0;
    const estimated = !meta?.width && width > 0;
    const maxEdge = Math.max(width, height);
    const megapixels = width > 0 && height > 0 ? Number(((width * height) / 1_000_000).toFixed(2)) : 0;
    const ext = getMediaExtension(slot.src);
    const png = isPngAsset(slot.src);
    const unoptimizedRaster = isUnoptimizedRasterAsset(slot.src);
    const video = isVideoAsset(slot.src);
    const oversized =
      !video &&
      (maxEdge > thresholds.maxTextureResolution || megapixels > thresholds.maxMegapixels);

    return {
      ...slot,
      ext,
      width,
      height,
      maxEdge,
      megapixels,
      byteSize: meta?.byteSize ?? null,
      estimated,
      isPng: png,
      isWebp: isWebpAsset(slot.src),
      isUnoptimizedRaster: unoptimizedRaster,
      isVideo: video,
      isOversized: oversized,
      canAutoConvert: unoptimizedRaster && !slot.src.startsWith("data:")
    };
  });

  const walls = Array.isArray(scene.walls) ? scene.walls : [];
  const lights = Array.isArray(scene.lights) ? scene.lights : [];
  const tokens = Array.isArray(scene.tokens) ? scene.tokens : [];
  const drawings = Array.isArray(scene.drawings) ? scene.drawings : [];
  const sounds = Array.isArray(scene.sounds) ? scene.sounds : [];
  const regions = Array.isArray(scene.regions) ? scene.regions : [];

  const { zeroLengthIds, duplicateIds } = findRedundantWalls(walls);
  const redundantWallIds = [...zeroLengthIds, ...duplicateIds];
  const doorsCount = walls.filter((wall) => Number(wall?.door) > 0).length;

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

  const maxAsset = assets.reduce(
    (best, item) => (item.maxEdge > best.maxEdge || item.megapixels > best.megapixels ? item : best),
    { width: 0, height: 0, maxEdge: 0, megapixels: 0 }
  );

  const pngAssets = assets.filter((asset) => asset.isPng);
  const unoptimizedAssets = assets.filter((asset) => asset.isUnoptimizedRaster);
  const oversizedAssets = assets.filter((asset) => asset.isOversized);

  const flags = {
    hasPng: pngAssets.length > 0,
    hasUnoptimizedRaster: unoptimizedAssets.length > 0,
    hasOversizedAsset: oversizedAssets.length > 0,
    excessiveWalls: walls.length > thresholds.maxWalls,
    excessiveLights: lights.length > thresholds.maxLights,
    excessiveAnimations: animationsCount > thresholds.maxAnimations,
    hasRedundantWalls: redundantWallIds.length > 0
  };

  let severity = "ok";
  const hasSevereDimensions = oversizedAssets.some(
    (asset) =>
      asset.maxEdge > thresholds.maxTextureResolution * 1.5 ||
      asset.megapixels > thresholds.maxMegapixels * 1.5
  );
  const hasSeverePng = pngAssets.some((asset) => asset.maxEdge >= 2048 || asset.isOversized);
  const hasSeverePlaceables =
    walls.length > thresholds.maxWalls * 1.5 ||
    lights.length > thresholds.maxLights * 1.5 ||
    animationsCount > thresholds.maxAnimations * 1.5;

  if (hasSevereDimensions || hasSeverePng || hasSeverePlaceables) {
    severity = "critical";
  } else if (
    flags.hasUnoptimizedRaster ||
    flags.hasOversizedAsset ||
    flags.excessiveWalls ||
    flags.excessiveLights ||
    flags.excessiveAnimations ||
    flags.hasRedundantWalls
  ) {
    severity = "warning";
  }

  // Compute deterministic heaviness score for sorting worst offenders first
  const score =
    (maxAsset.megapixels || 0) * 3 +
    pngAssets.length * 18 +
    (unoptimizedAssets.length - pngAssets.length) * 8 +
    Math.max(0, walls.length - thresholds.maxWalls) * 0.2 +
    Math.max(0, lights.length - thresholds.maxLights) * 1.5 +
    Math.max(0, animationsCount - thresholds.maxAnimations) * 3 +
    redundantWallIds.length * 0.5;

  return {
    id: scene.id,
    uuid: scene.uuid ?? `Scene.${scene.id}`,
    name: scene.name || scene.id,
    active: Boolean(scene.active),
    levelsCount: Array.isArray(scene.levels) && scene.levels.length > 0 ? scene.levels.length : 1,
    tilesCount: Array.isArray(scene.tiles) ? scene.tiles.length : 0,
    tokensCount: tokens.length,
    soundsCount: sounds.length,
    regionsCount: regions.length,
    wallsCount: walls.length,
    doorsCount,
    redundantWallIds,
    zeroLengthWallIds: zeroLengthIds,
    duplicateWallIds: duplicateIds,
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
    maxResolution: {
      width: maxAsset.width,
      height: maxAsset.height,
      maxEdge: maxAsset.maxEdge,
      megapixels: maxAsset.megapixels
    },
    assets,
    pngCount: pngAssets.length,
    unoptimizedCount: unoptimizedAssets.length,
    oversizedCount: oversizedAssets.length,
    flags,
    severity,
    heavinessScore: Number(score.toFixed(1)),
    hasIssues: severity !== "ok"
  };
}

/**
 * Audit all scenes in a world and return sorted scene diagnostics plus aggregates.
 * @param {Array<Object>} scenes
 * @param {Map<string, Object>} assetMetaMap
 * @param {Partial<typeof DEFAULT_THRESHOLDS>} customThresholds
 * @returns {Object}
 */
export function auditScenes(scenes, assetMetaMap = new Map(), customThresholds = {}) {
  const results = (scenes ?? [])
    .map((scene) => analyzeScene(scene, assetMetaMap, customThresholds))
    .toSorted(
      (a, b) =>
        SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
        b.heavinessScore - a.heavinessScore ||
        a.name.localeCompare(b.name)
    );

  const heavyScenes = results.filter((scene) => scene.hasIssues);
  const convertibleAssets = results.flatMap((scene) =>
    scene.assets
      .filter((asset) => asset.canAutoConvert)
      .map((asset) => ({ ...asset, sceneId: scene.id, sceneName: scene.name }))
  );
  const pngAssets = convertibleAssets.filter((asset) => asset.isPng);
  const oversizedAssets = results.flatMap((scene) =>
    scene.assets
      .filter((asset) => asset.isOversized)
      .map((asset) => ({ ...asset, sceneId: scene.id, sceneName: scene.name }))
  );

  const redundantWallsTotal = results.reduce(
    (sum, scene) => sum + scene.redundantWallIds.length,
    0
  );

  return {
    totalScenes: results.length,
    heavyScenesCount: heavyScenes.length,
    criticalCount: results.filter((s) => s.severity === "critical").length,
    warningCount: results.filter((s) => s.severity === "warning").length,
    pngAssetsCount: pngAssets.length,
    unoptimizedAssetsCount: convertibleAssets.length,
    oversizedAssetsCount: oversizedAssets.length,
    redundantWallsTotal,
    totalWalls: results.reduce((sum, s) => sum + s.wallsCount, 0),
    totalLights: results.reduce((sum, s) => sum + s.lightsCount, 0),
    totalAnimations: results.reduce((sum, s) => sum + s.animationsCount, 0),
    items: results,
    convertibleAssets
  };
}
