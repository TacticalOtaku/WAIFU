import { formatBytes } from "./utils.mjs";

const EMPTY_DIST = Object.freeze({
  count: 0,
  min: 0,
  avg: 0,
  median: 0,
  p95: 0,
  max: 0,
  total: 0
});

/**
 * Compute summary distribution statistics (min, avg, median, p95, max, total) for numeric samples.
 * @param {number[]} values
 * @param {number} decimals
 * @returns {{ count: number, min: number, avg: number, median: number, p95: number, max: number, total: number }}
 */
export function computeNumericDistribution(values, decimals = 1) {
  const clean = (values ?? [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .toSorted((a, b) => a - b);

  if (!clean.length) return { ...EMPTY_DIST };

  const factor = 10 ** decimals;
  const round = (n) => Math.round(n * factor) / factor;

  const total = clean.reduce((sum, n) => sum + n, 0);
  const mid = Math.floor(clean.length / 2);
  const median =
    clean.length % 2 === 1 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
  const p95Idx = Math.min(clean.length - 1, Math.max(0, Math.ceil(clean.length * 0.95) - 1));

  return {
    count: clean.length,
    min: round(clean[0]),
    avg: round(total / clean.length),
    median: round(median),
    p95: round(clean[p95Idx]),
    max: round(clean[clean.length - 1]),
    total: round(total)
  };
}

function pct(part, total) {
  if (!total || total <= 0) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

/**
 * Compute exact health score penalty contributions per diagnostic area, matching buildAuditSummary.
 * @param {Object} report
 * @returns {Object}
 */
export function computeScoreBreakdown(report) {
  const scenes = report?.scenes ?? {};
  const uuids = report?.uuids ?? {};
  const settings = report?.settings ?? {};
  const flags = report?.flags ?? {};
  const summary = report?.summary ?? {};

  const scenesPenalty =
    (Number(scenes.criticalCount) || 0) * 14 + (Number(scenes.warningCount) || 0) * 5;
  const mediaPenalty = Math.min(25, (Number(scenes.pngAssetsCount) || 0) * 3);
  const uuidsPenalty = Math.min(35, (Number(uuids.brokenCount) || 0) * 3);
  const settingsPenalty = Math.min(
    18,
    (Number(settings.bloatedCount) || 0) * 4 + (Number(settings.orphanedCount) || 0) * 2
  );
  const flagsPenalty = Math.min(
    20,
    (Number(flags.orphanedNamespacesCount) || 0) * 4 +
      (Number(flags.bloatedEntriesCount) || 0) * 3
  );

  const rawPenalty =
    scenesPenalty + mediaPenalty + uuidsPenalty + settingsPenalty + flagsPenalty;
  const healthScore =
    Number.isFinite(summary.healthScore)
      ? summary.healthScore
      : Math.max(0, Math.min(100, Math.round(100 - rawPenalty)));

  return {
    healthScore,
    totalDeduction: Math.max(0, 100 - healthScore),
    rawPenalty,
    capped: rawPenalty > 100,
    categories: [
      { id: "scenes", penalty: scenesPenalty, sharePercent: pct(scenesPenalty, rawPenalty) },
      { id: "media", penalty: mediaPenalty, sharePercent: pct(mediaPenalty, rawPenalty) },
      { id: "uuids", penalty: uuidsPenalty, sharePercent: pct(uuidsPenalty, rawPenalty) },
      { id: "settings", penalty: settingsPenalty, sharePercent: pct(settingsPenalty, rawPenalty) },
      { id: "flags", penalty: flagsPenalty, sharePercent: pct(flagsPenalty, rawPenalty) }
    ]
  };
}

/**
 * Build comprehensive, defensive statistics across all audited world domains for charts and reports.
 * @param {Object} report
 * @returns {Object}
 */
export function buildReportStatistics(report) {
  const scenes = report?.scenes ?? {};
  const uuids = report?.uuids ?? {};
  const settings = report?.settings ?? {};
  const flags = report?.flags ?? {};
  const summary = report?.summary ?? {};

  const sceneItems = Array.isArray(scenes.items) ? scenes.items : [];
  const uuidItems = Array.isArray(uuids.items) ? uuids.items : [];
  const settingItems = Array.isArray(settings.items) ? settings.items : [];
  const allSettingItems = Array.isArray(settings.allItems) && settings.allItems.length
    ? settings.allItems
    : settingItems;
  const flagGroups = Array.isArray(flags.groups) ? flags.groups : [];
  const flagEntries = Array.isArray(flags.items) ? flags.items : [];

  // ── 1. Scenes & Media Statistics ────────────────────────────────────────
  const totalScenes = Number(scenes.totalScenes) || sceneItems.length;
  const criticalScenes = Number(scenes.criticalCount) || sceneItems.filter((s) => s.severity === "critical").length;
  const warningScenes = Number(scenes.warningCount) || sceneItems.filter((s) => s.severity === "warning").length;
  const healthyScenes = Math.max(0, totalScenes - criticalScenes - warningScenes);

  // Deduplicate assets across slots per scene or aggregate directly from scene.assets
  const allAssets = sceneItems.flatMap((s) => (Array.isArray(s.assets) ? s.assets : []));
  let webpCount = 0;
  let pngCount = 0;
  let otherRasterCount = 0;
  let videoCount = 0;
  let otherFormatCount = 0;
  let knownImageBytes = 0;
  let unoptimizedKnownBytes = 0;

  if (allAssets.length > 0) {
    for (const asset of allAssets) {
      if (asset.isWebp) webpCount += 1;
      else if (asset.isPng) pngCount += 1;
      else if (asset.isUnoptimizedRaster) otherRasterCount += 1;
      else if (asset.isVideo) videoCount += 1;
      else otherFormatCount += 1;

      if (Number.isFinite(asset.byteSize) && asset.byteSize > 0) {
        knownImageBytes += asset.byteSize;
        if (asset.isUnoptimizedRaster) unoptimizedKnownBytes += asset.byteSize;
      }
    }
  } else {
    // Fallback when report came from minimal fixture without scene.assets arrays
    pngCount = Number(scenes.pngAssetsCount) || 0;
    otherRasterCount = Math.max(0, (Number(scenes.unoptimizedAssetsCount) || 0) - pngCount);
  }

  const totalAssets = webpCount + pngCount + otherRasterCount + videoCount + otherFormatCount;
  const rasterAssetsCount = webpCount + pngCount + otherRasterCount;

  const megapixelsDist = computeNumericDistribution(
    sceneItems.map((s) => s.maxResolution?.megapixels ?? 0).filter((v) => v > 0),
    2
  );
  const wallsDist = computeNumericDistribution(sceneItems.map((s) => s.wallsCount ?? 0), 1);
  const lightsDist = computeNumericDistribution(sceneItems.map((s) => s.lightsCount ?? 0), 1);
  const animationsDist = computeNumericDistribution(
    sceneItems.map((s) => s.animationsCount ?? 0),
    1
  );

  const animationSources = {
    animatedLights: 0,
    animatedTokens: 0,
    videoTiles: 0,
    videoLevelAssets: 0,
    videoDrawings: 0,
    weatherScenes: 0
  };
  let totalLevels = 0;
  let totalTiles = 0;
  let totalTokens = 0;
  let totalDoors = 0;
  let totalSounds = 0;
  let totalRegions = 0;
  let zeroLengthWalls = 0;
  let duplicateWalls = 0;

  const thresholdCounts = {
    oversized: 0,
    hasPng: 0,
    excessiveWalls: 0,
    excessiveLights: 0,
    excessiveAnimations: 0,
    redundantWalls: 0
  };

  for (const s of sceneItems) {
    totalLevels += Number(s.levelsCount) || 1;
    totalTiles += Number(s.tilesCount) || 0;
    totalTokens += Number(s.tokensCount) || 0;
    totalDoors += Number(s.doorsCount) || 0;
    totalSounds += Number(s.soundsCount) || 0;
    totalRegions += Number(s.regionsCount) || 0;
    zeroLengthWalls += Array.isArray(s.zeroLengthWallIds) ? s.zeroLengthWallIds.length : 0;
    duplicateWalls += Array.isArray(s.duplicateWallIds) ? s.duplicateWallIds.length : 0;

    const ab = s.animationBreakdown ?? {};
    animationSources.animatedLights += Number(ab.animatedLights) || 0;
    animationSources.animatedTokens += Number(ab.animatedTokens) || 0;
    animationSources.videoTiles += Number(ab.videoTiles) || 0;
    animationSources.videoLevelAssets += Number(ab.videoLevelAssets) || 0;
    animationSources.videoDrawings += Number(ab.videoDrawings) || 0;
    animationSources.weatherScenes += Number(ab.weather) || 0;

    const fl = s.flags ?? {};
    if (fl.hasOversizedAsset || (s.oversizedCount ?? 0) > 0) thresholdCounts.oversized += 1;
    if (fl.hasPng || (s.pngCount ?? 0) > 0) thresholdCounts.hasPng += 1;
    if (fl.excessiveWalls) thresholdCounts.excessiveWalls += 1;
    if (fl.excessiveLights) thresholdCounts.excessiveLights += 1;
    if (fl.excessiveAnimations) thresholdCounts.excessiveAnimations += 1;
    if (fl.hasRedundantWalls || (s.redundantWallIds?.length ?? 0) > 0) {
      thresholdCounts.redundantWalls += 1;
    }
  }

  const topHeavyScenes = sceneItems.slice(0, 8).map((s) => ({
    id: s.id,
    name: s.name,
    severity: s.severity || "ok",
    heavinessScore: Number(s.heavinessScore) || 0,
    megapixels: Number(s.maxResolution?.megapixels) || 0,
    width: Number(s.maxResolution?.width) || 0,
    height: Number(s.maxResolution?.height) || 0,
    wallsCount: Number(s.wallsCount) || 0,
    lightsCount: Number(s.lightsCount) || 0,
    animationsCount: Number(s.animationsCount) || 0,
    pngCount: Number(s.pngCount) || 0,
    redundantWallsCount: Array.isArray(s.redundantWallIds) ? s.redundantWallIds.length : 0
  }));

  const sceneStats = {
    totalScenes,
    ignoredCount: Number(scenes.ignoredCount) || 0,
    healthyScenes,
    warningScenes,
    criticalScenes,
    healthyPercent: totalScenes > 0 ? pct(healthyScenes, totalScenes) : 100,
    heavyScenesCount: Number(scenes.heavyScenesCount) || criticalScenes + warningScenes,
    missingMediaTotal: Number(scenes.missingMediaTotal) || 0,
    heavyBytesAssetsTotal: Number(scenes.heavyBytesAssetsTotal) || 0,
    nearDuplicateWallsTotal: Number(scenes.nearDuplicateWallsTotal) || 0,
    orphanedTokensTotal: Number(scenes.orphanedTokensTotal) || 0,
    assetFormats: {
      totalAssets,
      rasterAssetsCount,
      webp: webpCount,
      png: pngCount,
      otherRaster: otherRasterCount,
      video: videoCount,
      other: otherFormatCount,
      webpPercent: pct(webpCount, totalAssets),
      webpRasterPercent: rasterAssetsCount > 0 ? pct(webpCount, rasterAssetsCount) : 100,
      pngPercent: pct(pngCount, totalAssets),
      otherRasterPercent: pct(otherRasterCount, totalAssets),
      videoPercent: pct(videoCount, totalAssets),
      knownImageBytes,
      formattedKnownImageBytes: formatBytes(knownImageBytes),
      unoptimizedKnownBytes,
      formattedUnoptimizedBytes: formatBytes(unoptimizedKnownBytes)
    },
    distributions: {
      megapixels: megapixelsDist,
      walls: wallsDist,
      lights: lightsDist,
      animations: animationsDist
    },
    animationSources,
    geometryTotals: {
      totalLevels,
      totalTiles,
      totalTokens,
      totalDoors,
      totalSounds,
      totalRegions,
      totalWalls: Number(scenes.totalWalls) || wallsDist.total,
      totalLights: Number(scenes.totalLights) || lightsDist.total,
      totalAnimations: Number(scenes.totalAnimations) || animationsDist.total,
      zeroLengthWalls,
      duplicateWalls,
      redundantWallsTotal: Number(scenes.redundantWallsTotal) || zeroLengthWalls + duplicateWalls
    },
    thresholdCounts,
    topHeavyScenes
  };

  // ── 2. @UUID Reference Integrity Statistics ─────────────────────────────
  const totalScanned = Number(uuids.totalScanned) || 0;
  const brokenCount = Number(uuids.brokenCount) || uuidItems.length;
  const validCount = Math.max(0, totalScanned - brokenCount);
  const exactCount = Number(uuids.exactMatchCount) || 0;
  const withCandidateCount = Number(uuids.withCandidateCount) || 0;
  const fuzzyCount = Math.max(0, withCandidateCount - exactCount);
  const unmatchedCount = Math.max(0, brokenCount - withCandidateCount);

  const byReason = {
    "missing-document": 0,
    "missing-pack": 0,
    "missing-embedded": 0,
    "missing-anchor": 0,
    malformed: 0
  };
  const bySyntax = {
    enricher: 0,
    "html-link": 0,
    "bare-uuid": 0,
    "from-uuid": 0
  };
  const docTypeCounts = new Map();
  const rootDocCounts = new Map();

  for (const item of uuidItems) {
    if (item.reason && Object.hasOwn(byReason, item.reason)) {
      byReason[item.reason] += 1;
    } else if (item.reason) {
      byReason[item.reason] = (byReason[item.reason] ?? 0) + 1;
    }
    if (item.syntax && Object.hasOwn(bySyntax, item.syntax)) {
      bySyntax[item.syntax] += 1;
    } else if (item.syntax) {
      bySyntax[item.syntax] = (bySyntax[item.syntax] ?? 0) + 1;
    }

    const tType = item.targetDocType || "Unknown";
    docTypeCounts.set(tType, (docTypeCounts.get(tType) ?? 0) + 1);

    const rootKey = item.rootUuid || item.rootDocName || item.id;
    const prev = rootDocCounts.get(rootKey) ?? {
      rootUuid: item.rootUuid || "",
      rootDocName: item.rootDocName || "Document",
      rootDocType: item.rootDocType || "",
      count: 0,
      exactCount: 0,
      criticalCount: 0
    };
    prev.count += 1;
    if (item.bestCandidate?.confidence === "exact") prev.exactCount += 1;
    if (item.severity === "critical") prev.criticalCount += 1;
    rootDocCounts.set(rootKey, prev);
  }

  const byTargetDocType = [...docTypeCounts.entries()]
    .map(([docType, count]) => ({
      docType,
      count,
      percent: pct(count, brokenCount)
    }))
    .toSorted((a, b) => b.count - a.count || a.docType.localeCompare(b.docType));

  const topOffendingDocs = [...rootDocCounts.values()]
    .toSorted((a, b) => b.count - a.count || a.rootDocName.localeCompare(b.rootDocName))
    .slice(0, 8);

  const uuidStats = {
    totalScanned,
    validCount,
    brokenCount,
    ignoredCount: Number(uuids.ignoredCount) || 0,
    validPercent: totalScanned > 0 ? pct(validCount, totalScanned) : 100,
    brokenPercent: totalScanned > 0 ? pct(brokenCount, totalScanned) : 0,
    byCategory: {
      journal: Number(uuids.journalCount) || 0,
      loreframe: Number(uuids.loreframeCount) || 0,
      actor: Number(uuids.actorCount) || 0,
      other: Number(uuids.otherDocsCount) || 0
    },
    byFixability: {
      exact: exactCount,
      fuzzy: fuzzyCount,
      unmatched: unmatchedCount,
      exactPercent: pct(exactCount, brokenCount),
      fuzzyPercent: pct(fuzzyCount, brokenCount),
      unmatchedPercent: pct(unmatchedCount, brokenCount)
    },
    byReason,
    bySyntax,
    byTargetDocType,
    topOffendingDocs
  };

  // ── 3. Storage & Document Flags Statistics ──────────────────────────────
  const totalSettingsBytes = Number(settings.totalBytes) || 0;
  const totalFlagsBytes = flagGroups.reduce((sum, g) => sum + (Number(g.bytes) || 0), 0);
  const totalTrackedBytes = totalSettingsBytes + totalFlagsBytes;
  const reclaimableSettingsBytes = Number(settings.orphanedBytes) || 0;
  const reclaimableFlagsBytes =
    Number(flags.orphanedBytes) ||
    flagGroups
      .filter((g) => g.isOrphaned || g.status === "orphaned")
      .reduce((sum, g) => sum + (Number(g.bytes) || 0), 0);
  const totalReclaimableBytes = reclaimableSettingsBytes + reclaimableFlagsBytes;

  const settingsByStateMap = {
    core: { state: "core", count: 0, bytes: 0 },
    active: { state: "active", count: 0, bytes: 0 },
    inactive: { state: "inactive", count: 0, bytes: 0 },
    orphaned: { state: "orphaned", count: 0, bytes: 0 }
  };

  for (const st of allSettingItems) {
    const state =
      st.moduleState && Object.hasOwn(settingsByStateMap, st.moduleState)
        ? st.moduleState
        : st.isOrphaned || st.status === "orphaned"
          ? "orphaned"
          : st.isInactive || st.status === "inactive"
            ? "inactive"
            : "active";
    settingsByStateMap[state].count += 1;
    settingsByStateMap[state].bytes += Number(st.bytes) || 0;
  }

  // Fallback when settings.allItems wasn't populated (e.g., partial report fixture)
  const measuredSettingsSum = Object.values(settingsByStateMap).reduce((s, r) => s + r.bytes, 0);
  if (totalSettingsBytes > measuredSettingsSum && allSettingItems === settingItems) {
    const diff = totalSettingsBytes - measuredSettingsSum;
    settingsByStateMap.active.bytes += diff;
    const extraCount = Math.max(0, (Number(settings.totalSettingsCount) || 0) - allSettingItems.length);
    settingsByStateMap.active.count += extraCount;
  }

  const settingsByState = Object.values(settingsByStateMap).map((row) => ({
    ...row,
    formattedSize: formatBytes(row.bytes),
    percent: pct(row.bytes, Math.max(totalSettingsBytes, measuredSettingsSum))
  }));

  const flagsByStatusMap = {
    orphaned: { status: "orphaned", groupsCount: 0, docsCount: 0, bytes: 0 },
    inactive: { status: "inactive", groupsCount: 0, docsCount: 0, bytes: 0 },
    bloated: { status: "bloated", groupsCount: 0, docsCount: 0, bytes: 0 }
  };

  for (const grp of flagGroups) {
    const key = Object.hasOwn(flagsByStatusMap, grp.status) ? grp.status : "bloated";
    flagsByStatusMap[key].groupsCount += 1;
    flagsByStatusMap[key].docsCount += Number(grp.docCount) || 0;
    flagsByStatusMap[key].bytes += Number(grp.bytes) || 0;
  }

  const flagsByStatus = Object.values(flagsByStatusMap).map((row) => ({
    ...row,
    formattedSize: formatBytes(row.bytes),
    percent: pct(row.bytes, totalFlagsBytes)
  }));

  const flagDocTypeMap = new Map();
  if (flagEntries.length > 0) {
    for (const entry of flagEntries) {
      const dt = entry.docType || "Document";
      const cur = flagDocTypeMap.get(dt) ?? { docType: dt, count: 0, bytes: 0 };
      cur.count += 1;
      cur.bytes += Number(entry.bytes) || 0;
      flagDocTypeMap.set(dt, cur);
    }
  } else {
    for (const grp of flagGroups) {
      for (const dt of grp.docTypes ?? []) {
        const cur = flagDocTypeMap.get(dt) ?? { docType: dt, count: 0, bytes: 0 };
        cur.count += Number(grp.docCount) || 1;
        cur.bytes += Number(grp.bytes) || 0;
        flagDocTypeMap.set(dt, cur);
      }
    }
  }

  const flagsByDocType = [...flagDocTypeMap.values()]
    .map((row) => ({
      ...row,
      formattedSize: formatBytes(row.bytes),
      percent: pct(row.bytes, totalFlagsBytes)
    }))
    .toSorted((a, b) => b.bytes - a.bytes || b.count - a.count);

  // Combined Namespace Footprint (World Settings + Flag Groups)
  const nsMap = new Map();
  const settingsNsSource =
    Array.isArray(settings.byNamespace) && settings.byNamespace.length
      ? settings.byNamespace
      : allSettingItems.map((i) => ({
          namespace: i.namespace,
          moduleState: i.moduleState || (i.isOrphaned ? "orphaned" : i.isInactive ? "inactive" : "active"),
          count: 1,
          bytes: Number(i.bytes) || 0
        }));

  for (const ns of settingsNsSource) {
    if (!ns?.namespace) continue;
    const cur = nsMap.get(ns.namespace) ?? {
      namespace: ns.namespace,
      moduleState: ns.moduleState || "active",
      settingsCount: 0,
      settingsBytes: 0,
      flagDocsCount: 0,
      flagsBytes: 0
    };
    cur.settingsCount += Number(ns.count) || 0;
    cur.settingsBytes += Number(ns.bytes) || 0;
    if (ns.moduleState) cur.moduleState = ns.moduleState;
    nsMap.set(ns.namespace, cur);
  }

  for (const grp of flagGroups) {
    if (!grp?.namespace) continue;
    const cur = nsMap.get(grp.namespace) ?? {
      namespace: grp.namespace,
      moduleState: grp.moduleState || (grp.isOrphaned ? "orphaned" : grp.isInactive ? "inactive" : "active"),
      settingsCount: 0,
      settingsBytes: 0,
      flagDocsCount: 0,
      flagsBytes: 0
    };
    cur.flagDocsCount += Number(grp.docCount) || 0;
    cur.flagsBytes += Number(grp.bytes) || 0;
    if (grp.isOrphaned) cur.moduleState = "orphaned";
    nsMap.set(grp.namespace, cur);
  }

  const topNamespaces = [...nsMap.values()]
    .map((ns) => {
      const totalBytes = ns.settingsBytes + ns.flagsBytes;
      return {
        ...ns,
        totalBytes,
        formattedSize: formatBytes(totalBytes),
        formattedSettingsSize: formatBytes(ns.settingsBytes),
        formattedFlagsSize: formatBytes(ns.flagsBytes),
        sharePercent: pct(totalBytes, totalTrackedBytes)
      };
    })
    .toSorted((a, b) => b.totalBytes - a.totalBytes || a.namespace.localeCompare(b.namespace))
    .slice(0, 10);

  const storageStats = {
    totalSettingsCount: Number(settings.totalSettingsCount) || settingItems.length,
    totalSettingsBytes,
    formattedSettingsSize: settings.formattedTotalSize || formatBytes(totalSettingsBytes),
    totalFlagsBytes,
    formattedFlagsSize: formatBytes(totalFlagsBytes),
    totalTrackedBytes,
    formattedTrackedSize: formatBytes(totalTrackedBytes),
    reclaimableSettingsBytes,
    formattedReclaimableSettings: formatBytes(reclaimableSettingsBytes),
    reclaimableFlagsBytes,
    formattedReclaimableFlags: formatBytes(reclaimableFlagsBytes),
    totalReclaimableBytes,
    formattedReclaimableTotal: formatBytes(totalReclaimableBytes),
    reclaimablePercent: pct(totalReclaimableBytes, totalTrackedBytes),
    settingsByState,
    flagsByStatus,
    flagsByDocType,
    topNamespaces
  };

  // ── 4. Multi-Domain Severity Matrix ─────────────────────────────────────
  const domainMatrix = [
    {
      id: "scenes",
      critical: criticalScenes,
      warning: warningScenes,
      info: 0,
      ok: healthyScenes,
      total: totalScenes
    },
    {
      id: "assets",
      critical: pngCount,
      warning: otherRasterCount + Math.max(0, (Number(scenes.oversizedAssetsCount) || 0) - pngCount),
      info: videoCount + otherFormatCount,
      ok: webpCount,
      total: totalAssets
    },
    {
      id: "uuids",
      critical: uuidItems.filter((i) => i.severity === "critical").length,
      warning: uuidItems.filter((i) => i.severity === "warning").length,
      info: 0,
      ok: validCount,
      total: Math.max(totalScanned, brokenCount)
    },
    {
      id: "settings",
      critical: settingItems.filter((i) => i.severity === "critical").length,
      warning: settingItems.filter((i) => i.severity === "warning").length,
      info: settingItems.filter((i) => i.severity === "info").length,
      ok: Math.max(0, (Number(settings.totalSettingsCount) || settingItems.length) - settingItems.length),
      total: Math.max(Number(settings.totalSettingsCount) || 0, settingItems.length)
    },
    {
      id: "flags",
      critical: flagGroups.filter((g) => g.severity === "critical").length,
      warning: flagGroups.filter((g) => g.severity === "warning").length,
      info: flagGroups.filter((g) => g.severity === "info").length,
      ok: 0,
      total: flagGroups.length
    }
  ];

  return {
    scoreBreakdown: computeScoreBreakdown(report),
    domainMatrix,
    sceneStats,
    uuidStats,
    storageStats,
    summaryCounts: {
      totalIssues: Number(summary.totalIssues) || 0,
      criticalCount: Number(summary.criticalCount) || 0,
      warningCount: Number(summary.warningCount) || 0,
      infoCount: Number(summary.infoCount) || 0,
      totalFixable: Number(summary.totalFixable) || 0
    }
  };
}

/**
 * Compare two audit reports (current vs previous) and produce structured deltas.
 * @param {Object} currentReport
 * @param {Object} previousReport
 * @returns {Object | null}
 */
export function compareAuditReports(currentReport, previousReport) {
  if (!currentReport || !previousReport) return null;
  const curSum = currentReport.summary ?? {};
  const prevSum = previousReport.summary ?? {};
  const curScenes = currentReport.scenes ?? {};
  const prevScenes = previousReport.scenes ?? {};
  const curUuids = currentReport.uuids ?? {};
  const prevUuids = previousReport.uuids ?? {};
  const curStats = currentReport.statistics ?? buildReportStatistics(currentReport);
  const prevStats = previousReport.statistics ?? buildReportStatistics(previousReport);
  const curReclaim = Number(curStats.storageStats?.totalReclaimableBytes) || 0;
  const prevReclaim = Number(prevStats.storageStats?.totalReclaimableBytes) || 0;
  const reclaimDelta = curReclaim - prevReclaim;

  return {
    previousGeneratedAt: previousReport.generatedAt ?? null,
    currentGeneratedAt: currentReport.generatedAt ?? null,
    previousWorldTitle: previousReport.meta?.worldTitle ?? "",
    healthDelta: (Number(curSum.healthScore) || 100) - (Number(prevSum.healthScore) || 100),
    previousHealth: Number(prevSum.healthScore) || 100,
    currentHealth: Number(curSum.healthScore) || 100,
    issuesDelta: (Number(curSum.totalIssues) || 0) - (Number(prevSum.totalIssues) || 0),
    criticalDelta: (Number(curSum.criticalCount) || 0) - (Number(prevSum.criticalCount) || 0),
    warningDelta: (Number(curSum.warningCount) || 0) - (Number(prevSum.warningCount) || 0),
    heavyScenesDelta: (Number(curScenes.heavyScenesCount) || 0) - (Number(prevScenes.heavyScenesCount) || 0),
    pngDelta: (Number(curScenes.pngAssetsCount) || 0) - (Number(prevScenes.pngAssetsCount) || 0),
    redundantWallsDelta:
      (Number(curScenes.redundantWallsTotal) || 0) - (Number(prevScenes.redundantWallsTotal) || 0),
    brokenUuidsDelta: (Number(curUuids.brokenCount) || 0) - (Number(prevUuids.brokenCount) || 0),
    reclaimableBytesDelta: reclaimDelta,
    formattedReclaimableDelta:
      reclaimDelta === 0
        ? "0 B"
        : `${reclaimDelta > 0 ? "+" : "-"}${formatBytes(Math.abs(reclaimDelta))}`,
    chatMessagesDelta:
      (Number(currentReport.extras?.chatMessagesCount) || 0) -
      (Number(previousReport.extras?.chatMessagesCount) || 0)
  };
}
