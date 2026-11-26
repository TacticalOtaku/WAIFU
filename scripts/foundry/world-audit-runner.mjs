import {
  AUDIT_HISTORY_SETTING,
  DEFAULT_IGNORE_RULES,
  DEFAULT_THRESHOLDS,
  IGNORE_RULES_SETTING,
  LAST_AUDIT_REPORT_SETTING,
  MAX_HISTORY_ENTRIES,
  MODULE_ID,
  WORLD_FLAG_COLLECTIONS
} from "../constants.mjs";
import { createAuditReport } from "../core/report.mjs";
import { auditEntityBatch } from "../core/entity-audit.mjs";
import { auditScenes, collectSceneImageSlots } from "../core/scene-audit.mjs";
import {
  auditDocumentFlags,
  auditWorldHealthExtras,
  auditWorldSettings
} from "../core/storage-audit.mjs";
import { extractJournalAnchors, slugifyAnchor, utf8ByteSize } from "../core/utils.mjs";
import { auditUuidReferences } from "../core/uuid-audit.mjs";
import { findUnusedOptimizedFiles, probeMediaBatch } from "./image-tools.mjs";

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
  const readNum = (key, fallback, allowZero = false) => {
    try {
      const value = Number(game.settings.get(MODULE_ID, key));
      if (!Number.isFinite(value)) return fallback;
      if (allowZero ? value >= 0 : value > 0) return value;
      return fallback;
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
    maxAssetBytes: readNum("maxAssetBytes", DEFAULT_THRESHOLDS.maxAssetBytes),
    maxWalls: readNum("maxWalls", DEFAULT_THRESHOLDS.maxWalls),
    maxLights: readNum("maxLights", DEFAULT_THRESHOLDS.maxLights),
    maxAnimations: readNum("maxAnimations", DEFAULT_THRESHOLDS.maxAnimations),
    nearDuplicateWallTolerance: readNum(
      "nearDuplicateWallTolerance",
      DEFAULT_THRESHOLDS.nearDuplicateWallTolerance,
      true
    ),
    maxSettingBytes: readNum("maxSettingBytes", DEFAULT_THRESHOLDS.maxSettingBytes),
    maxFlagBytes: readNum("maxFlagBytes", DEFAULT_THRESHOLDS.maxFlagBytes),
    webpQuality: readNum("webpQuality", DEFAULT_THRESHOLDS.webpQuality),
    downscaleOnConvert: readBool("downscaleOnConvert", DEFAULT_THRESHOLDS.downscaleOnConvert),
    skipLargerWebp: readBool("skipLargerWebp", DEFAULT_THRESHOLDS.skipLargerWebp),
    uuidMinAutoConfidence: readNum(
      "uuidMinAutoConfidence",
      DEFAULT_THRESHOLDS.uuidMinAutoConfidence
    ),
    maxChatMessages: readNum("maxChatMessages", DEFAULT_THRESHOLDS.maxChatMessages),
    includeChatMessages: readBool("includeChatMessages", false)
  };
}

/**
 * Read persisted ignore/whitelist rules from hidden world setting.
 * @returns {{ scenes: string[], settings: string[], flags: string[], uuids: string[] }}
 */
export function readIgnoreRules() {
  try {
    const raw = game.settings.get(MODULE_ID, IGNORE_RULES_SETTING) ?? {};
    return {
      scenes: Array.isArray(raw.scenes) ? [...raw.scenes] : [],
      settings: Array.isArray(raw.settings) ? [...raw.settings] : [],
      flags: Array.isArray(raw.flags) ? [...raw.flags] : [],
      uuids: Array.isArray(raw.uuids) ? [...raw.uuids] : []
    };
  } catch {
    return { ...DEFAULT_IGNORE_RULES };
  }
}

/**
 * Toggle an ID inside the ignore/whitelist setting for a domain category.
 * @param {"scenes" | "settings" | "flags" | "uuids"} category
 * @param {string} id
 * @returns {Promise<boolean>} true if added, false if removed
 */
export async function toggleIgnoreRule(category, id) {
  const rules = readIgnoreRules();
  if (!Array.isArray(rules[category]) || !id) return false;
  const idx = rules[category].indexOf(id);
  let added = false;
  if (idx >= 0) {
    rules[category].splice(idx, 1);
  } else {
    rules[category].push(id);
    added = true;
  }
  await game.settings.set(MODULE_ID, IGNORE_RULES_SETTING, rules);
  return added;
}

/**
 * Add or remove multiple IDs inside the ignore/whitelist setting for a domain category.
 * @param {"scenes" | "settings" | "flags" | "uuids"} category
 * @param {string[]} ids
 * @param {boolean} ignored
 * @returns {Promise<number>} number of changed entries
 */
export async function setIgnoreRules(category, ids, ignored = true) {
  const rules = readIgnoreRules();
  if (!Array.isArray(rules[category]) || !Array.isArray(ids) || !ids.length) return 0;
  const set = new Set(rules[category]);
  let changed = 0;
  for (const id of ids) {
    if (!id) continue;
    if (ignored) {
      if (!set.has(id)) {
        set.add(id);
        changed += 1;
      }
    } else if (set.delete(id)) {
      changed += 1;
    }
  }
  if (!changed) return 0;
  rules[category] = [...set];
  await game.settings.set(MODULE_ID, IGNORE_RULES_SETTING, rules);
  return changed;
}

/**
 * Read persisted compact audit history entries.
 * @returns {Array<Object>}
 */
export function readAuditHistory() {
  try {
    const raw = game.settings.get(MODULE_ID, AUDIT_HISTORY_SETTING);
    return Array.isArray(raw) ? [...raw] : [];
  } catch {
    return [];
  }
}

/**
 * Read the last persisted audit report from hidden world settings.
 * @returns {Object | null}
 */
export function readLastAuditReport() {
  try {
    const raw = game.settings.get(MODULE_ID, LAST_AUDIT_REPORT_SETTING);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (!raw.generatedAt || !raw.summary || !raw.scenes || !raw.uuids || !raw.settings || !raw.flags) {
      return null;
    }
    return typeof foundry?.utils?.deepClone === "function"
      ? foundry.utils.deepClone(raw)
      : structuredClone(raw);
  } catch {
    return null;
  }
}

/**
 * Persist the latest audit report into hidden world settings so it survives reloads/re-logins.
 * @param {Object | null} report
 * @returns {Promise<boolean>}
 */
export async function saveLastAuditReport(report) {
  try {
    const payload = report ? JSON.parse(JSON.stringify(report)) : null;
    await game.settings.set(MODULE_ID, LAST_AUDIT_REPORT_SETTING, payload);
    return true;
  } catch (error) {
    console.warn("WAIFU | Failed to persist last audit report", error);
    return false;
  }
}

async function appendAuditHistorySnapshot(entry) {
  try {
    const existing = readAuditHistory();
    const next = [...existing, entry].slice(-MAX_HISTORY_ENTRIES);
    await game.settings.set(MODULE_ID, AUDIT_HISTORY_SETTING, next);
    return next;
  } catch {
    return [entry];
  }
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
      actorId: token.actorId ?? null,
      actorExists: !token.actorId || Boolean(game.actors?.has?.(token.actorId)),
      textureSrc: token.texture?.src || "",
      lightAnimationType: token.light?.animation?.type || ""
    }));

    const drawings = [...(scene.drawings ?? [])].map((drawing) => ({
      id: drawing.id,
      src: drawing.texture?.src || ""
    }));

    const sounds = [...(scene.sounds ?? [])].map((s) => ({
      id: s.id,
      path: s.path || ""
    }));

    const notes = [...(scene.notes ?? [])].map((n) => ({
      id: n.id,
      uuid: n.uuid,
      label: n.label || n.text || n.id,
      text: n.text || "",
      journalTarget:
        n.entryId && n.pageId
          ? `JournalEntry.${n.entryId}.JournalEntryPage.${n.pageId}`
          : n.entryId
            ? `JournalEntry.${n.entryId}`
            : ""
    }));

    const regions = [...(scene.regions ?? [])].map((r) => ({
      id: r.id,
      uuid: r.uuid,
      name: r.name || r.id,
      behaviors: [...(r.behaviors ?? [])].map((b) => toPlain(b) ?? {}),
      flags: foundry.utils.deepClone(r.flags ?? {})
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
      flags: foundry.utils.deepClone(scene.flags ?? {}),
      levels,
      tiles,
      walls,
      lights,
      tokens,
      drawings,
      sounds,
      notes,
      regions
    });
  }
  return snapshots;
}

function buildExtendedWorldDocs(sceneSnapshots) {
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

  const items = [...(game.items ?? [])].map((item) => ({
    id: item.id,
    uuid: item.uuid,
    name: item.name || item.id,
    system: toPlain(item.system) ?? {},
    flags: foundry.utils.deepClone(item.flags ?? {})
  }));

  const tables = [...(game.tables ?? [])].map((table) => ({
    id: table.id,
    uuid: table.uuid,
    name: table.name || table.id,
    description: table.description ?? "",
    flags: foundry.utils.deepClone(table.flags ?? {}),
    results: [...(table.results ?? [])].map((r) => ({
      id: r.id,
      uuid: r.uuid,
      name: r.name || r.text || r.id,
      text: r.text ?? "",
      description: r.description ?? "",
      documentUuid: r.documentUuid ?? ""
    }))
  }));

  const macros = [...(game.macros ?? [])].map((macro) => ({
    id: macro.id,
    uuid: macro.uuid,
    name: macro.name || macro.id,
    command: macro.command ?? "",
    flags: foundry.utils.deepClone(macro.flags ?? {})
  }));

  return {
    journals,
    actors,
    items,
    tables,
    macros,
    scenes: sceneSnapshots
  };
}

function collectExtraMediaEntries(sceneSnapshots) {
  const entries = [];
  const referencedPaths = new Set();
  const track = (docType, docUuid, docName, field, src) => {
    if (!src || typeof src !== "string") return;
    referencedPaths.add(src);
    entries.push({ docType, docUuid, docName, field, src });
  };

  for (const sc of sceneSnapshots) {
    for (const slot of collectSceneImageSlots(sc)) {
      referencedPaths.add(slot.src);
    }
    for (const t of sc.tokens ?? []) {
      if (t.textureSrc) referencedPaths.add(t.textureSrc);
    }
    for (const d of sc.drawings ?? []) {
      if (d.src) referencedPaths.add(d.src);
    }
    for (const s of sc.sounds ?? []) {
      if (s.path) referencedPaths.add(s.path);
    }
  }

  for (const actor of game.actors ?? []) {
    if (actor.img) track("Actor", actor.uuid, actor.name || actor.id, "img", actor.img);
    const protoSrc = actor.prototypeToken?.texture?.src;
    if (protoSrc) {
      track("Actor", actor.uuid, actor.name || actor.id, "prototypeToken.texture.src", protoSrc);
    }
  }

  for (const item of game.items ?? []) {
    if (item.img) track("Item", item.uuid, item.name || item.id, "img", item.img);
  }

  for (const playlist of game.playlists ?? []) {
    for (const sound of playlist.sounds ?? []) {
      if (sound.path) {
        track(
          "PlaylistSound",
          sound.uuid || playlist.uuid,
          `${playlist.name} › ${sound.name || sound.id}`,
          "path",
          sound.path
        );
      }
    }
  }

  return { entries, referencedPaths };
}

/**
 * Build searchable candidate catalog across all world documents and loaded compendium packs.
 * @returns {Array<Object>}
 */
export function buildCandidateCatalog() {
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
 * @param {{ signal?: AbortSignal, onProgress?: (info: { phase: string, completed?: number, total?: number, detail?: string }) => void, recordHistory?: boolean }} runtimeOptions
 * @returns {Promise<Object>}
 */
export async function runWorldAudit(overrides = {}, runtimeOptions = {}) {
  const startedAt = performance.now();
  const thresholds = { ...readThresholdSettings(), ...overrides };
  const ignoreRules = readIgnoreRules();
  const signal = runtimeOptions?.signal;
  const onProgress =
    typeof runtimeOptions?.onProgress === "function" ? runtimeOptions.onProgress : null;

  const activeModuleIds = new Set();
  const installedModuleIds = new Set();
  for (const mod of game.modules ?? []) {
    installedModuleIds.add(mod.id);
    if (mod.active) activeModuleIds.add(mod.id);
  }

  onProgress?.({ phase: "scenes" });
  const sceneSnapshots = buildSceneSnapshots();
  const extraMedia = collectExtraMediaEntries(sceneSnapshots);
  const uniqueSources = new Set();
  for (const sc of sceneSnapshots) {
    for (const slot of collectSceneImageSlots(sc)) {
      uniqueSources.add(slot.src);
    }
    for (const t of sc.tokens ?? []) {
      if (t.textureSrc) uniqueSources.add(t.textureSrc);
    }
    for (const d of sc.drawings ?? []) {
      if (d.src) uniqueSources.add(d.src);
    }
    for (const s of sc.sounds ?? []) {
      if (s.path) uniqueSources.add(s.path);
    }
  }
  for (const entry of extraMedia.entries) {
    uniqueSources.add(entry.src);
  }

  const assetMetaMap = await probeMediaBatch(uniqueSources, {
    concurrency: 6,
    signal,
    onProgress: (info) =>
      onProgress?.({
        phase: "media",
        completed: info.completed,
        total: info.total,
        detail: info.src
      })
  });

  if (signal?.aborted) {
    throw new DOMException("Audit aborted", "AbortError");
  }

  const scenesReport = auditScenes(sceneSnapshots, assetMetaMap, {
    ...thresholds,
    ignoredSceneIds: new Set(ignoreRules.scenes)
  });

  onProgress?.({ phase: "uuids" });
  const worldDocs = buildExtendedWorldDocs(sceneSnapshots);
  const catalog = buildCandidateCatalog();
  const uuidsReport = await auditUuidReferences(worldDocs, {
    catalog,
    ignoredOccurrenceIds: new Set(ignoreRules.uuids),
    minAutoConfidence: thresholds.uuidMinAutoConfidence,
    hasPack: (packId) => Boolean(game.packs?.has?.(packId)),
    resolveUuid: async (uuid) => {
      try {
        const doc = await fromUuid(uuid);
        return Boolean(doc);
      } catch {
        return false;
      }
    },
    resolveAnchor: async (uuid, anchor) => {
      try {
        const doc = await fromUuid(uuid);
        if (!doc) return null;
        const html = doc.text?.content ?? "";
        const md = doc.text?.markdown ?? "";
        if (!html && !md) return null;
        const anchors = extractJournalAnchors(html, md);
        const slug = slugifyAnchor(anchor);
        if (anchors.has(anchor) || anchors.has(anchor.toLowerCase()) || (slug && anchors.has(slug))) {
          return true;
        }
        const suggestions = [...anchors].filter((a) => a === slugifyAnchor(a) && a.length >= 2);
        return { valid: false, suggestions };
      } catch {
        return null;
      }
    }
  });

  onProgress?.({ phase: "storage" });
  const packageContext = {
    activeModuleIds,
    installedModuleIds,
    systemId: game.system?.id ?? "",
    maxSettingBytes: thresholds.maxSettingBytes,
    maxFlagBytes: thresholds.maxFlagBytes,
    ignoredSettingKeys: new Set(ignoreRules.settings),
    ignoredFlagNamespaces: new Set(ignoreRules.flags)
  };

  const settingsReport = auditWorldSettings(collectWorldSettingsSnapshot(), packageContext);
  const flagsReport = auditDocumentFlags(
    collectWorldFlagEntries(thresholds.includeChatMessages),
    packageContext
  );

  // Extras: Chat Log, Combats, Non-Scene Broken 404 Media, Unused waifu-optimized files
  const chatMessages = [...(game.messages ?? [])];
  let chatBytes = 0;
  for (const msg of chatMessages) {
    chatBytes += utf8ByteSize(msg.content ?? "") + utf8ByteSize(msg.flags ?? {});
  }
  const combats = [...(game.combats ?? [])].map((c) => ({
    id: c.id,
    started: Boolean(c.started),
    round: Number(c.round) || 0,
    combatantsCount: c.combatants?.size ?? 0,
    sceneName: c.scene?.name ?? "Global"
  }));
  const brokenMedia = [];
  const seenBroken = new Set();
  for (const entry of extraMedia.entries) {
    const meta = assetMetaMap.get(entry.src);
    if (meta?.missing) {
      const key = `${entry.docUuid}::${entry.field}::${entry.src}`;
      if (seenBroken.has(key)) continue;
      seenBroken.add(key);
      brokenMedia.push({ ...entry, statusCode: meta.statusCode });
    }
  }
  const worldId = game.world?.id ?? "world";
  const unusedOptimizedFiles = await findUnusedOptimizedFiles(worldId, extraMedia.referencedPaths);

  const extras = auditWorldHealthExtras({
    chatMessagesCount: chatMessages.length,
    chatBytes,
    maxChatMessages: thresholds.maxChatMessages,
    combats,
    brokenMedia,
    unusedOptimizedFiles
  });

  const durationMs = Math.round(performance.now() - startedAt);
  const meta = {
    worldId,
    worldTitle: game.world?.title ?? "Foundry World",
    systemId: game.system?.id ?? "",
    systemVersion: game.system?.version ?? "",
    foundryVersion: game.version ?? "",
    activeModulesCount: activeModuleIds.size,
    installedModulesCount: installedModuleIds.size,
    durationMs
  };

  let history = readAuditHistory();
  const draftReport = createAuditReport({
    meta,
    thresholds,
    scenes: scenesReport,
    uuids: uuidsReport,
    settings: settingsReport,
    flags: flagsReport,
    extras,
    history
  });

  if (runtimeOptions?.recordHistory !== false && Object.keys(overrides).length === 0) {
    history = await appendAuditHistorySnapshot({
      generatedAt: draftReport.generatedAt,
      healthScore: draftReport.summary.healthScore,
      totalIssues: draftReport.summary.totalIssues,
      reclaimableBytes: draftReport.statistics.storageStats.totalReclaimableBytes
    });
    const finalReport = createAuditReport({
      meta,
      thresholds,
      scenes: scenesReport,
      uuids: uuidsReport,
      settings: settingsReport,
      flags: flagsReport,
      extras,
      history
    });
    if (runtimeOptions?.persistReport !== false) {
      await saveLastAuditReport(finalReport);
    }
    return finalReport;
  }

  return draftReport;
}

/**
 * Build active/installed package sets and thresholds for entity JSON auditing.
 * @returns {{ activeModuleIds: Set<string>, installedModuleIds: Set<string>, systemId: string, maxFlagBytes: number }}
 */
export function getPackageAuditContext() {
  const thresholds = readThresholdSettings();
  const activeModuleIds = new Set();
  const installedModuleIds = new Set();
  for (const mod of game.modules ?? []) {
    installedModuleIds.add(mod.id);
    if (mod.active) activeModuleIds.add(mod.id);
  }
  return {
    activeModuleIds,
    installedModuleIds,
    systemId: game.system?.id ?? "",
    maxFlagBytes: thresholds.maxFlagBytes
  };
}

/**
 * Convert a live Foundry Actor or Item document into a normalized plain JSON snapshot for auditing.
 * @param {Object} doc
 * @param {string | null} sourceLabel
 * @returns {Object | null}
 */
export function snapshotEntityDocument(doc, sourceLabel = null) {
  if (!doc) return null;
  let plain;
  if (typeof doc.toObject === "function") {
    plain = doc.toObject();
  } else {
    try {
      plain =
        typeof foundry?.utils?.deepClone === "function"
          ? foundry.utils.deepClone(doc)
          : structuredClone(doc);
    } catch {
      plain = JSON.parse(JSON.stringify(doc));
    }
  }

  const pack = doc.pack ? game.packs?.get?.(doc.pack) : null;
  return {
    ...plain,
    id: doc.id || plain._id,
    uuid: doc.uuid,
    docType: doc.documentName || (Array.isArray(plain.items) ? "Actor" : "Item"),
    name: doc.name || plain.name || doc.id || doc.uuid,
    isCompendium: Boolean(doc.pack),
    isLocked: Boolean(pack?.locked),
    sourceLabel: sourceLabel || pack?.metadata?.label || (doc.pack ? doc.pack : "World")
  };
}

/**
 * Recursively collect all documents inside a Foundry Folder and all nested child folders.
 * @param {Object} folder
 * @param {Set<string>} visited
 * @returns {Array<Object>}
 */
export function collectFolderDocuments(folder, visited = new Set()) {
  if (!folder || visited.has(folder.id)) return [];
  visited.add(folder.id);

  const docs = [...(folder.contents ?? [])];
  for (const child of folder.children ?? []) {
    const childFolder = child?.folder ?? child;
    if (childFolder) {
      docs.push(...collectFolderDocuments(childFolder, visited));
    }
  }
  return docs;
}

/**
 * Audit an array of Foundry Actor/Item documents for unused flags and residual module strings.
 * @param {Array<{ doc: Object, sourceLabel?: string }>} entries
 * @param {{ signal?: AbortSignal, onProgress?: (info: { current: number, total: number, doc: Object }) => void }} options
 * @returns {Object}
 */
export function auditEntityDocuments(entries = [], options = {}) {
  const signal = options?.signal;
  const onProgress = typeof options?.onProgress === "function" ? options.onProgress : null;
  const context = getPackageAuditContext();
  const snapshots = [];
  const list = entries ?? [];

  for (let i = 0; i < list.length; i += 1) {
    if (signal?.aborted) {
      throw new DOMException("Entity audit aborted", "AbortError");
    }
    const item = list[i];
    const doc = item?.doc ?? item;
    if (!doc) continue;
    onProgress?.({ current: i + 1, total: list.length, doc });
    const snap = snapshotEntityDocument(doc, item?.sourceLabel ?? null);
    if (snap) snapshots.push(snap);
  }

  return auditEntityBatch(snapshots, context);
}
