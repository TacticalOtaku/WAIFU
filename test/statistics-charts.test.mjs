import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReportCharts,
  renderCompactBarHtml,
  renderCompactSparklineSvg,
  renderDonutChartHtml,
  renderHealthGaugeSvg,
  renderHealthTrendSvg,
  renderHorizontalBarChartSvg,
  renderStackedBarHtml
} from "../scripts/core/charts.mjs";
import { createAuditReport } from "../scripts/core/report.mjs";
import {
  buildReportStatistics,
  computeNumericDistribution
} from "../scripts/core/statistics.mjs";

test("computeNumericDistribution calculates min, avg, median, p95, max, and total accurately", () => {
  const odd = computeNumericDistribution([10, 50, 20, 40, 30], 1);
  assert.deepEqual(odd, {
    count: 5,
    min: 10,
    avg: 30,
    median: 30,
    p95: 50,
    max: 50,
    total: 150
  });

  const even = computeNumericDistribution([2, 8, 4, 6], 2);
  assert.equal(even.median, 5);
  assert.equal(even.avg, 5);

  const empty = computeNumericDistribution([]);
  assert.equal(empty.count, 0);
  assert.equal(empty.max, 0);
});

test("buildReportStatistics aggregates scene metrics, asset formats, UUIDs, and storage footprint", () => {
  const report = createAuditReport({
    meta: {
      worldId: "demo",
      worldTitle: "Demo World",
      systemId: "dnd5e",
      systemVersion: "5.3.0",
      foundryVersion: "14.367",
      activeModulesCount: 4,
      installedModulesCount: 6,
      durationMs: 25
    },
    thresholds: { maxTextureResolution: 4096, maxMegapixels: 18 },
    scenes: {
      totalScenes: 2,
      heavyScenesCount: 1,
      criticalCount: 1,
      warningCount: 0,
      pngAssetsCount: 1,
      unoptimizedAssetsCount: 2,
      oversizedAssetsCount: 1,
      redundantWallsTotal: 3,
      totalWalls: 420,
      totalLights: 25,
      totalAnimations: 8,
      items: [
        {
          id: "s1",
          name: "Castle <Keep>",
          severity: "critical",
          hasIssues: true,
          heavinessScore: 95.5,
          levelsCount: 2,
          tilesCount: 4,
          tokensCount: 10,
          doorsCount: 5,
          soundsCount: 2,
          regionsCount: 1,
          wallsCount: 400,
          lightsCount: 20,
          animationsCount: 7,
          pngCount: 1,
          oversizedCount: 1,
          redundantWallIds: ["w1", "w2", "w3"],
          zeroLengthWallIds: ["w1"],
          duplicateWallIds: ["w2", "w3"],
          maxResolution: { width: 6000, height: 4000, megapixels: 24 },
          animationBreakdown: {
            animatedLights: 4,
            animatedTokens: 1,
            videoTiles: 1,
            videoLevelAssets: 0,
            videoDrawings: 0,
            weather: 1
          },
          flags: { hasPng: true, hasOversizedAsset: true },
          assets: [
            { src: "maps/f1.png", isPng: true, isUnoptimizedRaster: true, byteSize: 9_000_000 },
            { src: "maps/f2.webp", isWebp: true, byteSize: 1_500_000 },
            { src: "maps/tile.jpg", isUnoptimizedRaster: true, byteSize: 800_000 },
            { src: "maps/fx.webm", isVideo: true, byteSize: 500_000 }
          ]
        },
        {
          id: "s2",
          name: "Inn",
          severity: "ok",
          hasIssues: false,
          heavinessScore: 6.0,
          levelsCount: 1,
          tilesCount: 0,
          tokensCount: 2,
          doorsCount: 1,
          soundsCount: 0,
          regionsCount: 0,
          wallsCount: 20,
          lightsCount: 5,
          animationsCount: 1,
          pngCount: 0,
          oversizedCount: 0,
          redundantWallIds: [],
          zeroLengthWallIds: [],
          duplicateWallIds: [],
          maxResolution: { width: 2048, height: 2048, megapixels: 4.19 },
          animationBreakdown: {
            animatedLights: 1,
            animatedTokens: 0,
            videoTiles: 0,
            videoLevelAssets: 0,
            videoDrawings: 0,
            weather: 0
          },
          flags: {},
          assets: [{ src: "maps/inn.webp", isWebp: true, byteSize: 600_000 }]
        }
      ]
    },
    uuids: {
      totalScanned: 20,
      brokenCount: 3,
      journalCount: 1,
      loreframeCount: 1,
      actorCount: 1,
      exactMatchCount: 1,
      withCandidateCount: 2,
      items: [
        {
          id: "u1",
          rootUuid: "JournalEntry.j1",
          rootDocName: "Lore",
          rootDocType: "JournalEntry",
          targetDocType: "Actor",
          reason: "missing-document",
          syntax: "enricher",
          severity: "critical",
          bestCandidate: { uuid: "Actor.a1", name: "King", score: 1, confidence: "exact" }
        },
        {
          id: "u2",
          rootUuid: "JournalEntry.j1",
          rootDocName: "Lore",
          rootDocType: "JournalEntry",
          targetDocType: "Item",
          reason: "missing-pack",
          syntax: "html-link",
          severity: "critical",
          bestCandidate: { uuid: "Item.i1", name: "Blade", score: 0.8, confidence: "high" }
        },
        {
          id: "u3",
          rootUuid: "Actor.hero",
          rootDocName: "Hero",
          rootDocType: "Actor",
          targetDocType: "JournalEntry",
          reason: "malformed",
          syntax: "bare-uuid",
          severity: "warning",
          bestCandidate: null
        }
      ]
    },
    settings: {
      totalSettingsCount: 4,
      totalBytes: 50_000,
      formattedTotalSize: "48.8 KB",
      flaggedCount: 2,
      bloatedCount: 1,
      orphanedCount: 1,
      orphanedBytes: 12_000,
      items: [
        {
          key: "gone.cache",
          namespace: "gone",
          status: "orphaned",
          severity: "critical",
          moduleState: "orphaned",
          bytes: 12_000,
          formattedSize: "11.7 KB"
        },
        {
          key: "core.big",
          namespace: "core",
          status: "bloated",
          severity: "warning",
          moduleState: "core",
          bytes: 30_000,
          formattedSize: "29.3 KB"
        }
      ],
      allItems: [
        { key: "gone.cache", namespace: "gone", moduleState: "orphaned", bytes: 12_000 },
        { key: "core.big", namespace: "core", moduleState: "core", bytes: 30_000 },
        { key: "mod.ok", namespace: "mod", moduleState: "active", bytes: 8_000 }
      ],
      byNamespace: [
        { namespace: "core", moduleState: "core", count: 1, bytes: 30_000 },
        { namespace: "gone", moduleState: "orphaned", count: 1, bytes: 12_000 },
        { namespace: "mod", moduleState: "active", count: 1, bytes: 8_000 }
      ]
    },
    flags: {
      groupsCount: 1,
      orphanedEntriesCount: 2,
      orphanedNamespacesCount: 1,
      orphanedBytes: 4_000,
      bloatedEntriesCount: 0,
      formattedOrphanedSize: "3.9 KB",
      groups: [
        {
          namespace: "gone",
          moduleState: "orphaned",
          status: "orphaned",
          severity: "warning",
          isOrphaned: true,
          docCount: 2,
          docTypes: ["Actor"],
          bytes: 4_000,
          formattedSize: "3.9 KB"
        }
      ],
      items: [
        { docType: "Actor", namespace: "gone", bytes: 2500 },
        { docType: "Actor", namespace: "gone", bytes: 1500 }
      ]
    }
  });

  const stats = buildReportStatistics(report);
  assert.equal(stats.sceneStats.healthyScenes, 1);
  assert.equal(stats.sceneStats.healthyPercent, 50);
  assert.equal(stats.sceneStats.assetFormats.webp, 2);
  assert.equal(stats.sceneStats.assetFormats.png, 1);
  assert.equal(stats.sceneStats.assetFormats.otherRaster, 1);
  assert.equal(stats.sceneStats.assetFormats.video, 1);
  assert.equal(stats.sceneStats.distributions.walls.max, 400);
  assert.equal(stats.sceneStats.distributions.walls.min, 20);
  assert.equal(stats.sceneStats.distributions.walls.avg, 210);

  assert.equal(stats.uuidStats.validCount, 17);
  assert.equal(stats.uuidStats.validPercent, 85);
  assert.equal(stats.uuidStats.byFixability.exact, 1);
  assert.equal(stats.uuidStats.byFixability.fuzzy, 1);
  assert.equal(stats.uuidStats.byFixability.unmatched, 1);
  assert.equal(stats.uuidStats.topOffendingDocs[0].rootDocName, "Lore");
  assert.equal(stats.uuidStats.topOffendingDocs[0].count, 2);

  assert.equal(stats.storageStats.totalReclaimableBytes, 16_000);
  assert.equal(stats.storageStats.topNamespaces[0].namespace, "core");
  assert.equal(stats.storageStats.topNamespaces[1].namespace, "gone");
  assert.equal(stats.storageStats.topNamespaces[1].totalBytes, 16_000);

  // Charts render safely and escape dynamic XSS characters
  const charts = buildReportCharts(report, stats, "ru");
  assert.match(charts.healthGaugeSvg, /<svg/);
  assert.match(charts.heavySceneBarsSvg, /Castle &lt;Keep&gt;/);
  assert.doesNotMatch(charts.heavySceneBarsSvg, /Castle <Keep>/);
  assert.match(charts.assetFormatDonutHtml, /WebP/);
  assert.match(charts.topNamespacesSvg, /gone/);
});

test("SVG chart helpers handle zero-data and XSS-escaped labels cleanly", () => {
  const gauge = renderHealthGaugeSvg(0, "critical", { stateLabel: "Critical" });
  assert.match(gauge, /<svg/);
  assert.match(gauge, /0<tspan/);
  assert.match(gauge, /waifu-gauge-pill/);
  assert.match(gauge, /y="99"/);

  const donut = renderDonutChartHtml([], 0, "Empty");
  assert.match(donut, /waifu-donut-wrap/);

  const emptyBars = renderHorizontalBarChartSvg([], { emptyLabel: "Nothing here" });
  assert.match(emptyBars, /Nothing here/);

  const xssBar = renderStackedBarHtml([{ label: "<img src=x>", value: 5, tone: "ok" }]);
  assert.match(xssBar, /&lt;img src=x&gt;/);
  assert.doesNotMatch(xssBar, /<img src=x>/);

  const trend = renderHealthTrendSvg([
    { generatedAt: "2026-11-20T10:00:00Z", healthScore: 62 },
    { generatedAt: "2026-11-25T10:00:00Z", healthScore: 91 }
  ]);
  assert.match(trend, /<polyline/);
  assert.match(trend, /91%/);

  const idleGauge = renderHealthGaugeSvg(null, "idle", { stateLabel: "PENDING" });
  assert.match(idleGauge, /—/);
  assert.doesNotMatch(idleGauge, /%/);
  assert.match(idleGauge, /PENDING/);

  const compactBar = renderCompactBarHtml(
    [{ label: "<bad>", value: 20, tone: "warning" }],
    { totalMax: 100, ariaLabel: "Penalties" }
  );
  assert.match(compactBar, /waifu-segbar/);
  assert.match(compactBar, /width:20\.00%/);
  assert.doesNotMatch(compactBar, /<bad>/);

  const spark = renderCompactSparklineSvg([], 74);
  assert.match(spark, /waifu-spark-svg/);
  assert.match(spark, /<polyline/);

  // Healthy UUID scans show non-alarming empty state when 0 are broken
  const healthyCharts = buildReportCharts(
    { summary: { healthScore: 100 }, scenes: {}, uuids: { totalScanned: 30, brokenCount: 0, items: [] }, settings: {}, flags: {} },
    buildReportStatistics({ scenes: {}, uuids: { totalScanned: 30, brokenCount: 0, items: [] }, settings: {}, flags: {} }),
    "en"
  );
  assert.match(healthyCharts.uuidTopDocsSvg, /No broken @UUID references found/);
});
