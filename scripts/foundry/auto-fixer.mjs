import { escapeHtml, formatBytes } from "../core/utils.mjs";
import { applyPatchAtPath } from "../core/uuid-audit.mjs";
import { convertAndUploadWebp } from "./image-tools.mjs";

/**
 * Update a single Scene / Level / Tile image path in Foundry v14.
 * @param {Scene} scene
 * @param {Object} asset
 * @param {string} targetPath
 */
async function updateSceneSlotPath(scene, asset, targetPath) {
  if (asset.slotType === "level-background" && asset.levelId) {
    await scene.updateEmbeddedDocuments("Level", [
      { _id: asset.levelId, "background.src": targetPath }
    ]);
    return;
  }
  if (asset.slotType === "level-foreground" && asset.levelId) {
    await scene.updateEmbeddedDocuments("Level", [
      { _id: asset.levelId, "foreground.src": targetPath }
    ]);
    return;
  }
  if (asset.slotType === "scene-background") {
    await scene.update({ "background.src": targetPath });
    return;
  }
  if (asset.slotType === "scene-foreground") {
    await scene.update({ foreground: targetPath });
    return;
  }
  if (asset.slotType === "tile" && asset.tileId) {
    await scene.updateEmbeddedDocuments("Tile", [
      { _id: asset.tileId, "texture.src": targetPath }
    ]);
  }
}

/**
 * Convert one or more scene/tile raster assets to WebP (deduplicated by source path),
 * supporting progress callbacks, cancellation, and size-regression skipping.
 * @param {Array<Object>} assets
 * @param {{ webpQuality?: number, maxTextureResolution?: number, downscaleOnConvert?: boolean, skipLargerWebp?: boolean }} thresholds
 * @param {{ signal?: AbortSignal, onProgress?: (info: { current: number, total: number, src: string }) => void }} options
 * @returns {Promise<{ convertedCount: number, skippedCount: number, savedBytes: number, formattedSaved: string, changedSlots: Array<Object>, failures: Array<{ src: string, error: string }>, aborted: boolean }>}
 */
export async function convertSceneAssetsToWebp(assets, thresholds, options = {}) {
  const worldId = game.world?.id ?? "world";
  const signal = options?.signal;
  const onProgress = typeof options?.onProgress === "function" ? options.onProgress : null;
  const bySource = new Map();
  for (const asset of assets ?? []) {
    if (!asset?.canAutoConvert || !asset?.src) continue;
    if (!bySource.has(asset.src)) bySource.set(asset.src, []);
    bySource.get(asset.src).push(asset);
  }

  let convertedCount = 0;
  let skippedCount = 0;
  let savedBytes = 0;
  let aborted = false;
  const changedSlots = [];
  const failures = [];
  const total = bySource.size;
  let current = 0;

  for (const [src, usages] of bySource.entries()) {
    if (signal?.aborted) {
      aborted = true;
      break;
    }
    current += 1;
    onProgress?.({ current, total, src });
    try {
      const uploaded = await convertAndUploadWebp(src, {
        worldId,
        quality: thresholds.webpQuality,
        maxResolution: thresholds.maxTextureResolution,
        downscale: thresholds.downscaleOnConvert,
        skipIfLarger: thresholds.skipLargerWebp !== false,
        signal
      });

      if (uploaded.skipped) {
        skippedCount += 1;
        continue;
      }

      for (const usage of usages) {
        const scene = game.scenes.get(usage.sceneId);
        if (!scene) continue;
        await updateSceneSlotPath(scene, usage, uploaded.targetPath);
        changedSlots.push({
          sceneId: usage.sceneId,
          slotType: usage.slotType,
          levelId: usage.levelId ?? null,
          tileId: usage.tileId ?? null,
          oldSrc: src,
          newSrc: uploaded.targetPath,
          webpBytes: uploaded.webpBytes,
          width: uploaded.width,
          height: uploaded.height
        });
      }

      convertedCount += 1;
      savedBytes += Math.max(0, uploaded.originalBytes - uploaded.webpBytes);
    } catch (error) {
      if (error?.name === "AbortError") {
        aborted = true;
        break;
      }
      failures.push({
        src,
        error: error?.message || String(error)
      });
    }
  }

  return {
    convertedCount,
    skippedCount,
    savedBytes,
    formattedSaved: formatBytes(savedBytes),
    changedSlots,
    failures,
    aborted
  };
}

/**
 * Remove redundant zero-length and duplicate wall segments from a Scene.
 * @param {string} sceneId
 * @param {string[]} wallIds
 * @returns {Promise<number>}
 */
export async function cleanupRedundantWalls(sceneId, wallIds) {
  const scene = game.scenes.get(sceneId);
  if (!scene) return 0;
  const validIds = (wallIds ?? []).filter((id) => scene.walls.has(id));
  if (!validIds.length) return 0;
  await scene.deleteEmbeddedDocuments("Wall", validIds);
  return validIds.length;
}

/**
 * Snapshot Wall documents before deletion so they can be restored from backup JSON.
 * @param {string} sceneId
 * @param {string[]} wallIds
 * @returns {{ sceneId: string, walls: Array<Object> } | null}
 */
export function snapshotWallsForBackup(sceneId, wallIds) {
  const scene = game.scenes.get(sceneId);
  if (!scene) return null;
  const walls = [];
  for (const id of wallIds ?? []) {
    const wall = scene.walls.get(id);
    if (!wall) continue;
    walls.push(typeof wall.toObject === "function" ? wall.toObject() : foundry.utils.deepClone(wall));
  }
  return walls.length ? { sceneId, walls } : null;
}

/**
 * Remove orphaned tokens whose linked Actor no longer exists.
 * @param {string} sceneId
 * @param {string[]} tokenIds
 * @returns {Promise<number>}
 */
export async function removeOrphanedTokens(sceneId, tokenIds) {
  const scene = game.scenes.get(sceneId);
  if (!scene) return 0;
  const validIds = (tokenIds ?? []).filter((id) => scene.tokens.has(id));
  if (!validIds.length) return 0;
  await scene.deleteEmbeddedDocuments("Token", validIds);
  return validIds.length;
}

/**
 * Clear animation presets on ambient lights in a Scene to reduce canvas shader load.
 * @param {string} sceneId
 * @param {string[]} lightIds
 * @returns {Promise<number>}
 */
export async function disableLightAnimations(sceneId, lightIds) {
  const scene = game.scenes.get(sceneId);
  if (!scene) return 0;
  const updates = (lightIds ?? [])
    .filter((id) => scene.lights.has(id))
    .map((id) => ({ _id: id, "config.animation.type": null }));
  if (!updates.length) return 0;
  await scene.updateEmbeddedDocuments("AmbientLight", updates);
  return updates.length;
}

/**
 * Patch or unlink a broken @UUID occurrence on its Foundry document.
 * Safely handles JournalEntry, JournalEntryPage (text/system/flags), Actor, Item, and ActiveEffect.
 * @param {Object} occurrence
 * @param {{ mode: "replace" | "unlink", newUuid?: string }} action
 * @returns {Promise<boolean>}
 */
export async function patchDocumentUuidOccurrence(occurrence, action) {
  const doc = await fromUuid(occurrence.targetUuid);
  if (!doc) return false;

  const segments = occurrence.pathSegments ?? [];
  if (!segments.length) return false;

  const branchRootKey = segments[0];
  if (branchRootKey === "text" && segments[1]) {
    const current = doc.text?.[segments[1]] ?? "";
    const patched = applyPatchAtPath({ [segments[1]]: current }, [segments[1]], occurrence, action);
    if (patched[segments[1]] === current) return false;
    await doc.update({ [`text.${segments[1]}`]: patched[segments[1]] });
    return true;
  }

  if (branchRootKey === "command" || branchRootKey === "description" || branchRootKey === "documentUuid") {
    const current = doc[branchRootKey] ?? "";
    const patched = applyPatchAtPath(
      { [branchRootKey]: current },
      [branchRootKey],
      occurrence,
      action
    );
    if (patched[branchRootKey] === current) return false;
    await doc.update({ [branchRootKey]: patched[branchRootKey] });
    return true;
  }

  if (branchRootKey === "journalTarget") {
    if (action.mode === "replace" && action.newUuid) {
      const parts = action.newUuid.split(".");
      const update = {};
      if (parts[0] === "JournalEntry" && parts[1]) {
        update.entryId = parts[1];
        if (parts[2] === "JournalEntryPage" && parts[3]) update.pageId = parts[3];
        else update.pageId = null;
        await doc.update(update);
        return true;
      }
    } else if (action.mode === "unlink") {
      await doc.update({ entryId: null, pageId: null });
      return true;
    }
    return false;
  }

  if (branchRootKey === "flags") {
    const namespace = segments[1];
    if (!namespace) return false;
    const nsClone = foundry.utils.deepClone(doc.flags?.[namespace]);
    if (nsClone === undefined) return false;
    const patchedNs = applyPatchAtPath(nsClone, segments.slice(2), occurrence, action);
    if (!namespace.includes(".")) {
      await doc.update({ [`flags.==${namespace}`]: patchedNs });
    } else {
      const allFlags = foundry.utils.deepClone(doc.flags ?? {});
      allFlags[namespace] = patchedNs;
      await doc.update({ "==flags": allFlags });
    }
    return true;
  }

  if (branchRootKey === "system") {
    const rawSystem =
      typeof doc.system?.toObject === "function"
        ? doc.system.toObject()
        : foundry.utils.deepClone(doc.system ?? {});
    const patchedSystem = applyPatchAtPath(rawSystem, segments.slice(1), occurrence, action);
    const topKey = segments[1];
    if (topKey && !String(topKey).includes(".") && typeof doc.system?.[topKey] !== "undefined") {
      await doc.update({ [`system.==${topKey}`]: patchedSystem[topKey] });
    } else {
      await doc.update({ "==system": patchedSystem });
    }
    return true;
  }

  if (branchRootKey === "behaviors") {
    const behaviors = Array.isArray(doc.behaviors)
      ? doc.behaviors.map((b) => (typeof b.toObject === "function" ? b.toObject() : foundry.utils.deepClone(b)))
      : foundry.utils.deepClone(doc.behaviors ?? []);
    const patched = applyPatchAtPath(behaviors, segments.slice(1), occurrence, action);
    await doc.update({ "==behaviors": patched });
    return true;
  }

  return false;
}

/**
 * Batch-patch multiple broken UUID occurrences sequentially per document to avoid race conditions.
 * @param {Array<{ occurrence: Object, action: { mode: "replace" | "unlink", newUuid?: string } }>} operations
 * @param {{ signal?: AbortSignal, onProgress?: (info: { current: number, total: number, occurrence: Object }) => void, onPatched?: (op: Object) => void }} options
 * @returns {Promise<number>}
 */
export async function batchPatchUuidOccurrences(operations, options = {}) {
  const onPatched = typeof options?.onPatched === "function" ? options.onPatched : null;
  const onProgress = typeof options?.onProgress === "function" ? options.onProgress : null;
  const signal = options?.signal;
  const list = operations ?? [];
  let updatedCount = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (signal?.aborted) break;
    const op = list[i];
    onProgress?.({ current: i + 1, total: list.length, occurrence: op.occurrence });
    try {
      const changed = await patchDocumentUuidOccurrence(op.occurrence, op.action);
      if (changed) {
        updatedCount += 1;
        onPatched?.(op);
      }
    } catch (error) {
      console.error("WAIFU | Failed to patch @UUID occurrence", op.occurrence, error);
    }
  }
  return updatedCount;
}

/**
 * Build and download a JSON backup snapshot of flagged world settings, document flags,
 * and optional pre-fix rollback records (scene media paths, deleted walls).
 * @param {Object} report
 * @param {{ sceneMedia?: Array<Object>, deletedWalls?: Array<Object> }} extra
 * @returns {string} filename
 */
export function downloadStorageBackup(report, extra = {}) {
  const worldStorage = game.settings?.storage?.get?.("world");
  const settingRecords = [];
  if (worldStorage) {
    const allDocs = worldStorage.contents ?? [...worldStorage.values()];
    const targetKeys = new Set([
      ...(report?.settings?.items ?? []).map((item) => item.key),
      ...(report?.settings?.ignoredItems ?? []).map((item) => item.key)
    ]);
    for (const doc of allDocs) {
      if (targetKeys.has(doc.key)) {
        settingRecords.push({ key: doc.key, value: doc.value });
      }
    }
  }

  const flagRecords = [];
  const allFlagGroups = [
    ...(report?.flags?.groups ?? []),
    ...(report?.flags?.ignoredGroups ?? [])
  ];
  for (const group of allFlagGroups) {
    for (const target of group.targets ?? []) {
      flagRecords.push({
        docUuid: target.docUuid,
        docType: target.docType,
        docName: target.docName,
        namespace: target.namespace,
        status: target.status,
        bytes: target.bytes
      });
    }
  }

  const payload = {
    exportedBy: "waifu",
    backupVersion: 2,
    exportedAt: new Date().toISOString(),
    worldId: game.world?.id ?? "world",
    worldTitle: game.world?.title ?? "",
    settings: settingRecords,
    flagsMeta: flagRecords,
    ...(Array.isArray(extra?.sceneMedia) && extra.sceneMedia.length
      ? { sceneMedia: extra.sceneMedia }
      : {}),
    ...(Array.isArray(extra?.deletedWalls) && extra.deletedWalls.length
      ? { deletedWalls: extra.deletedWalls }
      : {})
  };

  // Enrich with live flag values when documents are synchronously resolvable
  for (const rec of payload.flagsMeta) {
    try {
      const liveDoc = fromUuidSync?.(rec.docUuid);
      if (liveDoc?.flags?.[rec.namespace] !== undefined) {
        rec.value = foundry.utils.deepClone(liveDoc.flags[rec.namespace]);
      }
    } catch {
      // Ignore unresolvable synchronous UUIDs
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `waifu-storage-backup-${payload.worldId}-${stamp}.json`;
  foundry.utils.saveDataToFile(JSON.stringify(payload, null, 2), "application/json", filename);
  return filename;
}

/**
 * Parse and validate a WAIFU backup JSON payload.
 * @param {string} rawText
 * @returns {Object}
 */
export function parseBackupPayload(rawText) {
  const parsed = JSON.parse(rawText);
  if (!parsed || typeof parsed !== "object" || parsed.exportedBy !== "waifu") {
    throw new Error("Invalid WAIFU backup file format");
  }
  return {
    worldId: parsed.worldId ?? "",
    exportedAt: parsed.exportedAt ?? "",
    settings: Array.isArray(parsed.settings) ? parsed.settings : [],
    flagsMeta: Array.isArray(parsed.flagsMeta) ? parsed.flagsMeta : [],
    sceneMedia: Array.isArray(parsed.sceneMedia) ? parsed.sceneMedia : [],
    deletedWalls: Array.isArray(parsed.deletedWalls) ? parsed.deletedWalls : []
  };
}

/**
 * Restore settings, document flags, scene asset paths, and deleted walls from a parsed WAIFU backup.
 * @param {Object} payload
 * @param {{ signal?: AbortSignal, onProgress?: (info: { current: number, total: number, detail: string }) => void }} options
 * @returns {Promise<{ restoredSettings: number, restoredFlags: number, restoredScenes: number, restoredWalls: number, errors: string[] }>}
 */
export async function restoreBackupPayload(payload, options = {}) {
  const signal = options?.signal;
  const onProgress = typeof options?.onProgress === "function" ? options.onProgress : null;
  let restoredSettings = 0;
  let restoredFlags = 0;
  let restoredScenes = 0;
  let restoredWalls = 0;
  const errors = [];

  const settingsList = payload?.settings ?? [];
  const flagsList = payload?.flagsMeta ?? [];
  const sceneMediaList = payload?.sceneMedia ?? [];
  const wallsList = payload?.deletedWalls ?? [];
  const totalSteps =
    settingsList.length + flagsList.length + sceneMediaList.length + wallsList.length;
  let currentStep = 0;

  const worldStorage = game.settings?.storage?.get?.("world");
  const existingSettings = worldStorage
    ? worldStorage.contents ?? [...worldStorage.values()]
    : [];
  const SettingClass = getDocumentClass?.("Setting") ?? worldStorage?.documentClass;

  for (const rec of settingsList) {
    if (signal?.aborted) break;
    currentStep += 1;
    if (!rec?.key) continue;
    onProgress?.({ current: currentStep, total: totalSteps, detail: `Setting: ${rec.key}` });
    try {
      const existing = existingSettings.find((s) => s.key === rec.key);
      if (existing) {
        await existing.update({ value: rec.value });
        restoredSettings += 1;
      } else if (SettingClass?.create) {
        await SettingClass.create({ key: rec.key, value: rec.value });
        restoredSettings += 1;
      }
    } catch (error) {
      errors.push(`Setting ${rec.key}: ${error?.message || String(error)}`);
    }
  }

  for (const rec of flagsList) {
    if (signal?.aborted) break;
    currentStep += 1;
    if (!rec?.docUuid || !rec?.namespace || rec.value === undefined) continue;
    onProgress?.({
      current: currentStep,
      total: totalSteps,
      detail: `Flag: ${rec.docName || rec.docUuid} (${rec.namespace})`
    });
    try {
      const doc = await fromUuid(rec.docUuid);
      if (!doc) continue;
      if (!rec.namespace.includes(".")) {
        await doc.update({ [`flags.==${rec.namespace}`]: foundry.utils.deepClone(rec.value) });
      } else {
        const nextFlags = foundry.utils.deepClone(doc.flags ?? {});
        nextFlags[rec.namespace] = foundry.utils.deepClone(rec.value);
        await doc.update({ "==flags": nextFlags });
      }
      restoredFlags += 1;
    } catch (error) {
      errors.push(`Flag ${rec.docUuid} (${rec.namespace}): ${error?.message || String(error)}`);
    }
  }

  for (const slot of sceneMediaList) {
    if (signal?.aborted) break;
    currentStep += 1;
    if (!slot?.sceneId || !slot?.oldSrc) continue;
    onProgress?.({ current: currentStep, total: totalSteps, detail: `Media: ${slot.oldSrc}` });
    try {
      const scene = game.scenes.get(slot.sceneId);
      if (!scene) continue;
      await updateSceneSlotPath(scene, slot, slot.oldSrc);
      restoredScenes += 1;
    } catch (error) {
      errors.push(`Scene media ${slot.sceneId}: ${error?.message || String(error)}`);
    }
  }

  for (const entry of wallsList) {
    if (signal?.aborted) break;
    currentStep += 1;
    if (!entry?.sceneId || !Array.isArray(entry?.walls) || !entry.walls.length) continue;
    onProgress?.({
      current: currentStep,
      total: totalSteps,
      detail: `Walls: ${entry.sceneId} (+${entry.walls.length})`
    });
    try {
      const scene = game.scenes.get(entry.sceneId);
      if (!scene) continue;
      const toCreate = entry.walls.filter((w) => !w?._id || !scene.walls.has(w._id));
      if (toCreate.length) {
        await scene.createEmbeddedDocuments("Wall", toCreate, { keepId: true });
        restoredWalls += toCreate.length;
      }
    } catch (error) {
      errors.push(`Walls ${entry.sceneId}: ${error?.message || String(error)}`);
    }
  }

  return { restoredSettings, restoredFlags, restoredScenes, restoredWalls, errors };
}

/**
 * Delete a single flag namespace on a specific target document UUID.
 * @param {string} docUuid
 * @param {string} namespace
 * @returns {Promise<boolean>}
 */
export async function deleteSingleDocumentFlag(docUuid, namespace) {
  if (!docUuid || !namespace) return false;
  const doc = await fromUuid(docUuid);
  if (!doc || doc.flags?.[namespace] === undefined) return false;
  if (!namespace.includes(".")) {
    await doc.update({ [`flags.-=${namespace}`]: null });
  } else {
    const nextFlags = foundry.utils.deepClone(doc.flags ?? {});
    delete nextFlags[namespace];
    await doc.update({ "==flags": nextFlags });
  }
  return true;
}

/**
 * Export older chat messages to an HTML archive and prune `game.messages` down to `keepLast`.
 * @param {{ keepLast?: number, exportFirst?: boolean }} options
 * @returns {Promise<{ deletedCount: number, archiveFilename: string | null }>}
 */
export async function archiveAndPruneChatMessages(options = {}) {
  const keepLast = Math.max(0, Number(options.keepLast) || 100);
  const exportFirst = options.exportFirst !== false;
  const allMessages = [...(game.messages ?? [])].sort(
    (a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0)
  );
  if (allMessages.length <= keepLast) {
    return { deletedCount: 0, archiveFilename: null };
  }

  const pruneCount = allMessages.length - keepLast;
  const toPrune = allMessages.slice(0, pruneCount);
  let archiveFilename = null;

  if (exportFirst) {
    const worldId = game.world?.id ?? "world";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    archiveFilename = `waifu-chat-archive-${worldId}-${stamp}.html`;
    const rows = toPrune
      .map((msg) => {
        const time = new Date(msg.timestamp || Date.now()).toISOString();
        const speaker = msg.alias || msg.author?.name || "System";
        const content = msg.content || "";
        return `<article class="msg"><header><strong>${escapeHtml(speaker)}</strong> <time>${escapeHtml(time)}</time></header><div class="body">${content}</div></article>`;
      })
      .join("\n");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Chat Archive (${worldId})</title><style>body{font-family:system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;background:#111;color:#eee}article.msg{border:1px solid #333;border-radius:8px;padding:10px 14px;margin:10px 0;background:#191c24}header{display:flex;justify-content:space-between;color:#aaa;font-size:12px;margin-bottom:6px}</style></head><body><h1>Foundry Chat Archive (${toPrune.length} messages)</h1>${rows}</body></html>`;
    foundry.utils.saveDataToFile(html, "text/html", archiveFilename);
  }

  const ChatMessageClass = getDocumentClass?.("ChatMessage") ?? globalThis.ChatMessage;
  const ids = toPrune.map((m) => m.id).filter(Boolean);
  for (let i = 0; i < ids.length; i += 200) {
    await ChatMessageClass.deleteDocuments(ids.slice(i, i + 200));
  }

  return { deletedCount: ids.length, archiveFilename };
}

/**
 * Delete stale/unstarted or empty Combat encounters.
 * @param {string[]} combatIds
 * @returns {Promise<number>}
 */
export async function cleanupStaleCombats(combatIds) {
  const validIds = (combatIds ?? []).filter((id) => game.combats?.has?.(id));
  if (!validIds.length) return 0;
  const CombatClass = getDocumentClass?.("Combat") ?? globalThis.Combat;
  await CombatClass.deleteDocuments(validIds);
  return validIds.length;
}

/**
 * Focus and pan the Foundry canvas to a scene or specific embedded object (wall, light, tile, token).
 * @param {string} sceneId
 * @param {{ x?: number, y?: number, wallId?: string }} target
 * @returns {Promise<boolean>}
 */
export async function focusSceneOnCanvas(sceneId, target = {}) {
  const scene = game.scenes?.get?.(sceneId);
  if (!scene) return false;
  if (canvas?.scene?.id !== sceneId) {
    await scene.view();
  }

  let x = Number(target?.x);
  let y = Number(target?.y);
  if ((!Number.isFinite(x) || !Number.isFinite(y)) && target?.wallId) {
    const wall = scene.walls.get(target.wallId);
    if (Array.isArray(wall?.c) && wall.c.length >= 4) {
      x = (wall.c[0] + wall.c[2]) / 2;
      y = (wall.c[1] + wall.c[3]) / 2;
    }
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    const dims = scene.dimensions;
    x = (dims?.sceneX ?? 0) + (dims?.sceneWidth ?? scene.width ?? 1000) / 2;
    y = (dims?.sceneY ?? 0) + (dims?.sceneHeight ?? scene.height ?? 1000) / 2;
  }

  await canvas?.animatePan?.({ x, y, duration: 400 });
  canvas?.ping?.({ x, y });
  return true;
}

/**
 * Delete a single world setting document by key.
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export async function deleteWorldSettingByKey(key) {
  const worldStorage = game.settings?.storage?.get?.("world");
  if (!worldStorage) return false;
  const items = worldStorage.contents ?? [...worldStorage.values()];
  const doc = items.find((item) => item.key === key);
  if (!doc) return false;
  await doc.delete();
  return true;
}

/**
 * Delete multiple world settings by key with progress and cancellation support.
 * @param {string[]} keys
 * @param {{ signal?: AbortSignal, onProgress?: (info: { current: number, total: number, key: string }) => void, onDeleted?: (key: string) => void }} options
 * @returns {Promise<number>}
 */
export async function deleteWorldSettingsBatch(keys, options = {}) {
  const signal = options?.signal;
  const onProgress = typeof options?.onProgress === "function" ? options.onProgress : null;
  const onDeleted = typeof options?.onDeleted === "function" ? options.onDeleted : null;
  const list = [...(keys ?? [])];
  let deleted = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (signal?.aborted) break;
    const key = list[i];
    onProgress?.({ current: i + 1, total: list.length, key });
    if (await deleteWorldSettingByKey(key)) {
      deleted += 1;
      onDeleted?.(key);
    }
  }
  return deleted;
}

/**
 * Delete a module flag namespace from all target documents in a flag group.
 * @param {Object} group
 * @param {{ signal?: AbortSignal, onProgress?: (info: { current: number, total: number, target: Object }) => void, onDeletedTarget?: (target: Object) => void }} options
 * @returns {Promise<number>}
 */
export async function deleteFlagGroup(group, options = {}) {
  let removed = 0;
  const namespace = group?.namespace;
  if (!namespace) return 0;
  const signal = options?.signal;
  const onProgress = typeof options?.onProgress === "function" ? options.onProgress : null;
  const onDeletedTarget = typeof options?.onDeletedTarget === "function" ? options.onDeletedTarget : null;
  const targets = group.targets ?? [];

  for (let i = 0; i < targets.length; i += 1) {
    if (signal?.aborted) break;
    const target = targets[i];
    onProgress?.({ current: i + 1, total: targets.length, target });
    try {
      const doc = await fromUuid(target.docUuid);
      if (!doc || doc.flags?.[namespace] === undefined) continue;
      if (!namespace.includes(".")) {
        await doc.update({ [`flags.-=${namespace}`]: null });
      } else {
        const nextFlags = foundry.utils.deepClone(doc.flags ?? {});
        delete nextFlags[namespace];
        await doc.update({ "==flags": nextFlags });
      }
      removed += 1;
      onDeletedTarget?.(target);
    } catch (error) {
      console.error("WAIFU | Failed deleting flag namespace", target.docUuid, namespace, error);
    }
  }
  return removed;
}

function clearValueAtPath(rootValue, pathSegments) {
  const cloned = structuredClone(rootValue);
  if (!pathSegments?.length) return cloned;
  let cursor = cloned;
  for (let i = 0; i < pathSegments.length - 1; i += 1) {
    if (cursor == null || typeof cursor !== "object") return cloned;
    cursor = cursor[pathSegments[i]];
  }
  const leaf = pathSegments[pathSegments.length - 1];
  if (cursor == null || typeof cursor !== "object") return cloned;
  if (Array.isArray(cursor) && typeof leaf === "number") {
    cursor.splice(leaf, 1);
  } else {
    cursor[leaf] = "";
  }
  return cloned;
}

async function resolveEntityTargetDocument(finding) {
  let doc = null;
  try {
    doc = await fromUuid(finding.targetUuid);
  } catch {
    doc = null;
  }
  if (doc) return doc;
  if (!finding.rootUuid || finding.rootUuid === finding.targetUuid) return null;

  const rootDoc = await fromUuid(finding.rootUuid);
  if (!rootDoc) return null;
  const suffix = finding.targetUuid.slice(finding.rootUuid.length + 1);
  const parts = suffix.split(".");
  let cursor = rootDoc;
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const type = parts[i];
    const id = parts[i + 1];
    if (type === "Item") cursor = cursor.items?.get?.(id) ?? null;
    else if (type === "ActiveEffect") cursor = cursor.effects?.get?.(id) ?? null;
    else cursor = null;
    if (!cursor) return null;
  }
  return cursor;
}

/**
 * Clean one or more residual flags or module strings found on Actors, Items, and their embedded entities.
 * Safely batches ActiveEffect `changes` removals per effect to avoid array index drift.
 * @param {Array<Object>} findings
 * @param {{ signal?: AbortSignal, onProgress?: (info: { current: number, total: number, finding: Object }) => void }} options
 * @returns {Promise<{ cleanedIds: string[], errors: string[], aborted: boolean }>}
 */
export async function cleanEntityFindingsBatch(findings = [], options = {}) {
  const signal = options?.signal;
  const onProgress = typeof options?.onProgress === "function" ? options.onProgress : null;
  const list = (findings ?? []).filter((f) => f && f.canClean && !f.isLocked);
  const cleanedIds = [];
  const errors = [];
  let aborted = false;

  const effectChangesByDoc = new Map();
  const sequential = [];
  for (const f of list) {
    if (f.kind === "effect-change") {
      if (!effectChangesByDoc.has(f.targetUuid)) effectChangesByDoc.set(f.targetUuid, []);
      effectChangesByDoc.get(f.targetUuid).push(f);
    } else {
      sequential.push(f);
    }
  }

  const total = list.length;
  let current = 0;

  for (const f of sequential) {
    if (signal?.aborted) {
      aborted = true;
      break;
    }
    current += 1;
    onProgress?.({ current, total, finding: f });

    try {
      const doc = await resolveEntityTargetDocument(f);
      if (!doc) continue;

      if (f.kind === "flag") {
        if (doc.flags?.[f.namespace] === undefined) continue;
        if (!f.namespace.includes(".")) {
          await doc.update({ [`flags.-=${f.namespace}`]: null });
        } else {
          const nextFlags = foundry.utils.deepClone(doc.flags ?? {});
          delete nextFlags[f.namespace];
          await doc.update({ "==flags": nextFlags });
        }
        cleanedIds.push(f.id);
      } else if (f.kind === "prototype-flag") {
        if (doc.prototypeToken?.flags?.[f.namespace] === undefined) continue;
        if (!f.namespace.includes(".")) {
          await doc.update({ [`prototypeToken.flags.-=${f.namespace}`]: null });
        } else {
          const nextFlags = foundry.utils.deepClone(doc.prototypeToken?.flags ?? {});
          delete nextFlags[f.namespace];
          await doc.update({ "==prototypeToken.flags": nextFlags });
        }
        cleanedIds.push(f.id);
      } else if (f.kind === "uuid-string" && f.uuidRef) {
        const ok = await patchDocumentUuidOccurrence(
          {
            targetUuid: f.targetUuid,
            pathSegments: f.pathSegments,
            syntax: f.uuidRef.syntax,
            rawUuid: f.uuidRef.rawUuid
          },
          { mode: "unlink" }
        );
        if (ok) cleanedIds.push(f.id);
      } else if (f.kind === "module-path" && Array.isArray(f.pathSegments) && f.pathSegments.length) {
        const rootKey = f.pathSegments[0];
        if (f.pathSegments.length === 1 && rootKey === "img") {
          await doc.update({ img: "" });
          cleanedIds.push(f.id);
        } else if (rootKey === "prototypeToken") {
          const rawProto =
            typeof doc.prototypeToken?.toObject === "function"
              ? doc.prototypeToken.toObject()
              : foundry.utils.deepClone(doc.prototypeToken ?? {});
          const nextProto = clearValueAtPath(rawProto, f.pathSegments.slice(1));
          const subKey = f.pathSegments[1];
          if (subKey === "texture" && f.pathSegments[2] === "src") {
            await doc.update({ "prototypeToken.texture.src": "" });
          } else {
            await doc.update({ "==prototypeToken": nextProto });
          }
          cleanedIds.push(f.id);
        } else if (rootKey === "system") {
          const rawSys =
            typeof doc.system?.toObject === "function"
              ? doc.system.toObject()
              : foundry.utils.deepClone(doc.system ?? {});
          const nextSys = clearValueAtPath(rawSys, f.pathSegments.slice(1));
          const topKey = f.pathSegments[1];
          if (topKey && !String(topKey).includes(".") && doc.system?.[topKey] !== undefined) {
            await doc.update({ [`system.==${topKey}`]: nextSys[topKey] });
          } else {
            await doc.update({ "==system": nextSys });
          }
          cleanedIds.push(f.id);
        } else {
          const dotPath = f.pathSegments.join(".");
          await doc.update({ [dotPath]: "" });
          cleanedIds.push(f.id);
        }
      }
    } catch (error) {
      errors.push(`${f.rootName} (${f.fieldPath}): ${error?.message || String(error)}`);
    }
  }

  for (const [, groupFindings] of effectChangesByDoc.entries()) {
    if (signal?.aborted) {
      aborted = true;
      break;
    }
    const sample = groupFindings[0];
    current += groupFindings.length;
    onProgress?.({ current: Math.min(total, current), total, finding: sample });

    try {
      const effectDoc = await resolveEntityTargetDocument(sample);
      if (!effectDoc) continue;
      const existingChanges = Array.isArray(effectDoc.changes)
        ? effectDoc.changes.map((c) =>
            typeof c?.toObject === "function" ? c.toObject() : foundry.utils.deepClone(c)
          )
        : [];
      const indicesToRemove = new Set();
      for (const f of groupFindings) {
        const idx = f.changeIndex;
        if (
          Number.isInteger(idx) &&
          existingChanges[idx] &&
          existingChanges[idx].key === f.matchedKey &&
          !indicesToRemove.has(idx)
        ) {
          indicesToRemove.add(idx);
        } else {
          const fallbackIdx = existingChanges.findIndex(
            (c, i) =>
              !indicesToRemove.has(i) &&
              c?.key === f.matchedKey &&
              String(c?.value ?? "") === String(f.matchedValue ?? "")
          );
          if (fallbackIdx >= 0) indicesToRemove.add(fallbackIdx);
        }
      }
      if (!indicesToRemove.size) continue;
      const nextChanges = existingChanges.filter((_c, idx) => !indicesToRemove.has(idx));
      await effectDoc.update({ changes: nextChanges });
      for (const f of groupFindings) cleanedIds.push(f.id);
    } catch (error) {
      errors.push(`${sample.rootName} (${sample.targetName}): ${error?.message || String(error)}`);
    }
  }

  return { cleanedIds, errors, aborted };
}
