import assert from "node:assert/strict";
import test from "node:test";
import {
  compareAuditReports,
  createAuditReport,
  formatReportHtml,
  formatReportJournalHtml,
  formatReportJson,
  formatReportMarkdown
} from "../scripts/core/report.mjs";

test("createAuditReport builds health summary, statistics, and exports MD, HTML, JSON, and escaped Journal HTML", () => {
  const report = createAuditReport({
    meta: {
      worldId: "barovia",
      worldTitle: "Curse <of> Strahd",
      systemId: "dnd5e",
      systemVersion: "5.3.3",
      foundryVersion: "14.367",
      activeModulesCount: 12,
      installedModulesCount: 15,
      durationMs: 42
    },
    thresholds: { maxTextureResolution: 4096, maxMegapixels: 18 },
    scenes: {
      totalScenes: 3,
      heavyScenesCount: 1,
      criticalCount: 1,
      warningCount: 0,
      pngAssetsCount: 1,
      unoptimizedAssetsCount: 1,
      oversizedAssetsCount: 1,
      redundantWallsTotal: 4,
      items: [
        {
          id: "sc1",
          name: "Ravenloft | Crypt",
          severity: "critical",
          hasIssues: true,
          heavinessScore: 170,
          maxResolution: { width: 8192, height: 6144, megapixels: 50.33 },
          pngCount: 1,
          wallsCount: 410,
          lightsCount: 12,
          animationsCount: 3
        }
      ]
    },
    uuids: {
      totalScanned: 20,
      brokenCount: 1,
      journalCount: 0,
      loreframeCount: 1,
      actorCount: 0,
      exactMatchCount: 1,
      withCandidateCount: 1,
      items: [
        {
          id: "u1",
          rootDocName: "Lore Index",
          targetDocName: "Lore Index",
          fieldPath: "flags.loreframe.links[0]",
          rawUuid: "Actor.old123",
          label: "Strahd",
          severity: "critical",
          bestCandidate: { name: "Strahd", uuid: "Actor.new123", confidence: "exact" }
        }
      ]
    },
    settings: {
      totalSettingsCount: 10,
      totalBytes: 32_768,
      formattedTotalSize: "32.0 KB",
      flaggedCount: 1,
      bloatedCount: 1,
      orphanedCount: 1,
      orphanedBytes: 24_000,
      items: [
        {
          key: "gone.cache",
          namespace: "gone",
          status: "orphaned",
          severity: "critical",
          formattedSize: "23.4 KB"
        }
      ]
    },
    flags: {
      groupsCount: 1,
      orphanedEntriesCount: 2,
      orphanedNamespacesCount: 1,
      bloatedEntriesCount: 0,
      formattedOrphanedSize: "1.2 KB",
      groups: [
        {
          namespace: "gone",
          status: "orphaned",
          docCount: 2,
          docTypes: ["Actor"],
          formattedSize: "1.2 KB"
        }
      ]
    }
  });

  assert.ok(report.summary.healthScore < 100);
  assert.equal(report.summary.totalFixable, 9);
  assert.equal(report.summary.recommendations.length, 4);
  assert.ok(report.statistics);
  assert.equal(report.statistics.sceneStats.distributions.walls.max, 410);

  const mdRu = formatReportMarkdown(report, "ru");
  assert.match(mdRu, /Отчёт аудита мира/);
  assert.match(mdRu, /Ravenloft \\\| Crypt/);
  assert.match(mdRu, /Сводная статистика/);
  assert.match(mdRu, /Статистика распределения метрик сцен/);

  const mdEn = formatReportMarkdown(report, "en");
  assert.match(mdEn, /World Audit Report/);
  assert.match(mdEn, /Executive Statistics & Health Breakdown/);
  assert.match(mdEn, /Recommended Auto-Fixes/);

  const parsedJson = JSON.parse(formatReportJson(report));
  assert.equal(parsedJson.meta.worldId, "barovia");
  assert.equal(parsedJson.schemaVersion, 2);

  const html = formatReportJournalHtml(report, "en");
  assert.match(html, /Curse &lt;of&gt; Strahd/);
  assert.doesNotMatch(html, /Curse <of> Strahd/);
  assert.match(html, /Domain Summary Statistics/);

  const standaloneHtml = formatReportHtml(report, { lang: "ru", theme: "parchment", accent: "arcane" });
  assert.match(standaloneHtml, /<!doctype html>/i);
  assert.match(standaloneHtml, /data-theme="parchment"/);
  assert.match(standaloneHtml, /data-accent="arcane"/);
  assert.match(standaloneHtml, /<svg/);
  assert.match(standaloneHtml, /Curse &lt;of&gt; Strahd/);
  assert.doesNotMatch(standaloneHtml, /Curse <of> Strahd/);
});

test("compareAuditReports calculates deltas and reports render extras maintenance block", () => {
  const previous = createAuditReport({
    meta: { worldId: "w", worldTitle: "World" },
    thresholds: {},
    scenes: { totalScenes: 2, heavyScenesCount: 1, criticalCount: 1, warningCount: 0, pngAssetsCount: 1, unoptimizedAssetsCount: 1, oversizedAssetsCount: 0, redundantWallsTotal: 2, items: [] },
    uuids: { totalScanned: 10, brokenCount: 2, journalCount: 2, loreframeCount: 0, actorCount: 0, exactMatchCount: 0, withCandidateCount: 0, items: [] },
    settings: { totalSettingsCount: 1, totalBytes: 5000, flaggedCount: 1, bloatedCount: 0, orphanedCount: 1, orphanedBytes: 5000, items: [] },
    flags: { groupsCount: 0, orphanedEntriesCount: 0, orphanedNamespacesCount: 0, bloatedEntriesCount: 0, groups: [] }
  });

  const current = createAuditReport({
    meta: { worldId: "w", worldTitle: "World" },
    thresholds: {},
    scenes: { totalScenes: 2, heavyScenesCount: 0, criticalCount: 0, warningCount: 0, pngAssetsCount: 0, unoptimizedAssetsCount: 0, oversizedAssetsCount: 0, redundantWallsTotal: 0, items: [] },
    uuids: { totalScanned: 10, brokenCount: 0, journalCount: 0, loreframeCount: 0, actorCount: 0, exactMatchCount: 0, withCandidateCount: 0, items: [] },
    settings: { totalSettingsCount: 0, totalBytes: 0, flaggedCount: 0, bloatedCount: 0, orphanedCount: 0, orphanedBytes: 0, items: [] },
    flags: { groupsCount: 0, orphanedEntriesCount: 0, orphanedNamespacesCount: 0, bloatedEntriesCount: 0, groups: [] },
    extras: {
      chatMessagesCount: 1200,
      chatBytes: 400_000,
      formattedChatBytes: "390.6 KB",
      maxChatMessages: 1000,
      chatBloated: true,
      chatSeverity: "warning",
      combatsCount: 1,
      staleCombatsCount: 1,
      staleCombats: [{ id: "c1" }],
      brokenMediaCount: 0,
      brokenMedia: [],
      unusedOptimizedCount: 0,
      unusedOptimizedFiles: []
    }
  });

  const delta = compareAuditReports(current, previous);
  assert.ok(delta.healthDelta > 0);
  assert.equal(delta.brokenUuidsDelta, -2);
  assert.equal(delta.reclaimableBytesDelta, -5000);

  const md = formatReportMarkdown(current, "en");
  assert.match(md, /World Maintenance/);
  const html = formatReportHtml(current, { lang: "ru" });
  assert.match(html, /Обслуживание мира/);
});
