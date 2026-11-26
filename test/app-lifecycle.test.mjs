import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIT_HISTORY_SETTING,
  IGNORE_RULES_SETTING,
  LAST_AUDIT_REPORT_SETTING,
  MODULE_ID
} from "../scripts/constants.mjs";

function installAppTestGlobals() {
  const settingsData = new Map([
    [`${MODULE_ID}.maxWalls`, 300],
    [`${MODULE_ID}.maxLights`, 40],
    [`${MODULE_ID}.maxAnimations`, 15],
    [`${MODULE_ID}.nearDuplicateWallTolerance`, 2],
    [`${MODULE_ID}.theme`, "night"],
    [`${MODULE_ID}.accent`, "brass"],
    [`${MODULE_ID}.${IGNORE_RULES_SETTING}`, { scenes: [], settings: [], flags: [], uuids: [] }],
    [`${MODULE_ID}.${AUDIT_HISTORY_SETTING}`, []],
    [`${MODULE_ID}.${LAST_AUDIT_REPORT_SETTING}`, null]
  ]);

  const worldStorageDocs = [
    { key: "gone.alpha", value: "a".repeat(20_000) },
    { key: "gone.beta", value: "b".repeat(20_000) },
    { key: "active.keep", value: "c".repeat(20_000) }
  ];
  for (const doc of worldStorageDocs) {
    doc.delete = async () => {
      const idx = worldStorageDocs.indexOf(doc);
      if (idx >= 0) worldStorageDocs.splice(idx, 1);
    };
  }

  const actorObj = {
    id: "a1",
    uuid: "Actor.a1",
    name: "Hero",
    img: "",
    prototypeToken: { texture: { src: "" } },
    system: {},
    flags: {
      "old-flag-mod": { junk: "x".repeat(200) },
      "other-flag-mod": { junk: "y".repeat(200) }
    },
    items: [],
    effects: [],
    async update(patch) {
      for (const [k] of Object.entries(patch)) {
        if (k.startsWith("flags.-=")) delete this.flags[k.slice(8)];
      }
    }
  };
  const pageObj = {
    id: "p1",
    uuid: "JournalEntry.j1.JournalEntryPage.p1",
    name: "Lore",
    text: {
      content: "<p>@UUID[Actor.missingHero]{Hero} and @UUID[Item.missingSword]{Sword}</p>",
      markdown: ""
    },
    system: {},
    flags: {},
    async update(patch) {
      if ("text.content" in patch) this.text.content = patch["text.content"];
    }
  };
  const journalObj = {
    id: "j1",
    uuid: "JournalEntry.j1",
    name: "Journal",
    flags: {},
    pages: [pageObj]
  };
  const byUuid = new Map([
    [actorObj.uuid, actorObj],
    [journalObj.uuid, journalObj],
    [pageObj.uuid, pageObj]
  ]);

  class MockApplicationV2 {
    constructor(options = {}) {
      this.options = options;
      this.rendered = false;
      this.element = null;
    }
    async _prepareContext(options) {
      return { options };
    }
    _onFirstRender() {}
    _onRender() {}
    render() {
      this.rendered = true;
      globalThis.foundry.applications.instances.set(this.constructor.DEFAULT_OPTIONS.id, this);
      this._onFirstRender({}, {});
    }
    async close() {
      this.rendered = false;
      globalThis.foundry.applications.instances.delete(this.constructor.DEFAULT_OPTIONS.id);
    }
  }

  const HandlebarsApplicationMixin = (Base) => class extends Base {};
  const dialogWaitCalls = [];
  const DialogV2 = {
    wait: async (config) => {
      dialogWaitCalls.push(config);
      return { confirmed: true, backupFirst: false };
    }
  };

  const asFoundryCollection = (entries) => {
    const map = new Map(entries);
    map[Symbol.iterator] = () => map.values();
    map.contents = [...map.values()];
    return map;
  };
  const createCollection = (arr) => {
    const col = [...arr];
    col.get = (id) => arr.find((x) => x.id === id) ?? null;
    col.has = (id) => arr.some((x) => x.id === id);
    return col;
  };

  globalThis.foundry = {
    applications: {
      api: { ApplicationV2: MockApplicationV2, DialogV2, HandlebarsApplicationMixin },
      instances: new Map()
    },
    utils: {
      deepClone: (v) => structuredClone(v),
      saveDataToFile: () => {}
    }
  };
  globalThis.fromUuid = async (u) => byUuid.get(u) ?? null;
  globalThis.fromUuidSync = (u) => byUuid.get(u) ?? null;
  globalThis.ui = {
    notifications: {
      info: () => {},
      warn: () => {},
      error: () => {}
    }
  };
  globalThis.game = {
    version: "14.367",
    world: { id: "lifecycle-world", title: "Lifecycle World" },
    system: { id: "dnd5e", version: "5.3.3" },
    i18n: { lang: "en", localize: (k) => k },
    modules: asFoundryCollection([
      ["waifu", { id: "waifu", active: true }],
      ["active", { id: "active", active: true }]
    ]),
    packs: [],
    scenes: createCollection([]),
    journal: createCollection([journalObj]),
    actors: createCollection([actorObj]),
    items: createCollection([]),
    tables: createCollection([]),
    macros: createCollection([]),
    cards: createCollection([]),
    playlists: createCollection([]),
    folders: createCollection([]),
    users: createCollection([]),
    combats: createCollection([]),
    messages: createCollection([]),
    settings: {
      storage: {
        get: () => ({
          contents: worldStorageDocs,
          values: () => worldStorageDocs.values()
        })
      },
      get: (ns, key) => settingsData.get(`${ns}.${key}`),
      set: async (ns, key, val) => {
        settingsData.set(`${ns}.${key}`, val);
      }
    }
  };

  return { settingsData, worldStorageDocs, actorObj, pageObj, dialogWaitCalls };
}

test("WaifuAuditApp auto-audits only on first run, persists across re-login, and skips re-audit on cleanup/multi-select delete", async () => {
  const prevGlobals = {
    game: globalThis.game,
    foundry: globalThis.foundry,
    fromUuid: globalThis.fromUuid,
    fromUuidSync: globalThis.fromUuidSync,
    ui: globalThis.ui
  };

  try {
    const { settingsData, worldStorageDocs, actorObj, pageObj } = installAppTestGlobals();
    const { WaifuAuditApp } = await import("../scripts/app/audit-app.mjs");

    let auditExecutions = 0;
    const origExecuteAudit = WaifuAuditApp.prototype.executeAudit;
    WaifuAuditApp.prototype.executeAudit = async function patchedExecuteAudit(opts) {
      auditExecutions += 1;
      return origExecuteAudit.call(this, opts);
    };

    try {
      // 1. Very first open with no persisted report -> triggers first automatic audit
      const firstApp = WaifuAuditApp.openWindow();
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(auditExecutions, 1);
      assert.ok(firstApp._report);
      assert.equal(firstApp._report.settings.flaggedCount, 3);
      assert.equal(firstApp._report.flags.groupsCount, 2);
      assert.equal(firstApp._report.uuids.brokenCount, 2);
      assert.equal(settingsData.get(`${MODULE_ID}.${LAST_AUDIT_REPORT_SETTING}`)?.generatedAt, firstApp._report.generatedAt);

      // 2. Simulate closing window & reloading Foundry ("перезаход") via both openWindow and registerMenu constructor
      await firstApp.close();
      globalThis.foundry.applications.instances.clear();
      const reopenedApp = WaifuAuditApp.openWindow();
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(auditExecutions, 1, "Reopening after first audit must NOT auto-run audit");
      assert.equal(reopenedApp._report.generatedAt, firstApp._report.generatedAt);
      assert.equal(reopenedApp._report.settings.flaggedCount, 3);

      const menuOpenedApp = new WaifuAuditApp();
      menuOpenedApp.render({ force: true });
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(auditExecutions, 1, "Opening via registerMenu after first audit must NOT auto-run audit");

      // 3. Multi-select delete two world settings without triggering any audit, while streaming progress details
      const progressEvents = [];
      const origUpdateProgressDom = reopenedApp._updateProgressDom.bind(reopenedApp);
      reopenedApp._updateProgressDom = (pct, label, detail = "") => {
        progressEvents.push({ pct, label, detail });
        return origUpdateProgressDom(pct, label, detail);
      };
      reopenedApp._selection.settings.add("gone.alpha");
      reopenedApp._selection.settings.add("gone.beta");
      await WaifuAuditApp.DEFAULT_OPTIONS.actions.deleteSelectedSettings.call(reopenedApp);
      reopenedApp._updateProgressDom = origUpdateProgressDom;

      assert.equal(reopenedApp._busy, false, "Busy overlay must deactivate after completion");
      assert.ok(progressEvents.some((e) => e.detail.includes("gone.alpha")));
      assert.ok(progressEvents.some((e) => e.detail.includes("gone.beta")));
      assert.ok(progressEvents.some((e) => e.pct === 100));

      assert.equal(auditExecutions, 1, "Cleaning/deleting settings must NOT run audit");
      assert.equal(worldStorageDocs.length, 1);
      assert.equal(reopenedApp._report.settings.flaggedCount, 1);
      assert.equal(reopenedApp._report.settings.items[0].key, "active.keep");
      assert.equal(reopenedApp._selection.settings.size, 0);

      // 4. Multi-select delete flag group + multi-select replace & unlink @UUIDs without triggering audit
      reopenedApp._selection.flags.add("old-flag-mod::orphaned");
      await WaifuAuditApp.DEFAULT_OPTIONS.actions.deleteSelectedFlagGroups.call(reopenedApp);
      assert.equal(auditExecutions, 1, "Deleting selected flag groups must NOT run audit");
      assert.equal(actorObj.flags["old-flag-mod"], undefined);
      assert.equal(reopenedApp._report.flags.groupsCount, 1);

      const heroOcc = reopenedApp._report.uuids.items.find((u) => u.label === "Hero");
      const swordOcc = reopenedApp._report.uuids.items.find((u) => u.label === "Sword");
      reopenedApp._selection.uuids.add(heroOcc.id);
      await WaifuAuditApp.DEFAULT_OPTIONS.actions.replaceSelectedUuids.call(reopenedApp);
      assert.equal(auditExecutions, 1, "Replacing selected UUIDs must NOT run audit");
      assert.match(pageObj.text.content, /@UUID\[Actor\.a1\]\{Hero\}/);

      reopenedApp._selection.uuids.add(swordOcc.id);
      await WaifuAuditApp.DEFAULT_OPTIONS.actions.unlinkSelectedUuids.call(reopenedApp);
      assert.equal(auditExecutions, 1, "Unlinking selected UUIDs must NOT run audit");
      assert.equal(reopenedApp._report.uuids.brokenCount, 0);

      // 5. Bulk ignore selected remaining setting without triggering audit
      reopenedApp._selection.settings.add("active.keep");
      await WaifuAuditApp.DEFAULT_OPTIONS.actions.ignoreSelectedItems.call(reopenedApp, null, {
        dataset: { selectKind: "settings" }
      });
      assert.equal(auditExecutions, 1, "Ignoring selected items must NOT run audit");
      assert.equal(reopenedApp._report.settings.flaggedCount, 0);
      assert.equal(reopenedApp._report.settings.ignoredCount, 1);

      // 6. Verify persisted report reflects all local cleanups after another simulated reload
      await reopenedApp.close();
      const afterCleanupReload = WaifuAuditApp.openWindow();
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(auditExecutions, 1);
      assert.equal(afterCleanupReload._report.settings.flaggedCount, 0);
      assert.equal(afterCleanupReload._report.settings.ignoredCount, 1);
      assert.equal(afterCleanupReload._report.flags.groupsCount, 1);
      assert.equal(afterCleanupReload._report.uuids.brokenCount, 0);

      // 7. Manual Run Audit triggers executeAudit as expected
      await WaifuAuditApp.DEFAULT_OPTIONS.actions.runAudit.call(afterCleanupReload);
      assert.equal(auditExecutions, 2);
    } finally {
      WaifuAuditApp.prototype.executeAudit = origExecuteAudit;
    }
  } finally {
    globalThis.game = prevGlobals.game;
    globalThis.foundry = prevGlobals.foundry;
    globalThis.fromUuid = prevGlobals.fromUuid;
    globalThis.fromUuidSync = prevGlobals.fromUuidSync;
    globalThis.ui = prevGlobals.ui;
  }
});

test("WaifuEntityAuditApp opens empty by default, scans dropped Folders & Compendiums, and cleans orphans without world audit", async () => {
  const prevGlobals = {
    game: globalThis.game,
    foundry: globalThis.foundry,
    fromUuid: globalThis.fromUuid,
    fromUuidSync: globalThis.fromUuidSync,
    ui: globalThis.ui
  };

  try {
    installAppTestGlobals();

    const embeddedItem = {
      id: "ei1",
      uuid: "Actor.drop1.Item.ei1",
      documentName: "Item",
      name: "Old Relic",
      type: "loot",
      img: "icons/svg/item-bag.svg",
      flags: { "disabled-mod": { tag: "keep-inactive" } },
      effects: [],
      async update(patch) {
        for (const k of Object.keys(patch)) {
          if (k.startsWith("flags.-=")) delete this.flags[k.slice(8)];
        }
      }
    };
    const droppedActor = {
      id: "drop1",
      uuid: "Actor.drop1",
      documentName: "Actor",
      name: "Dropped Hero",
      img: "modules/gone-media/hero.png",
      _stats: { compendiumSource: "Compendium.gone-mod.heroes.Actor.h1" },
      flags: { "gone-mod": { legacyBlob: "abc" } },
      prototypeToken: { flags: {} },
      system: { description: { value: "<p>@UUID[Compendium.gone-mod.spells.Item.s1]{Old Spell}</p>" } },
      items: [embeddedItem],
      effects: [],
      async update(patch) {
        if ("flags.-=gone-mod" in patch) delete this.flags["gone-mod"];
        if ("img" in patch) this.img = patch.img;
        if ("system.description.value" in patch) this.system.description.value = patch["system.description.value"];
        if ("system.==description" in patch) this.system.description = patch["system.==description"];
        if ("==system" in patch) this.system = patch["==system"];
      }
    };
    const subFolder = { id: "f-sub", documentName: "Folder", type: "Actor", name: "Sub", contents: [droppedActor], children: [] };
    const rootFolder = { id: "f-root", uuid: "Folder.f-root", documentName: "Folder", type: "Actor", name: "Heroes", contents: [], children: [{ folder: subFolder }] };
    const packedItem = {
      id: "pk1",
      uuid: "Compendium.old.locked.Item.pk1",
      pack: "old.locked",
      documentName: "Item",
      name: "Locked Sword",
      type: "weapon",
      img: "icons/svg/sword.svg",
      flags: { "gone-mod": { lockedFlag: 1 } },
      effects: []
    };
    const lockedPack = {
      collection: "old.locked",
      documentName: "Item",
      locked: true,
      metadata: { label: "Locked Pack" },
      getDocuments: async () => [packedItem]
    };

    const origFromUuid = globalThis.fromUuid;
    globalThis.fromUuid = async (uuid) => {
      if (uuid === "Folder.f-root") return rootFolder;
      if (uuid === "Actor.drop1") return droppedActor;
      if (uuid === "Actor.drop1.Item.ei1") return embeddedItem;
      return origFromUuid(uuid);
    };
    globalThis.game.packs = new Map([[lockedPack.collection, lockedPack]]);
    globalThis.game.modules = new Map([
      ["waifu", { id: "waifu", active: true }],
      ["disabled-mod", { id: "disabled-mod", active: false }]
    ]);
    globalThis.game.modules[Symbol.iterator] = () => globalThis.game.modules.values();

    const { WaifuEntityAuditApp } = await import("../scripts/app/entity-audit-app.mjs");
    const { WaifuAuditApp } = await import("../scripts/app/audit-app.mjs");

    let worldAuditCalls = 0;
    const origAudit = WaifuAuditApp.prototype.executeAudit;
    WaifuAuditApp.prototype.executeAudit = async function () {
      worldAuditCalls += 1;
    };

    try {
      const entityApp = WaifuEntityAuditApp.openWindow();
      assert.equal(entityApp._entityAudit.hasTargets, false, "Entity audit window must open empty");
      assert.equal(entityApp._entityAudit.report, null);
      const initialCtx = await entityApp._prepareContext({});
      assert.equal(initialCtx.busy, false);
      assert.equal(initialCtx.entityAudit.hasTargets, false);

      // Drop folder (recursive) and locked compendium
      await entityApp.addDropData({ type: "Folder", uuid: "Folder.f-root" });
      await entityApp.addDropData({ type: "Compendium", collection: "old.locked" });

      assert.equal(worldAuditCalls, 0, "Entity drop must never trigger world audit");
      assert.equal(entityApp._entityAudit.targetsCount ?? entityApp._entityAudit.report.targetsCount, 2);
      assert.ok(entityApp._entityAudit.report.findings.some((f) => f.namespace === "gone-mod" && f.canClean));
      assert.ok(entityApp._entityAudit.report.findings.some((f) => f.namespace === "disabled-mod" && f.isInactive));
      assert.ok(entityApp._entityAudit.report.findings.some((f) => f.rootUuid === packedItem.uuid && !f.canClean));
      assert.ok(!entityApp._entityAudit.report.findings.some((f) => f.fieldPath.includes("_stats")));

      const overlayEvents = [];
      const origUpdate = entityApp._updateProgressDom.bind(entityApp);
      entityApp._updateProgressDom = (pct, label, detail = "") => {
        overlayEvents.push({ pct, label, detail });
        return origUpdate(pct, label, detail);
      };

      await WaifuEntityAuditApp.DEFAULT_OPTIONS.actions.cleanAllOrphanEntityFindings.call(entityApp);
      entityApp._updateProgressDom = origUpdate;

      assert.equal(entityApp._busy, false);
      assert.ok(overlayEvents.length >= 1, "Cleaning entities must drive the busy overlay");
      assert.equal(droppedActor.flags["gone-mod"], undefined);
      assert.equal(droppedActor.img, "");
      assert.equal(droppedActor.system.description.value, "<p>Old Spell</p>");
      assert.equal(droppedActor._stats.compendiumSource, "Compendium.gone-mod.heroes.Actor.h1");
      assert.deepEqual(embeddedItem.flags["disabled-mod"], { tag: "keep-inactive" });
      assert.equal(worldAuditCalls, 0);

      // Inactive + locked finding must remain reported
      assert.equal(entityApp._entityAudit.report.findingsCount, 2);
    } finally {
      WaifuAuditApp.prototype.executeAudit = origAudit;
    }
  } finally {
    globalThis.game = prevGlobals.game;
    globalThis.foundry = prevGlobals.foundry;
    globalThis.fromUuid = prevGlobals.fromUuid;
    globalThis.fromUuidSync = prevGlobals.fromUuidSync;
    globalThis.ui = prevGlobals.ui;
  }
});
