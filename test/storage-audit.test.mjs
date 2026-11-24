import assert from "node:assert/strict";
import test from "node:test";
import { auditDocumentFlags, auditWorldSettings } from "../scripts/core/storage-audit.mjs";
import { utf8ByteSize } from "../scripts/core/utils.mjs";

test("utf8ByteSize handles multi-byte Cyrillic strings and circular objects safely", () => {
  assert.equal(utf8ByteSize("Привет"), 12);
  const circular = { name: "loop" };
  circular.self = circular;
  assert.ok(utf8ByteSize(circular) > 0);
});

test("auditWorldSettings distinguishes active, disabled, bloated, and deleted-module settings", () => {
  const entries = [
    { key: "core.time", value: 1200 },
    { key: "dnd5e.hugeCache", value: "x".repeat(3000) },
    { key: "active-mod.small", value: { ok: true } },
    { key: "disabled-mod.prefs", value: { layout: "compact" } },
    { key: "deleted-mod.cache", value: "y".repeat(2500) },
    { key: "deleted-mod.tiny", value: 1 }
  ];

  const report = auditWorldSettings(entries, {
    activeModuleIds: new Set(["active-mod"]),
    installedModuleIds: new Set(["active-mod", "disabled-mod"]),
    systemId: "dnd5e",
    maxSettingBytes: 1024
  });

  assert.equal(report.totalSettingsCount, 6);
  assert.equal(report.orphanedCount, 2);
  assert.equal(report.bloatedCount, 2);
  assert.equal(report.inactiveCount, 1);

  const tinyOrphan = report.items.find((i) => i.key === "deleted-mod.tiny");
  assert.equal(tinyOrphan.status, "orphaned");
  assert.equal(tinyOrphan.severity, "warning");

  const hugeOrphan = report.items.find((i) => i.key === "deleted-mod.cache");
  assert.equal(hugeOrphan.severity, "critical");

  const disabled = report.items.find((i) => i.key === "disabled-mod.prefs");
  assert.equal(disabled.status, "inactive");
  assert.equal(disabled.severity, "info");
});

test("auditDocumentFlags ignores normal active/core flags and groups orphaned module flags", () => {
  const flagEntries = [
    {
      docType: "Actor",
      docId: "a1",
      docName: "Hero",
      docUuid: "Actor.a1",
      namespace: "core",
      value: { sheetClass: "dnd5e" }
    },
    {
      docType: "Actor",
      docId: "a1",
      docName: "Hero",
      docUuid: "Actor.a1",
      namespace: "active-mod",
      value: { small: 1 }
    },
    {
      docType: "Actor",
      docId: "a2",
      docName: "Boss",
      docUuid: "Actor.a2",
      namespace: "active-mod",
      value: { blob: "z".repeat(4000) }
    },
    {
      docType: "Wall",
      docId: "w1",
      docName: "w1",
      docUuid: "Scene.s1.Wall.w1",
      namespace: "old-wall-mod",
      value: { doorMode: 2 }
    },
    {
      docType: "Wall",
      docId: "w2",
      docName: "w2",
      docUuid: "Scene.s1.Wall.w2",
      namespace: "old-wall-mod",
      value: { doorMode: 3 }
    }
  ];

  const report = auditDocumentFlags(flagEntries, {
    activeModuleIds: new Set(["active-mod"]),
    installedModuleIds: new Set(["active-mod"]),
    systemId: "dnd5e",
    maxFlagBytes: 2048
  });

  assert.equal(report.orphanedNamespacesCount, 1);
  assert.equal(report.orphanedEntriesCount, 2);
  assert.equal(report.bloatedEntriesCount, 1);
  assert.equal(report.groupsCount, 2);

  const orphanGroup = report.groups.find((g) => g.namespace === "old-wall-mod");
  assert.equal(orphanGroup.docCount, 2);
  assert.equal(orphanGroup.isOrphaned, true);
});
