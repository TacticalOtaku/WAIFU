import assert from "node:assert/strict";
import test from "node:test";
import { AUDIT_HISTORY_SETTING, IGNORE_RULES_SETTING, MODULE_ID } from "../scripts/constants.mjs";
import {
  archiveAndPruneChatMessages,
  batchPatchUuidOccurrences,
  cleanupRedundantWalls,
  cleanupStaleCombats,
  deleteFlagGroup,
  deleteWorldSettingByKey,
  deleteWorldSettingsBatch,
  disableLightAnimations,
  patchDocumentUuidOccurrence,
  removeOrphanedTokens,
  restoreBackupPayload,
  snapshotWallsForBackup
} from "../scripts/foundry/auto-fixer.mjs";
import { buildCandidateCatalog, runWorldAudit, toggleIgnoreRule } from "../scripts/foundry/world-audit-runner.mjs";

/**
 * Install minimal in-memory Foundry v14 mocks to verify runner + auto-fixer mutations end-to-end.
 */
function setupMockFoundry() {
  const settingsData = new Map([
    [`${MODULE_ID}.maxWalls`, 300],
    [`${MODULE_ID}.maxLights`, 40],
    [`${MODULE_ID}.maxAnimations`, 15],
    [`${MODULE_ID}.nearDuplicateWallTolerance`, 2],
    [`${MODULE_ID}.${IGNORE_RULES_SETTING}`, { scenes: [], settings: [], flags: [], uuids: [] }],
    [`${MODULE_ID}.${AUDIT_HISTORY_SETTING}`, []],
    ["deleted-mod.cachedJson", { blob: "x".repeat(20_000) }],
    ["dnd5e.rules", { version: "5.3.3" }]
  ]);

  const worldStorageDocs = [
    { key: "deleted-mod.cachedJson", value: settingsData.get("deleted-mod.cachedJson") },
    { key: "dnd5e.rules", value: settingsData.get("dnd5e.rules") }
  ];

  const asFoundryCollection = (entries) => {
    const map = new Map(entries);
    map[Symbol.iterator] = () => map.values();
    map.contents = [...map.values()];
    return map;
  };

  const wallsMap = asFoundryCollection([
    ["w1", { id: "w1", c: [0, 0, 100, 0], move: 20, sight: 20, light: 20, sound: 20, door: 0, elevation: 0, levels: ["l1"], toObject: () => ({ _id: "w1", c: [0, 0, 100, 0] }) }],
    ["w2", { id: "w2", c: [0, 0, 100, 0], move: 20, sight: 20, light: 20, sound: 20, door: 0, elevation: 0, levels: ["l1"], toObject: () => ({ _id: "w2", c: [0, 0, 100, 0] }) }],
    ["wZero", { id: "wZero", c: [50, 50, 50, 50], move: 20, sight: 20, light: 20, sound: 20, door: 0, elevation: 0, levels: ["l1"], toObject: () => ({ _id: "wZero", c: [50, 50, 50, 50] }) }]
  ]);
  const lightsMap = asFoundryCollection([
    ["lg1", { id: "lg1", config: { animation: { type: "flame" } } }]
  ]);
  const tokensMap = asFoundryCollection([
    ["tkOrphan", { id: "tkOrphan", actorId: "missing-actor", texture: { src: "" }, light: { animation: { type: "" } } }],
    ["tkValid", { id: "tkValid", actorId: "actor1", texture: { src: "" }, light: { animation: { type: "" } } }]
  ]);

  const sceneObj = {
    id: "sc1",
    uuid: "Scene.sc1",
    name: "Crypt Level Test",
    active: true,
    dimensions: { width: 2000, height: 2000 },
    width: 2000,
    height: 2000,
    background: { src: "" },
    foreground: "",
    weather: "",
    flags: {},
    levels: [{ id: "l1", name: "Ground", background: { src: "" }, foreground: { src: "" } }],
    tiles: [],
    walls: wallsMap,
    lights: lightsMap,
    tokens: tokensMap,
    drawings: [],
    sounds: [],
    notes: [],
    regions: [],
    async deleteEmbeddedDocuments(type, ids) {
      if (type === "Wall") ids.forEach((id) => wallsMap.delete(id));
      if (type === "Token") ids.forEach((id) => tokensMap.delete(id));
    },
    async createEmbeddedDocuments(type, docs) {
      if (type === "Wall") {
        for (const d of docs) {
          const id = d._id || d.id;
          wallsMap.set(id, { ...d, id, toObject: () => d });
        }
      }
    },
    async updateEmbeddedDocuments(type, updates) {
      if (type === "AmbientLight") {
        for (const u of updates) {
          const lt = lightsMap.get(u._id);
          if (lt && "config.animation.type" in u) lt.config.animation.type = u["config.animation.type"];
        }
      }
      if (type === "Wall") {
        for (const u of updates) wallsMap.set(u._id, { ...u, id: u._id, toObject: () => u });
      }
    }
  };

  const pageObj = {
    id: "p1",
    uuid: "JournalEntry.j1.JournalEntryPage.p1",
    name: "Page One",
    text: {
      content: "<p>See @UUID[Actor.missing999]{Hero} and @UUID[Actor.oldHero]{Knight}</p>",
      markdown: ""
    },
    system: {},
    flags: { "deleted-mod": { cached: "data".repeat(1000) } },
    async update(patch) {
      for (const [k, v] of Object.entries(patch)) {
        if (k === "text.content") this.text.content = v;
        if (k.startsWith("flags.-=")) delete this.flags[k.slice(8)];
      }
    }
  };

  const journalObj = {
    id: "j1",
    uuid: "JournalEntry.j1",
    name: "Campaign Journal",
    flags: {},
    pages: [pageObj]
  };

  const actorObj = {
    id: "actor1",
    uuid: "Actor.actor1",
    name: "Knight",
    img: "",
    prototypeToken: { texture: { src: "" } },
    system: {},
    flags: { "deleted-mod": { legacy: "abc".repeat(50) } },
    items: [],
    effects: [],
    async update(patch) {
      for (const [k, v] of Object.entries(patch)) {
        if (k.startsWith("flags.-=")) delete this.flags[k.slice(8)];
        else if (k.startsWith("flags.==")) this.flags[k.slice(8)] = v;
        else if (k.startsWith("flags.")) this.flags[k.slice(6)] = v;
      }
    }
  };

  const combatsList = [
    { id: "cStale", started: false, round: 0, combatants: { size: 0 } },
    { id: "cLive", started: true, round: 1, combatants: { size: 2 } }
  ];
  const messagesList = [
    { id: "m1", timestamp: 1000, speaker: { alias: "A" }, content: "Old", toObject: () => ({ _id: "m1" }) },
    { id: "m2", timestamp: 2000, speaker: { alias: "B" }, content: "New", toObject: () => ({ _id: "m2" }) }
  ];

  const byUuid = new Map([
    [sceneObj.uuid, sceneObj],
    [journalObj.uuid, journalObj],
    [pageObj.uuid, pageObj],
    [actorObj.uuid, actorObj]
  ]);

  globalThis.foundry = {
    utils: {
      deepClone: (v) => structuredClone(v),
      saveDataToFile: () => {}
    }
  };
  globalThis.fromUuid = async (u) => byUuid.get(u) ?? null;
  globalThis.fromUuidSync = (u) => byUuid.get(u) ?? null;
  globalThis.getDocumentClass = (name) => globalThis[name];

  globalThis.Scene = { deleteDocuments: async () => {} };
  globalThis.JournalEntryPage = {};
  globalThis.Setting = {
    create: async ({ key, value }) => {
      const [ns, ...rest] = String(key).split(".");
      await globalThis.game.settings.set(ns, rest.join("."), value);
    }
  };

  const createCollection = (arr, idKey = "id") => {
    const col = [...arr];
    col.get = (id) => arr.find((x) => x[idKey] === id) ?? null;
    col.has = (id) => arr.some((x) => x[idKey] === id);
    col.deleteDocuments = async (ids) => {
      for (const id of ids) {
        const idx = arr.findIndex((x) => x[idKey] === id);
        if (idx >= 0) arr.splice(idx, 1);
      }
      col.length = 0;
      col.push(...arr);
    };
    return col;
  };

  const chatCollection = createCollection(messagesList);
  const combatCollection = createCollection(combatsList);

  globalThis.ChatMessage = {
    deleteDocuments: (ids) => chatCollection.deleteDocuments(ids)
  };
  globalThis.Combat = {
    deleteDocuments: (ids) => combatCollection.deleteDocuments(ids)
  };

  globalThis.game = {
    version: "14.367",
    world: { id: "mock-world", title: "Mock World" },
    system: { id: "dnd5e", version: "5.3.3" },
    modules: asFoundryCollection([["waifu", { id: "waifu", active: true }]]),
    packs: [],
    scenes: createCollection([sceneObj]),
    journal: createCollection([journalObj]),
    actors: createCollection([actorObj]),
    items: createCollection([]),
    tables: createCollection([]),
    macros: createCollection([]),
    cards: createCollection([]),
    playlists: createCollection([]),
    folders: createCollection([]),
    users: createCollection([]),
    combats: combatCollection,
    messages: chatCollection,
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
        if (ns !== MODULE_ID) {
          const existing = worldStorageDocs.find((d) => d.key === `${ns}.${key}`);
          if (existing) existing.value = val;
          else worldStorageDocs.push({ key: `${ns}.${key}`, value: val });
        }
      },
      delete: undefined
    }
  };

  // Expose world setting deletion mock on Setting collection lookup paths if needed
  for (const doc of worldStorageDocs) {
    doc.delete = async () => {
      const idx = worldStorageDocs.indexOf(doc);
      if (idx >= 0) worldStorageDocs.splice(idx, 1);
    };
  }

  return { sceneObj, pageObj, actorObj, wallsMap, lightsMap, tokensMap, worldStorageDocs, chatCollection, combatCollection };
}

test("Foundry v14 runner + auto-fixer integration handles audit, wall/token/light cleanup, @UUID repair, ignore rules, and backup/restore", async () => {
  const prevGlobals = {
    game: globalThis.game,
    foundry: globalThis.foundry,
    fromUuid: globalThis.fromUuid,
    fromUuidSync: globalThis.fromUuidSync,
    getDocumentClass: globalThis.getDocumentClass,
    ChatMessage: globalThis.ChatMessage,
    Combat: globalThis.Combat,
    Setting: globalThis.Setting
  };

  try {
    const mocks = setupMockFoundry();

    // 1. Run full audit against mocked Foundry v14 collections
    const report = await runWorldAudit();
    assert.equal(report.scenes.redundantWallsTotal, 2);
    assert.equal(report.scenes.orphanedTokensTotal, 1);
    assert.equal(report.uuids.brokenCount, 2);
    assert.equal(report.uuids.exactMatchCount, 1);
    assert.equal(report.settings.orphanedCount, 1);
    assert.equal(report.flags.groupsCount, 1);
    assert.equal(report.extras.staleCombatsCount, 1);

    // 2. Snapshot + clean redundant walls, disable light anims, remove orphan tokens
    const wallSnap = snapshotWallsForBackup("sc1", ["w2", "wZero"]);
    assert.equal(wallSnap.walls.length, 2);
    const removedWalls = await cleanupRedundantWalls("sc1", ["w2", "wZero"]);
    assert.equal(removedWalls, 2);
    assert.equal(mocks.wallsMap.size, 1);

    const disabledLights = await disableLightAnimations("sc1", ["lg1"]);
    assert.equal(disabledLights, 1);
    assert.equal(mocks.lightsMap.get("lg1").config.animation.type, null);

    const removedTokens = await removeOrphanedTokens("sc1", ["tkOrphan"]);
    assert.equal(removedTokens, 1);
    assert.equal(mocks.tokensMap.size, 1);

    // 3. Patch matched @UUID & unlink unmatched @UUID
    const knightOcc = report.uuids.items.find((u) => u.label === "Knight");
    const heroOcc = report.uuids.items.find((u) => u.label === "Hero");
    const replaced = await patchDocumentUuidOccurrence(knightOcc, {
      mode: "replace",
      newUuid: knightOcc.bestCandidate.uuid
    });
    assert.equal(replaced, true);
    const unlinked = await batchPatchUuidOccurrences([{ occurrence: heroOcc, action: { mode: "unlink" } }]);
    assert.equal(unlinked, 1);
    assert.equal(mocks.pageObj.text.content, "<p>See Hero and @UUID[Actor.actor1]{Knight}</p>");

    // 4. Clean orphaned settings, flags, stale combats, and prune chat
    await deleteWorldSettingByKey("deleted-mod.cachedJson");
    await deleteWorldSettingsBatch([]);
    const flagGroup = report.flags.groups.find((g) => g.namespace === "deleted-mod");
    await deleteFlagGroup(flagGroup);
    assert.equal(mocks.actorObj.flags["deleted-mod"], undefined);

    const combatsRemoved = await cleanupStaleCombats(["cStale"]);
    assert.equal(combatsRemoved, 1);
    assert.equal(mocks.combatCollection.length, 1);

    const pruned = await archiveAndPruneChatMessages({ keepLast: 1, exportFirst: false });
    assert.equal(pruned.deletedCount, 1);
    assert.equal(mocks.chatCollection.length, 1);

    // 5. Ignore toggle + catalog search + backup/restore round-trip
    assert.equal(await toggleIgnoreRule("scenes", "sc1"), true);
    assert.equal(await toggleIgnoreRule("scenes", "sc1"), false);
    const catalog = buildCandidateCatalog();
    assert.ok(catalog.some((c) => c.uuid === "Actor.actor1"));

    const restored = await restoreBackupPayload({
      settings: [{ key: "deleted-mod.cachedJson", value: { restored: true } }],
      flagsMeta: [{ docUuid: "Actor.actor1", namespace: "deleted-mod", value: { restoredFlag: 1 } }],
      sceneMedia: [],
      deletedWalls: [wallSnap]
    });
    assert.equal(restored.restoredSettings, 1);
    assert.equal(restored.restoredFlags, 1);
    assert.equal(restored.restoredWalls, 2);
    assert.equal(mocks.wallsMap.size, 3);
  } finally {
    globalThis.game = prevGlobals.game;
    globalThis.foundry = prevGlobals.foundry;
    globalThis.fromUuid = prevGlobals.fromUuid;
    globalThis.fromUuidSync = prevGlobals.fromUuidSync;
    globalThis.getDocumentClass = prevGlobals.getDocumentClass;
    globalThis.ChatMessage = prevGlobals.ChatMessage;
    globalThis.Combat = prevGlobals.Combat;
    globalThis.Setting = prevGlobals.Setting;
  }
});
