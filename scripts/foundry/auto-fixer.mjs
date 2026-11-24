import { formatBytes } from "../core/utils.mjs";
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
 * Convert one or more scene/tile raster assets to WebP (deduplicated by source path)
 * and update every scene/level/tile document referencing them.
 * @param {Array<Object>} assets
 * @param {{ quality?: number, maxTextureResolution?: number, downscaleOnConvert?: boolean }} thresholds
 * @returns {Promise<{ convertedCount: number, savedBytes: number, formattedSaved: string, failures: Array<{ src: string, error: string }> }>}
 */
export async function convertSceneAssetsToWebp(assets, thresholds) {
  const worldId = game.world?.id ?? "world";
  const bySource = new Map();
  for (const asset of assets ?? []) {
    if (!asset?.canAutoConvert || !asset?.src) continue;
    if (!bySource.has(asset.src)) bySource.set(asset.src, []);
    bySource.get(asset.src).push(asset);
  }

  let convertedCount = 0;
  let savedBytes = 0;
  const failures = [];

  for (const [src, usages] of bySource.entries()) {
    try {
      const uploaded = await convertAndUploadWebp(src, {
        worldId,
        quality: thresholds.webpQuality,
        maxResolution: thresholds.maxTextureResolution,
        downscale: thresholds.downscaleOnConvert
      });

      for (const usage of usages) {
        const scene = game.scenes.get(usage.sceneId);
        if (!scene) continue;
        await updateSceneSlotPath(scene, usage, uploaded.targetPath);
      }

      convertedCount += 1;
      savedBytes += Math.max(0, uploaded.originalBytes - uploaded.webpBytes);
    } catch (error) {
      failures.push({
        src,
        error: error?.message || String(error)
      });
    }
  }

  return {
    convertedCount,
    savedBytes,
    formattedSaved: formatBytes(savedBytes),
    failures
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

  if (branchRootKey === "description") {
    const current = doc.description ?? "";
    const patched = applyPatchAtPath({ description: current }, ["description"], occurrence, action);
    if (patched.description === current) return false;
    await doc.update({ description: patched.description });
    return true;
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

  return false;
}

/**
 * Batch-patch multiple broken UUID occurrences sequentially per document to avoid race conditions.
 * @param {Array<{ occurrence: Object, action: { mode: "replace" | "unlink", newUuid?: string } }>} operations
 * @returns {Promise<number>}
 */
export async function batchPatchUuidOccurrences(operations) {
  let updatedCount = 0;
  for (const op of operations ?? []) {
    try {
      const changed = await patchDocumentUuidOccurrence(op.occurrence, op.action);
      if (changed) updatedCount += 1;
    } catch (error) {
      console.error("WAIFU | Failed to patch @UUID occurrence", op.occurrence, error);
    }
  }
  return updatedCount;
}

/**
 * Build and download a JSON backup snapshot of flagged world settings and document flags.
 * @param {Object} report
 * @returns {string} filename
 */
export function downloadStorageBackup(report) {
  const worldStorage = game.settings?.storage?.get?.("world");
  const settingRecords = [];
  if (worldStorage) {
    const allDocs = worldStorage.contents ?? [...worldStorage.values()];
    const targetKeys = new Set((report?.settings?.items ?? []).map((item) => item.key));
    for (const doc of allDocs) {
      if (targetKeys.has(doc.key)) {
        settingRecords.push({ key: doc.key, value: doc.value });
      }
    }
  }

  const flagRecords = [];
  for (const group of report?.flags?.groups ?? []) {
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
    exportedAt: new Date().toISOString(),
    worldId: game.world?.id ?? "world",
    worldTitle: game.world?.title ?? "",
    settings: settingRecords,
    flagsMeta: flagRecords
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
 * Delete multiple world settings by key.
 * @param {string[]} keys
 * @returns {Promise<number>}
 */
export async function deleteWorldSettingsBatch(keys) {
  let deleted = 0;
  for (const key of keys ?? []) {
    if (await deleteWorldSettingByKey(key)) deleted += 1;
  }
  return deleted;
}

/**
 * Delete a module flag namespace from all target documents in a flag group.
 * @param {Object} group
 * @returns {Promise<number>}
 */
export async function deleteFlagGroup(group) {
  let removed = 0;
  const namespace = group?.namespace;
  if (!namespace) return 0;

  for (const target of group.targets ?? []) {
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
    } catch (error) {
      console.error("WAIFU | Failed deleting flag namespace", target.docUuid, namespace, error);
    }
  }
  return removed;
}
