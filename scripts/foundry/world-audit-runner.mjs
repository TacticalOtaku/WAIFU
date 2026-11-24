import { DEFAULT_THRESHOLDS, MODULE_ID, WORLD_FLAG_COLLECTIONS } from "../constants.mjs";
import { createAuditReport } from "../core/report.mjs";
import { auditScenes, collectSceneImageSlots } from "../core/scene-audit.mjs";
import { auditDocumentFlags, auditWorldSettings } from "../core/storage-audit.mjs";
import { auditUuidReferences } from "../core/uuid-audit.mjs";
import { probeMediaBatch } from "./image-tools.mjs";

const EMBEDDED_FLAG_COLLECTIONS = [
  "levels",
  "tiles",
  "walls",
  "lights",
  "sounds",
  "tokens",
  "drawings",
  "notes",
  "regions",
  "items",
  "effects",
  "pages",
  "results",
  "cards",
  "combatants"
];

/**
 * Read current WAIFU threshold settings from Foundry game.settings.
 * @returns {Object}
 */
export function readThresholdSettings() {
  const readNum = (key, fallback) => {
    try {
      const value = Number(game.settings.get(MODULE_ID, key));
      return Number.isFinite(value) && value > 0 ? value : fallback;
    } catch {
      return fallback;
    }
  };
  const readBool = (key, fallback) => {
    try {
      return Boolean(game.settings.get(MODULE_ID, key));
    } catch {
      return fallback;
    }
  };

  return {
    maxTextureResolution: readNum("maxTextureResolution", DEFAULT_THRESHOLDS.maxTextureResolution),
    maxMegapixels: readNum("maxMegapixels", DEFAULT_THRESHOLDS.maxMegapixels),
    maxWalls: readNum("maxWalls", DEFAULT_THRESHOLDS.maxWalls),
    maxLights: readNum("maxLights", DEFAULT_THRESHOLDS.maxLights),
    maxAnimations: readNum("maxAnimations", DEFAULT_THRESHOLDS.maxAnimations),
    maxSettingBytes: readNum("maxSettingBytes", DEFAULT_THRESHOLDS.maxSettingBytes),
    maxFlagBytes: readNum("maxFlagBytes", DEFAULT_THRESHOLDS.maxFlagBytes),
    webpQuality: readNum("webpQuality", DEFAULT_THRESHOLDS.webpQuality),
    downscaleOnConvert: readBool("downscaleOnConvert", DEFAULT_THRESHOLDS.downscaleOnConvert),
    includeChatMessages: readBool("includeChatMessages", false)
  };
}

function toPlain(value) {
  if (!value) return value;
  if (typeof value.toObject === "function") return value.toObject();
  return value;
}

function buildSceneSnapshots() {
  const snapshots = [];
  for (const scene of game.scenes ?? []) {
    const levels = [];
    for (const level of scene.levels ?? []) {
      levels.push({
        id: level.id,
        name: level.name || level.id,
        backgroundSrc: level.background?.src || "",
        foregroundSrc: level.foreground?.src || "",
        width: scene.dimensions?.width || scene.width || 0,
        height: scene.dimensions?.height || scene.height || 0
      });
    }

    const foregroundSrc =
      typeof scene.foreground === "string"
        ? scene.foreground
        : scene.foreground?.src || "";

    const tiles = [...(scene.tiles ?? [])].map((tile) => ({
      id: tile.id,
      src: tile.texture?.src || "",
      width: tile.width || 0,
      height: tile.height || 0,
      levelId: tile.level ?? tile.levels?.[0] ?? null
    }));

    const walls = [...(scene.walls ?? [])].map((wall) => ({
      id: wall.id,
      c: Array.isArray(wall.c) ? [...wall.c] : [],
      move: wall.move,
      sight: wall.sight,
      light: wall.light,
      sound: wall.sound,
      door: wall.door,
      elevation: wall.elevation ?? null,
      levels: wall.levels ? [...wall.levels] : []
    }));

    const lights = [...(scene.lights ?? [])].map((light) => ({
      id: light.id,
      animationType: light.config?.animation?.type || ""
    }));

    const tokens = [...(scene.tokens ?? [])].map((token) => ({
      id: token.id,
      textureSrc: token.texture?.src || "",
      lightAnimationType: token.light?.animation?.type || ""
    }));

    const drawings = [...(scene.drawings ?? [])].map((drawing) => ({
      id: drawing.id,
      src: drawing.texture?.src || ""
    }));

    snapshots.push({
      id: scene.id,
      uuid: scene.uuid,
      name: scene.name || scene.id,
      active: Boolean(scene.active),
      width: scene.dimensions?.width || scene.width || 0,
      height: scene.dimensions?.height || scene.height || 0,
      backgroundSrc: scene.background?.src || "",
      foregroundSrc,
      weather: scene.weather || "",
      levels,
      tiles,
      walls,
      lights,
      tokens,
      drawings,
      sounds: [...(scene.sounds ?? [])].map((s) => ({ id: s.id })),
      regions: [...(scene.regions ?? [])].map((r) => ({ id: r.id }))
    });
  }
  return snapshots;
}

function buildJournalAndActorSnapshots() {
  const journals = [];
  for (const journal of game.journal ?? []) {
    const pages = [...(journal.pages ?? [])].map((page) => ({
      id: page.id,
      uuid: page.uuid,
      name: page.name || page.id,
      text: {
        content: page.text?.content ?? "",
        markdown: page.text?.markdown ?? ""
      },
      system: toPlain(page.system) ?? {},
      flags: foundry.utils.deepClone(page.flags ?? {})
    }));

    journals.push({
      id: journal.id,
      uuid: journal.uuid,
      name: journal.name || journal.id,
      flags: foundry.utils.deepClone(journal.flags ?? {}),
      pages
    });
  }

  const actors = [];
  for (const actor of game.actors ?? []) {
    const items = [...(actor.items ?? [])].map((item) => ({
      id: item.id,
      uuid: item.uuid,
      name: item.name || item.id,
      system: toPlain(item.system) ?? {},
      flags: foundry.utils.deepClone(item.flags ?? {})
    }));

    const effects = [...(actor.effects ?? [])].map((effect) => ({
      id: effect.id,
      uuid: effect.uuid,
      name: effect.name || effect.id,
      description: effect.description ?? "",
      flags: foundry.utils.deepClone(effect.flags ?? {})
    }));

    actors.push({
      id: actor.id,
      uuid: actor.uuid,
      name: actor.name || actor.id,
      system: toPlain(actor.system) ?? {},
      flags: foundry.utils.deepClone(actor.flags ?? {}),
      items,
      effects
    });
  }

  return { journals, actors };
}

function buildCandidateCatalog() {
  const catalog = [];

  const addWorldCollection = (collection, docType) => {
    for (const doc of collection ?? []) {
      catalog.push({
        uuid: doc.uuid,
        name: doc.name || doc.id,
        docType,
        sourceLabel: "World",
        isCompendium: false
      });
    }
  };

  addWorldCollection(game.actors, "Actor");
  addWorldCollection(game.items, "Item");
  addWorldCollection(game.scenes, "Scene");
  addWorldCollection(game.tables, "RollTable");
  addWorldCollection(game.macros, "Macro");
  addWorldCollection(game.playlists, "Playlist");
  addWorldCollection(game.cards, "Cards");

  for (const journal of game.journal ?? []) {
    catalog.push({
      uuid: journal.uuid,
      name: journal.name || journal.id,
      docType: "JournalEntry",
      sourceLabel: "World",
      isCompendium: false
    });
    for (const page of journal.pages ?? []) {
      catalog.push({
        uuid: page.uuid,
        name: page.name || page.id,
        docType: "JournalEntryPage",
        sourceLabel: `Journal: ${journal.name}`,
        isCompendium: false
      });
    }
  }

  for (const pack of game.packs ?? []) {
    if (!pack?.index?.size) continue;
    const packTitle = pack.metadata?.label || pack.collection;
    const docType = pack.documentName;
    for (const entry of pack.index) {
      if (!entry?.name || !entry?._id) continue;
      const uuid = entry.uuid || `Compendium.${pack.collection}.${docType}.${entry._id}`;
      catalog.push({
        uuid,
        name: entry.name,
        docType,
        sourceLabel: packTitle,
        isCompendium: true
      });
    }
  }

  return catalog;
}

function collectWorldSettingsSnapshot() {
  const worldStorage = game.settings?.storage?.get?.("world");
  if (!worldStorage) return [];

  const entries = [];
  const items = worldStorage.contents ?? [...worldStorage.values()];
  for (const setting of items) {
    if (!setting?.key) continue;
    entries.push({
      id: setting.id,
      key: setting.key,
      value: setting.value
    });
  }
  return entries;
}

function collectWorldFlagEntries(includeChatMessages = false) {
  const entries = [];
  const collections = [...WORLD_FLAG_COLLECTIONS];
  if (includeChatMessages) collections.push("messages");

  const extractDocFlags = (doc, parentDoc = null) => {
    const flags = doc?.flags;
    if (!flags || typeof flags !== "object") return;
    for (const [namespace, value] of Object.entries(flags)) {
      if (value === undefined || value === null) continue;
      if (typeof value === "object" && Object.keys(value).length === 0) continue;
      entries.push({
        docType: doc.documentName || doc.constructor?.name || "Document",
        docId: doc.id,
        docName: doc.name || doc.title || doc.id,
        docUuid: doc.uuid,
        parentName: parentDoc ? parentDoc.name || parentDoc.id : null,
        parentUuid: parentDoc ? parentDoc.uuid : null,
        namespace,
        value
      });
    }
  };

  for (const colName of collections) {
    const collection = game[colName];
    if (!collection) continue;
    for (const doc of collection) {
      extractDocFlags(doc, null);
      for (const embName of EMBEDDED_FLAG_COLLECTIONS) {
        const embedded = doc[embName];
        if (!embedded || typeof embedded[Symbol.iterator] !== "function") continue;
        for (const child of embedded) {
          extractDocFlags(child, doc);
        }
      }
    }
  }

  return entries;
}

/**
 * Run a complete Foundry v14 world audit and return the structured report.
 * @param {Partial<typeof DEFAULT_THRESHOLDS> & { includeChatMessages?: boolean }} overrides
 * @returns {Promise<Object>}
 */
export async function runWorldAudit(overrides = {}) {
  const startedAt = performance.now();
  const thresholds = { ...readThresholdSettings(), ...overrides };

  const activeModuleIds = new Set();
  const installedModuleIds = new Set();
  for (const mod of game.modules ?? []) {
    installedModuleIds.add(mod.id);
    if (mod.active) activeModuleIds.add(mod.id);
  }

  const sceneSnapshots = buildSceneSnapshots();
  const uniqueSources = new Set();
  for (const sc of sceneSnapshots) {
    for (const slot of collectSceneImageSlots(sc)) {
      uniqueSources.add(slot.src);
    }
  }
  const assetMetaMap = await probeMediaBatch(uniqueSources);
  const scenesReport = auditScenes(sceneSnapshots, assetMetaMap, thresholds);

  const worldDocs = buildJournalAndActorSnapshots();
  const catalog = buildCandidateCatalog();
  const uuidsReport = await auditUuidReferences(worldDocs, {
    catalog,
    hasPack: (packId) => Boolean(game.packs?.has?.(packId)),
    resolveUuid: async (uuid) => {
      try {
        const doc = await fromUuid(uuid);
        return Boolean(doc);
      } catch {
        return false;
      }
    }
  });

  const packageContext = {
    activeModuleIds,
    installedModuleIds,
    systemId: game.system?.id ?? "",
    maxSettingBytes: thresholds.maxSettingBytes,
    maxFlagBytes: thresholds.maxFlagBytes
  };

  const settingsReport = auditWorldSettings(collectWorldSettingsSnapshot(), packageContext);
  const flagsReport = auditDocumentFlags(
    collectWorldFlagEntries(thresholds.includeChatMessages),
    packageContext
  );

  const durationMs = Math.round(performance.now() - startedAt);
  const meta = {
    worldId: game.world?.id ?? "world",
    worldTitle: game.world?.title ?? "Foundry World",
    systemId: game.system?.id ?? "",
    systemVersion: game.system?.version ?? "",
    foundryVersion: game.version ?? "",
    activeModulesCount: activeModuleIds.size,
    installedModulesCount: installedModuleIds.size,
    durationMs
  };

  return createAuditReport({
    meta,
    thresholds,
    scenes: scenesReport,
    uuids: uuidsReport,
    settings: settingsReport,
    flags: flagsReport
  });
}
