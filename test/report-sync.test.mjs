import assert from "node:assert/strict";
import test from "node:test";
import { createAuditReport } from "../scripts/core/report.mjs";
import {
  reconcileChatPruned,
  reconcileCleanedTokens,
  reconcileCleanedWalls,
  reconcileCombatsCleaned,
  reconcileConvertedAssets,
  reconcileDeletedFlagGroups,
  reconcileDeletedFlagTarget,
  reconcileDeletedSettings,
  reconcileDisabledLightAnims,
  reconcileFlagIgnore,
  reconcileResolvedUuids,
  reconcileSceneIgnore,
  reconcileSettingIgnore,
  reconcileUuidIgnore
} from "../scripts/core/report-sync.mjs";
import { auditScenes } from "../scripts/core/scene-audit.mjs";
import { auditDocumentFlags, auditWorldSettings } from "../scripts/core/storage-audit.mjs";

function makeRichReport() {
  const scenes = auditScenes(
    [
      {
        id: "sc1",
        name: "Crypt",
        levels: [{ id: "l1", name: "Base", backgroundSrc: "worlds/w/crypt.png", width: 2048, height: 2048 }],
        tiles: [],
        walls: [
          { id: "w1", c: [0, 0, 100, 0], move: 20, sight: 20, door: 0 },
          { id: "w2", c: [0, 0, 100, 0], move: 20, sight: 20, door: 0 },
          { id: "w3", c: [1.5, 0.5, 99.5, -0.5], move: 20, sight: 20, door: 0 }
        ],
        lights: [{ id: "lg1", animationType: "torch" }],
        tokens: [{ id: "tk1", actorId: "missing", actorExists: false, textureSrc: "" }],
        drawings: [],
        sounds: []
      }
    ],
    new Map([
      ["worlds/w/crypt.png", { width: 2048, height: 2048, byteSize: 5_000_000 }]
    ]),
    { nearDuplicateWallTolerance: 2 }
  );

  const settings = auditWorldSettings(
    [
      { key: "gone.cacheA", value: "a".repeat(20_000) },
      { key: "gone.cacheB", value: "b".repeat(20_000) },
      { key: "active.bloated", value: "c".repeat(25_000) },
      { key: "core.small", value: 1 }
    ],
    {
      activeModuleIds: new Set(["active"]),
      installedModuleIds: new Set(["active"]),
      maxSettingBytes: 16 * 1024
    }
  );

  const flags = auditDocumentFlags(
    [
      {
        docType: "Actor",
        docId: "a1",
        docName: "Hero",
        docUuid: "Actor.a1",
        namespace: "gone-mod",
        value: { x: "y".repeat(200) }
      },
      {
        docType: "Actor",
        docId: "a2",
        docName: "Villain",
        docUuid: "Actor.a2",
        namespace: "gone-mod",
        value: { x: "z".repeat(200) }
      }
    ],
    {
      activeModuleIds: new Set(),
      installedModuleIds: new Set(),
      maxFlagBytes: 32 * 1024
    }
  );

  const uuids = {
    totalScanned: 10,
    brokenCount: 2,
    journalCount: 1,
    loreframeCount: 0,
    actorCount: 1,
    otherDocsCount: 0,
    missingAnchorCount: 0,
    exactMatchCount: 1,
    autoMatchCount: 1,
    minAutoConfidence: 1.0,
    withCandidateCount: 1,
    unmatchedCount: 1,
    ignoredCount: 0,
    ignoredItems: [],
    items: [
      {
        id: "u1",
        rootDocName: "Journal",
        rawUuid: "Actor.old1",
        sourceCategory: "journal",
        severity: "critical",
        reason: "missing-document",
        bestCandidate: { uuid: "Actor.new1", name: "Knight", confidence: "exact", score: 1 }
      },
      {
        id: "u2",
        rootDocName: "Hero",
        rawUuid: "Item.old2",
        sourceCategory: "actor",
        severity: "warning",
        reason: "missing-document",
        bestCandidate: null
      }
    ]
  };

  const extras = {
    chatMessagesCount: 1500,
    chatBytes: 300_000,
    formattedChatBytes: "293.0 KB",
    maxChatMessages: 1000,
    chatSeverity: "warning",
    chatBloated: true,
    combatsCount: 2,
    staleCombatsCount: 1,
    staleCombats: [{ id: "c1" }],
    brokenMediaCount: 0,
    brokenMedia: [],
    unusedOptimizedCount: 0,
    unusedOptimizedFiles: []
  };

  return createAuditReport({
    meta: { worldId: "w", worldTitle: "World", durationMs: 10 },
    thresholds: { nearDuplicateWallTolerance: 2, maxChatMessages: 1000 },
    scenes,
    uuids,
    settings,
    flags,
    extras,
    history: [
      { generatedAt: "2026-11-20T10:00:00.000Z", healthScore: 40, totalIssues: 12, reclaimableBytes: 50_000 },
      { generatedAt: "2026-11-26T10:00:00.000Z", healthScore: 55, totalIssues: 9, reclaimableBytes: 40_000 }
    ]
  });
}

test("report-sync reconciles scene media, walls, tokens, lights, UUIDs, storage, ignore rules, and extras locally", () => {
  const report = makeRichReport();
  const initialGeneratedAt = report.generatedAt;
  const initialScore = report.summary.healthScore;

  // 1. Convert PNG -> WebP locally
  reconcileConvertedAssets(report, [
    {
      sceneId: "sc1",
      slotType: "level-background",
      levelId: "l1",
      oldSrc: "worlds/w/crypt.png",
      newSrc: "worlds/w/crypt.webp",
      webpBytes: 900_000,
      width: 2048,
      height: 2048
    }
  ]);
  assert.equal(report.generatedAt, initialGeneratedAt);
  assert.equal(report.scenes.pngAssetsCount, 0);
  assert.equal(report.scenes.unoptimizedAssetsCount, 0);
  assert.equal(report.scenes.items[0].assets[0].src, "worlds/w/crypt.webp");
  assert.equal(report.scenes.items[0].assets[0].isWebp, true);
  assert.ok(report.summary.healthScore > initialScore);

  // 2. Clean redundant + near-dup walls, orphan tokens, animated lights
  reconcileCleanedWalls(report, [{ sceneId: "sc1", wallIds: ["w2", "w3"] }]);
  assert.equal(report.scenes.redundantWallsTotal, 0);
  assert.equal(report.scenes.nearDuplicateWallsTotal, 0);
  assert.equal(report.scenes.items[0].wallsCount, 1);

  reconcileCleanedTokens(report, [{ sceneId: "sc1", tokenIds: ["tk1"] }]);
  assert.equal(report.scenes.orphanedTokensTotal, 0);

  reconcileDisabledLightAnims(report, [{ sceneId: "sc1", lightIds: ["lg1"] }]);
  assert.equal(report.scenes.items[0].animationsCount, 0);
  assert.equal(report.scenes.items[0].severity, "ok");
  assert.equal(report.scenes.heavyScenesCount, 0);

  // 3. Resolve one @UUID, ignore the other, then unignore it
  reconcileResolvedUuids(report, ["u1"]);
  assert.equal(report.uuids.totalScanned, 10);
  assert.equal(report.uuids.brokenCount, 1);
  assert.equal(report.uuids.exactMatchCount, 0);

  reconcileUuidIgnore(report, ["u2"], true);
  assert.equal(report.uuids.brokenCount, 0);
  assert.equal(report.uuids.ignoredCount, 1);
  reconcileUuidIgnore(report, ["u2"], false);
  assert.equal(report.uuids.brokenCount, 1);
  assert.equal(report.uuids.ignoredCount, 0);

  // 4. Delete multi-selected settings (active bloated + one orphan) and ignore/unignore remaining orphan
  reconcileDeletedSettings(report, ["gone.cacheA", "active.bloated"]);
  assert.equal(report.settings.totalSettingsCount, 2);
  assert.equal(report.settings.flaggedCount, 1);
  assert.equal(report.settings.orphanedCount, 1);
  assert.equal(report.settings.bloatedCount, 1);

  reconcileSettingIgnore(report, ["gone.cacheB"], true);
  assert.equal(report.settings.flaggedCount, 0);
  assert.equal(report.settings.ignoredCount, 1);
  reconcileSettingIgnore(report, ["gone.cacheB"], false);
  assert.equal(report.settings.flaggedCount, 1);

  // 5. Delete single flag target, ignore/unignore flag namespace, and delete whole group
  reconcileDeletedFlagTarget(report, "gone-mod::orphaned", "Actor.a1");
  assert.equal(report.flags.orphanedEntriesCount, 1);
  assert.equal(report.flags.groups[0].docCount, 1);

  reconcileFlagIgnore(report, ["gone-mod"], true);
  assert.equal(report.flags.groupsCount, 0);
  assert.equal(report.flags.ignoredGroupsCount, 1);
  reconcileFlagIgnore(report, ["gone-mod"], false);
  assert.equal(report.flags.groupsCount, 1);

  reconcileDeletedFlagGroups(report, ["gone-mod::orphaned"]);
  assert.equal(report.flags.groupsCount, 0);
  assert.equal(report.flags.orphanedEntriesCount, 0);

  // 6. Scene ignore toggle & extras cleanup
  reconcileSceneIgnore(report, "sc1", true);
  assert.equal(report.scenes.totalScenes, 0);
  assert.equal(report.scenes.ignoredCount, 1);
  reconcileSceneIgnore(report, "sc1", false);
  assert.equal(report.scenes.totalScenes, 1);

  reconcileChatPruned(report, { deletedCount: 1400 });
  assert.equal(report.extras.chatMessagesCount, 100);
  assert.equal(report.extras.chatBloated, false);

  reconcileCombatsCleaned(report, ["c1"]);
  assert.equal(report.extras.staleCombatsCount, 0);
  assert.equal(report.extras.combatsCount, 1);

  assert.ok(report.comparison);
  assert.equal(report.comparison.currentHealth, report.summary.healthScore);
});

test("report-sync reconciles deleted settings cleanly on partial fixtures without allItems", () => {
  const partialReport = createAuditReport({
    meta: { worldId: "w", worldTitle: "Partial" },
    thresholds: {},
    scenes: { totalScenes: 0, heavyScenesCount: 0, criticalCount: 0, warningCount: 0, pngAssetsCount: 0, unoptimizedAssetsCount: 0, oversizedAssetsCount: 0, redundantWallsTotal: 0, items: [] },
    uuids: { totalScanned: 0, brokenCount: 0, journalCount: 0, loreframeCount: 0, actorCount: 0, exactMatchCount: 0, withCandidateCount: 0, items: [] },
    settings: {
      totalSettingsCount: 3,
      totalBytes: 30_000,
      formattedTotalSize: "29.3 KB",
      flaggedCount: 2,
      bloatedCount: 1,
      orphanedCount: 2,
      orphanedBytes: 25_000,
      items: [
        { key: "gone.a", namespace: "gone", status: "orphaned", severity: "critical", isOrphaned: true, isBloated: true, bytes: 20_000 },
        { key: "gone.b", namespace: "gone", status: "orphaned", severity: "warning", isOrphaned: true, isBloated: false, bytes: 5_000 }
      ],
      byNamespace: [
        { namespace: "gone", count: 2, bytes: 25_000 },
        { namespace: "core", count: 1, bytes: 5_000 }
      ]
    },
    flags: { groupsCount: 0, orphanedEntriesCount: 0, orphanedNamespacesCount: 0, bloatedEntriesCount: 0, groups: [] }
  });

  reconcileDeletedSettings(partialReport, ["gone.a"]);
  assert.equal(partialReport.settings.totalSettingsCount, 2);
  assert.equal(partialReport.settings.totalBytes, 10_000);
  assert.equal(partialReport.settings.orphanedCount, 1);
  assert.equal(partialReport.settings.bloatedCount, 0);
});
