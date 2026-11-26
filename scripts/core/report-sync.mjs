import { DEFAULT_THRESHOLDS, SEVERITY_ORDER } from "../constants.mjs";
import { buildAuditSummary, buildComparisonFromHistory } from "./report.mjs";
import { evaluateSceneMetrics, summarizeScenes } from "./scene-audit.mjs";
import { buildReportStatistics } from "./statistics.mjs";
import { summarizeFlagGroups, summarizeSettingsAudit } from "./storage-audit.mjs";
import { formatBytes } from "./utils.mjs";
import { summarizeUuidAudit } from "./uuid-audit.mjs";

function toIdSet(ids) {
  if (ids instanceof Set) return ids;
  if (typeof ids === "string") return ids ? new Set([ids]) : new Set();
  return new Set([...(ids ?? [])].filter(Boolean));
}

function getAllScenes(scenesSection) {
  if (Array.isArray(scenesSection?.allItems) && scenesSection.allItems.length) {
    return scenesSection.allItems;
  }
  return [...(scenesSection?.items ?? []), ...(scenesSection?.ignoredItems ?? [])];
}

/**
 * Recompute summary, statistics, and history comparison on an existing report after local mutations.
 * Does NOT alter `generatedAt` or append audit history entries.
 * @param {Object} report
 * @returns {Object}
 */
export function recomputeReportDerived(report) {
  if (!report || typeof report !== "object") return report;
  report.summary = buildAuditSummary({
    scenes: report.scenes,
    uuids: report.uuids,
    settings: report.settings,
    flags: report.flags,
    extras: report.extras
  });
  report.statistics = buildReportStatistics(report);
  const autoComparison = buildComparisonFromHistory(
    report.summary,
    report.statistics,
    report.history,
    report.generatedAt
  );
  if (autoComparison) report.comparison = autoComparison;
  else delete report.comparison;
  return report;
}

/**
 * Reconcile converted WebP scene/tile assets in-place without re-auditing the world.
 * @param {Object} report
 * @param {Array<{ sceneId: string, slotType?: string, levelId?: string | null, tileId?: string | null, oldSrc: string, newSrc: string, webpBytes?: number, width?: number, height?: number }>} changedSlots
 * @returns {Object}
 */
export function reconcileConvertedAssets(report, changedSlots = []) {
  if (!report?.scenes || !Array.isArray(changedSlots) || !changedSlots.length) return report;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(report.thresholds ?? {}) };
  const byScene = new Map();
  for (const slot of changedSlots) {
    if (!slot?.sceneId || !slot?.oldSrc || !slot?.newSrc) continue;
    if (!byScene.has(slot.sceneId)) byScene.set(slot.sceneId, []);
    byScene.get(slot.sceneId).push(slot);
  }
  if (!byScene.size) return report;

  const updatedScenes = getAllScenes(report.scenes).map((scene) => {
    const slots = byScene.get(scene.id);
    if (!slots) return scene;

    const nextAssets = (scene.assets ?? []).map((asset) => {
      const match =
        slots.find(
          (s) =>
            s.oldSrc === asset.src &&
            (!s.slotType || s.slotType === asset.slotType) &&
            (s.levelId ?? null) === (asset.levelId ?? null) &&
            (s.tileId ?? null) === (asset.tileId ?? null)
        ) ?? slots.find((s) => s.oldSrc === asset.src);
      if (!match) return asset;

      const width = Number(match.width) > 0 ? Number(match.width) : asset.width;
      const height = Number(match.height) > 0 ? Number(match.height) : asset.height;
      const maxEdge = Math.max(width || 0, height || 0);
      const megapixels =
        width > 0 && height > 0 ? Number(((width * height) / 1_000_000).toFixed(2)) : asset.megapixels;
      const byteSize = Number.isFinite(match.webpBytes) ? match.webpBytes : asset.byteSize;
      const isHeavyBytes =
        !asset.isMissing &&
        Number.isFinite(byteSize) &&
        Number(thresholds.maxAssetBytes) > 0 &&
        byteSize > Number(thresholds.maxAssetBytes);
      const isOversized =
        !asset.isVideo &&
        !asset.isMissing &&
        (maxEdge > thresholds.maxTextureResolution || megapixels > thresholds.maxMegapixels);

      return {
        ...asset,
        src: match.newSrc,
        ext: "webp",
        width,
        height,
        maxEdge,
        megapixels,
        byteSize,
        formattedByteSize: Number.isFinite(byteSize) && byteSize > 0 ? formatBytes(byteSize) : "",
        isHeavyBytes,
        isOversized,
        isPng: false,
        isWebp: true,
        isUnoptimizedRaster: false,
        canAutoConvert: false
      };
    });

    const nextScene = { ...scene, assets: nextAssets };
    return { ...nextScene, ...evaluateSceneMetrics(nextScene, thresholds) };
  });

  report.scenes = summarizeScenes(updatedScenes);
  return recomputeReportDerived(report);
}

/**
 * Reconcile removed wall segments (zero-length, exact-duplicate, or near-duplicate) locally.
 * @param {Object} report
 * @param {Array<{ sceneId: string, wallIds: string[] }>} sceneWallPairs
 * @returns {Object}
 */
export function reconcileCleanedWalls(report, sceneWallPairs = []) {
  if (!report?.scenes || !Array.isArray(sceneWallPairs) || !sceneWallPairs.length) return report;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(report.thresholds ?? {}) };
  const removedByScene = new Map();
  for (const pair of sceneWallPairs) {
    if (!pair?.sceneId || !pair?.wallIds?.length) continue;
    const set = removedByScene.get(pair.sceneId) ?? new Set();
    for (const id of pair.wallIds) if (id) set.add(id);
    if (set.size) removedByScene.set(pair.sceneId, set);
  }
  if (!removedByScene.size) return report;

  const updatedScenes = getAllScenes(report.scenes).map((scene) => {
    const removedSet = removedByScene.get(scene.id);
    if (!removedSet) return scene;

    const presentIds = new Set([
      ...(scene.redundantWallIds ?? []),
      ...(scene.nearDuplicateWallIds ?? [])
    ]);
    let actuallyRemoved = 0;
    for (const id of removedSet) {
      if (presentIds.has(id)) actuallyRemoved += 1;
    }
    const nextScene = {
      ...scene,
      wallsCount: Math.max(0, (Number(scene.wallsCount) || 0) - actuallyRemoved),
      redundantWallIds: (scene.redundantWallIds ?? []).filter((id) => !removedSet.has(id)),
      zeroLengthWallIds: (scene.zeroLengthWallIds ?? []).filter((id) => !removedSet.has(id)),
      duplicateWallIds: (scene.duplicateWallIds ?? []).filter((id) => !removedSet.has(id)),
      nearDuplicateWallIds: (scene.nearDuplicateWallIds ?? []).filter((id) => !removedSet.has(id))
    };
    return { ...nextScene, ...evaluateSceneMetrics(nextScene, thresholds) };
  });

  report.scenes = summarizeScenes(updatedScenes);
  return recomputeReportDerived(report);
}

/**
 * Reconcile removed orphaned tokens on one or more scenes locally.
 * @param {Object} report
 * @param {Array<{ sceneId: string, tokenIds: string[] }>} sceneTokenPairs
 * @returns {Object}
 */
export function reconcileCleanedTokens(report, sceneTokenPairs = []) {
  if (!report?.scenes || !Array.isArray(sceneTokenPairs) || !sceneTokenPairs.length) return report;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(report.thresholds ?? {}) };
  const removedByScene = new Map();
  for (const pair of sceneTokenPairs) {
    if (!pair?.sceneId || !pair?.tokenIds?.length) continue;
    const set = removedByScene.get(pair.sceneId) ?? new Set();
    for (const id of pair.tokenIds) if (id) set.add(id);
    if (set.size) removedByScene.set(pair.sceneId, set);
  }
  if (!removedByScene.size) return report;

  const updatedScenes = getAllScenes(report.scenes).map((scene) => {
    const removedSet = removedByScene.get(scene.id);
    if (!removedSet) return scene;

    const nextOrphans = (scene.orphanedTokenIds ?? []).filter((id) => !removedSet.has(id));
    const removedCount = (scene.orphanedTokenIds?.length ?? 0) - nextOrphans.length;
    const nextScene = {
      ...scene,
      tokensCount: Math.max(0, (Number(scene.tokensCount) || 0) - removedCount),
      orphanedTokenIds: nextOrphans
    };
    return { ...nextScene, ...evaluateSceneMetrics(nextScene, thresholds) };
  });

  report.scenes = summarizeScenes(updatedScenes);
  return recomputeReportDerived(report);
}

/**
 * Reconcile disabled ambient light animations on one or more scenes locally.
 * @param {Object} report
 * @param {Array<{ sceneId: string, lightIds: string[] }>} sceneLightPairs
 * @returns {Object}
 */
export function reconcileDisabledLightAnims(report, sceneLightPairs = []) {
  if (!report?.scenes || !Array.isArray(sceneLightPairs) || !sceneLightPairs.length) return report;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(report.thresholds ?? {}) };
  const clearedByScene = new Map();
  for (const pair of sceneLightPairs) {
    if (!pair?.sceneId || !pair?.lightIds?.length) continue;
    const set = clearedByScene.get(pair.sceneId) ?? new Set();
    for (const id of pair.lightIds) if (id) set.add(id);
    if (set.size) clearedByScene.set(pair.sceneId, set);
  }
  if (!clearedByScene.size) return report;

  const updatedScenes = getAllScenes(report.scenes).map((scene) => {
    const clearedSet = clearedByScene.get(scene.id);
    if (!clearedSet) return scene;

    const nextAnimated = (scene.animatedLightIds ?? []).filter((id) => !clearedSet.has(id));
    const clearedCount = (scene.animatedLightIds?.length ?? 0) - nextAnimated.length;
    const nextBreakdown = scene.animationBreakdown
      ? {
          ...scene.animationBreakdown,
          animatedLights: Math.max(
            0,
            (Number(scene.animationBreakdown.animatedLights) || 0) - clearedCount
          )
        }
      : undefined;
    const nextScene = {
      ...scene,
      animatedLightIds: nextAnimated,
      animationsCount: Math.max(0, (Number(scene.animationsCount) || 0) - clearedCount),
      ...(nextBreakdown ? { animationBreakdown: nextBreakdown } : {})
    };
    return { ...nextScene, ...evaluateSceneMetrics(nextScene, thresholds) };
  });

  report.scenes = summarizeScenes(updatedScenes);
  return recomputeReportDerived(report);
}

/**
 * Reconcile ignore/unignore state for one or more scenes locally.
 * @param {Object} report
 * @param {string | string[]} sceneIds
 * @param {boolean} isIgnored
 * @returns {Object}
 */
export function reconcileSceneIgnore(report, sceneIds, isIgnored) {
  const idSet = toIdSet(sceneIds);
  if (!report?.scenes || !idSet.size) return report;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(report.thresholds ?? {}) };
  const updatedScenes = getAllScenes(report.scenes).map((scene) => {
    if (!idSet.has(scene.id)) return scene;
    const nextScene = { ...scene, isIgnored: Boolean(isIgnored) };
    return { ...nextScene, ...evaluateSceneMetrics(nextScene, thresholds) };
  });
  report.scenes = summarizeScenes(updatedScenes);
  return recomputeReportDerived(report);
}

/**
 * Reconcile replaced or unlinked @UUID occurrences locally.
 * @param {Object} report
 * @param {string | string[]} occurrenceIds
 * @returns {Object}
 */
export function reconcileResolvedUuids(report, occurrenceIds) {
  const idSet = toIdSet(occurrenceIds);
  if (!report?.uuids || !idSet.size) return report;
  const nextBroken = (report.uuids.items ?? []).filter((item) => !idSet.has(item.id));
  const nextIgnored = (report.uuids.ignoredItems ?? []).filter((item) => !idSet.has(item.id));
  report.uuids = summarizeUuidAudit(
    nextBroken,
    nextIgnored,
    report.uuids.totalScanned ?? 0,
    report.uuids.minAutoConfidence ?? report.thresholds?.uuidMinAutoConfidence ?? 1.0
  );
  return recomputeReportDerived(report);
}

/**
 * Reconcile ignore/unignore state for one or more @UUID occurrences locally.
 * @param {Object} report
 * @param {string | string[]} occurrenceIds
 * @param {boolean} isIgnored
 * @returns {Object}
 */
export function reconcileUuidIgnore(report, occurrenceIds, isIgnored) {
  const idSet = toIdSet(occurrenceIds);
  if (!report?.uuids || !idSet.size) return report;
  const all = [...(report.uuids.items ?? []), ...(report.uuids.ignoredItems ?? [])].map((item) =>
    idSet.has(item.id) ? { ...item, isIgnored: Boolean(isIgnored) } : item
  );
  const broken = all.filter((item) => !item.isIgnored);
  const ignored = all.filter((item) => item.isIgnored);
  report.uuids = summarizeUuidAudit(
    broken,
    ignored,
    report.uuids.totalScanned ?? 0,
    report.uuids.minAutoConfidence ?? report.thresholds?.uuidMinAutoConfidence ?? 1.0
  );
  return recomputeReportDerived(report);
}

function summarizePartialSettingsFallback(settings, nextItems, nextIgnored, removedKeysSet) {
  const removedFromVisible = [
    ...(settings.items ?? []),
    ...(settings.ignoredItems ?? [])
  ].filter((item) => removedKeysSet.has(item.key));

  const removedCount = removedFromVisible.length;
  const removedBytes = removedFromVisible.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0);
  const totalBytes = Math.max(0, (Number(settings.totalBytes) || 0) - removedBytes);
  const totalSettingsCount = Math.max(
    nextItems.length + nextIgnored.length,
    (Number(settings.totalSettingsCount) || 0) - removedCount
  );

  const removedByNs = new Map();
  for (const item of removedFromVisible) {
    const prev = removedByNs.get(item.namespace) ?? { count: 0, bytes: 0 };
    prev.count += 1;
    prev.bytes += Number(item.bytes) || 0;
    removedByNs.set(item.namespace, prev);
  }

  const byNamespace = (settings.byNamespace ?? [])
    .map((ns) => {
      const rem = removedByNs.get(ns.namespace);
      const count = rem ? Math.max(0, (Number(ns.count) || 0) - rem.count) : Number(ns.count) || 0;
      const bytes = rem ? Math.max(0, (Number(ns.bytes) || 0) - rem.bytes) : Number(ns.bytes) || 0;
      return {
        ...ns,
        count,
        bytes,
        formattedSize: formatBytes(bytes),
        sharePercent: totalBytes > 0 ? Number(((bytes / totalBytes) * 100).toFixed(1)) : 0
      };
    })
    .filter((ns) => ns.count > 0 || ns.bytes > 0)
    .toSorted((a, b) => b.bytes - a.bytes);

  const sortFlagged = (list) =>
    [...list].toSorted(
      (a, b) =>
        (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0) ||
        (Number(b.bytes) || 0) - (Number(a.bytes) || 0) ||
        a.key.localeCompare(b.key)
    );
  const sortedItems = sortFlagged(nextItems);
  const sortedIgnored = [...nextIgnored].toSorted(
    (a, b) => (Number(b.bytes) || 0) - (Number(a.bytes) || 0) || a.key.localeCompare(b.key)
  );
  const orphanedItems = sortedItems.filter((i) => i.isOrphaned || i.status === "orphaned");

  return {
    ...settings,
    totalSettingsCount,
    totalBytes,
    formattedTotalSize: formatBytes(totalBytes),
    flaggedCount: sortedItems.length,
    bloatedCount: sortedItems.filter((i) => i.isBloated).length,
    orphanedCount: orphanedItems.length,
    orphanedBytes: orphanedItems.reduce((sum, i) => sum + (Number(i.bytes) || 0), 0),
    inactiveCount: sortedItems.filter((i) => i.isInactive || i.status === "inactive").length,
    ignoredCount: sortedIgnored.length,
    ignoredItems: sortedIgnored,
    items: sortedItems,
    byNamespace
  };
}

/**
 * Reconcile deleted world settings locally.
 * @param {Object} report
 * @param {string | string[]} keys
 * @returns {Object}
 */
export function reconcileDeletedSettings(report, keys) {
  const keySet = toIdSet(keys);
  if (!report?.settings || !keySet.size) return report;

  if (Array.isArray(report.settings.allItems) && report.settings.allItems.length) {
    const remainingAll = report.settings.allItems.filter((item) => !keySet.has(item.key));
    report.settings = summarizeSettingsAudit(remainingAll);
  } else {
    const nextItems = (report.settings.items ?? []).filter((item) => !keySet.has(item.key));
    const nextIgnored = (report.settings.ignoredItems ?? []).filter((item) => !keySet.has(item.key));
    report.settings = summarizePartialSettingsFallback(report.settings, nextItems, nextIgnored, keySet);
  }
  return recomputeReportDerived(report);
}

/**
 * Reconcile ignore/unignore state for one or more world settings locally.
 * @param {Object} report
 * @param {string | string[]} keys
 * @param {boolean} isIgnored
 * @returns {Object}
 */
export function reconcileSettingIgnore(report, keys, isIgnored) {
  const keySet = toIdSet(keys);
  if (!report?.settings || !keySet.size) return report;

  if (Array.isArray(report.settings.allItems) && report.settings.allItems.length) {
    const updatedAll = report.settings.allItems.map((item) =>
      keySet.has(item.key) ? { ...item, isIgnored: Boolean(isIgnored) } : item
    );
    report.settings = summarizeSettingsAudit(updatedAll);
  } else {
    const combined = [...(report.settings.items ?? []), ...(report.settings.ignoredItems ?? [])].map((item) =>
      keySet.has(item.key) ? { ...item, isIgnored: Boolean(isIgnored) } : item
    );
    const nextItems = combined.filter((item) => !item.isIgnored);
    const nextIgnored = combined.filter((item) => item.isIgnored);
    report.settings = summarizePartialSettingsFallback(
      report.settings,
      nextItems,
      nextIgnored,
      new Set()
    );
  }
  return recomputeReportDerived(report);
}

/**
 * Reconcile deleted document flag groups locally.
 * @param {Object} report
 * @param {string | string[]} groupIds
 * @returns {Object}
 */
export function reconcileDeletedFlagGroups(report, groupIds) {
  const idSet = toIdSet(groupIds);
  if (!report?.flags || !idSet.size) return report;
  const nextGroups = (report.flags.groups ?? []).filter((g) => !idSet.has(g.id));
  const nextIgnored = (report.flags.ignoredGroups ?? []).filter((g) => !idSet.has(g.id));
  report.flags = summarizeFlagGroups(nextGroups, nextIgnored);
  return recomputeReportDerived(report);
}

/**
 * Reconcile deletion of a single document's flag namespace inside a flag group locally.
 * @param {Object} report
 * @param {string} groupId
 * @param {string} docUuid
 * @returns {Object}
 */
export function reconcileDeletedFlagTarget(report, groupId, docUuid) {
  if (!report?.flags || !groupId || !docUuid) return report;
  const updateList = (groups) =>
    (groups ?? [])
      .map((grp) => {
        if (grp.id !== groupId) return grp;
        const targets = (grp.targets ?? []).filter((t) => t.docUuid !== docUuid);
        if (!targets.length) return null;
        const bytes = targets.reduce((sum, t) => sum + (Number(t.bytes) || 0), 0);
        const maxSeverity = targets.reduce(
          (best, t) => (SEVERITY_ORDER[t.severity] > SEVERITY_ORDER[best] ? t.severity : best),
          "info"
        );
        return {
          ...grp,
          docCount: targets.length,
          docTypes: [...new Set(targets.map((t) => t.docType))].sort(),
          bytes,
          formattedSize: formatBytes(bytes),
          severity: maxSeverity,
          isBloated: targets.some((t) => t.isBloated),
          targets
        };
      })
      .filter(Boolean);

  report.flags = summarizeFlagGroups(
    updateList(report.flags.groups),
    updateList(report.flags.ignoredGroups)
  );
  return recomputeReportDerived(report);
}

/**
 * Reconcile ignore/unignore state for one or more flag namespaces locally.
 * @param {Object} report
 * @param {string | string[]} namespaces
 * @param {boolean} isIgnored
 * @returns {Object}
 */
export function reconcileFlagIgnore(report, namespaces, isIgnored) {
  const nsSet = toIdSet(namespaces);
  if (!report?.flags || !nsSet.size) return report;
  const allGroups = [...(report.flags.groups ?? []), ...(report.flags.ignoredGroups ?? [])].map((grp) => {
    if (!nsSet.has(grp.namespace)) return grp;
    const ignoredBool = Boolean(isIgnored);
    return {
      ...grp,
      isIgnored: ignoredBool,
      targets: (grp.targets ?? []).map((t) => ({ ...t, isIgnored: ignoredBool }))
    };
  });
  const activeGroups = allGroups.filter((g) => !g.isIgnored);
  const ignoredGroups = allGroups.filter((g) => g.isIgnored);
  report.flags = summarizeFlagGroups(activeGroups, ignoredGroups);
  return recomputeReportDerived(report);
}

/**
 * Reconcile pruned chat messages locally.
 * @param {Object} report
 * @param {{ deletedCount: number }} info
 * @returns {Object}
 */
export function reconcileChatPruned(report, { deletedCount = 0 } = {}) {
  if (!report?.extras) return report;
  const oldCount = Number(report.extras.chatMessagesCount) || 0;
  const nextCount = Math.max(0, oldCount - (Number(deletedCount) || 0));
  const ratio = oldCount > 0 ? nextCount / oldCount : 0;
  const nextBytes = Math.round((Number(report.extras.chatBytes) || 0) * ratio);
  const maxChat = Number(report.extras.maxChatMessages) || DEFAULT_THRESHOLDS.maxChatMessages;

  let chatSeverity = "ok";
  if (nextCount > maxChat * 3) chatSeverity = "critical";
  else if (nextCount > maxChat) chatSeverity = "warning";

  report.extras = {
    ...report.extras,
    chatMessagesCount: nextCount,
    chatBytes: nextBytes,
    formattedChatBytes: formatBytes(nextBytes),
    chatSeverity,
    chatBloated: nextCount > maxChat
  };
  return recomputeReportDerived(report);
}

/**
 * Reconcile cleaned stale combat encounters locally.
 * @param {Object} report
 * @param {string[]} deletedCombatIds
 * @returns {Object}
 */
export function reconcileCombatsCleaned(report, deletedCombatIds = []) {
  const idSet = toIdSet(deletedCombatIds);
  if (!report?.extras || !idSet.size) return report;
  const oldStale = report.extras.staleCombats ?? [];
  const nextStale = oldStale.filter((c) => !idSet.has(c.id));
  const removedCount = oldStale.length - nextStale.length;
  report.extras = {
    ...report.extras,
    staleCombats: nextStale,
    staleCombatsCount: nextStale.length,
    combatsCount: Math.max(nextStale.length, (Number(report.extras.combatsCount) || 0) - removedCount)
  };
  return recomputeReportDerived(report);
}
