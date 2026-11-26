import { DEFAULT_THRESHOLDS, SEVERITY_ORDER } from "../constants.mjs";
import { classifyNamespace } from "./storage-audit.mjs";
import { formatBytes, utf8ByteSize } from "./utils.mjs";
import { formatFieldPath } from "./uuid-audit.mjs";

const MODULE_PATH_REGEX =
  /(?:^|["'(\s=,/\\])modules\/([a-z0-9][a-z0-9_-]*)(?:\/|["')?\s#\\]|$)/gi;
const COMPENDIUM_REF_REGEX =
  /\bCompendium\.([a-z0-9][a-z0-9_-]*)\.([a-z0-9][a-z0-9_-]*)(?:\.[^\s"'\]}<>#]+)?(?:#[^\s"'\]}<>]+)?/gi;
const FLAG_REF_REGEX = /(?:\bflags|@flags)\.([a-z0-9][a-z0-9_-]*)\.[a-z0-9_.-]+/gi;
const DATA_MODULE_ATTR_REGEX = /\bdata-module=(["'])([a-z0-9][a-z0-9_-]*)\1/gi;
const LOREFRAME_ATTR_REGEX = /\bdata-loreframe-template=(["'])([^"']+)\1/i;
const ENRICHER_UUID_REGEX = /@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g;
const HTML_DATA_UUID_REGEX = /<a\b[^>]*\bdata-uuid=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi;

const SKIPPED_ROOT_BRANCHES = new Set([
  "id",
  "_id",
  "uuid",
  "docType",
  "pack",
  "isLocked",
  "isCompendium",
  "sourceLabel",
  "flags",
  "_stats",
  "items",
  "effects",
  "ownership",
  "folder",
  "sort"
]);

function previewText(str, maxLen = 140) {
  const clean = String(str ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

function previewJsonValue(val, maxLen = 120) {
  if (val === null) return "null";
  if (typeof val === "string") return previewText(JSON.stringify(val), maxLen);
  if (typeof val === "object" && Object.keys(val).length === 0) return "{}";
  try {
    return previewText(JSON.stringify(val), maxLen);
  } catch {
    return String(val);
  }
}

function isStandaloneModulePath(str) {
  const trimmed = String(str ?? "").trim();
  return /^\/?modules\/[a-z0-9][a-z0-9_-]*\/[^\s"'<>]+$/i.test(trimmed);
}

function extractModuleReferencesFromString(str) {
  if (typeof str !== "string" || !str) return [];
  const matches = [];
  const seen = new Set();

  const push = (namespace, matchType, matchedText) => {
    const key = `${namespace}::${matchType}::${matchedText}`;
    if (seen.has(key)) return;
    seen.add(key);
    matches.push({ namespace, matchType, matchedText });
  };

  if (str.includes("modules/")) {
    MODULE_PATH_REGEX.lastIndex = 0;
    let m;
    while ((m = MODULE_PATH_REGEX.exec(str)) !== null) {
      push(m[1], "module-path", m[0].trim());
    }
  }

  if (str.includes("Compendium.")) {
    COMPENDIUM_REF_REGEX.lastIndex = 0;
    let m;
    while ((m = COMPENDIUM_REF_REGEX.exec(str)) !== null) {
      push(m[1], "compendium-ref", m[0]);
    }
  }

  if (str.includes("flags.")) {
    FLAG_REF_REGEX.lastIndex = 0;
    let m;
    while ((m = FLAG_REF_REGEX.exec(str)) !== null) {
      push(m[1], "flag-ref", m[0]);
    }
  }

  if (str.includes("data-module")) {
    DATA_MODULE_ATTR_REGEX.lastIndex = 0;
    let m;
    while ((m = DATA_MODULE_ATTR_REGEX.exec(str)) !== null) {
      push(m[2], "module-attr", m[0]);
    }
  }

  if (str.includes("data-loreframe-template") && LOREFRAME_ATTR_REGEX.test(str)) {
    push("loreframe", "module-attr", "data-loreframe-template");
  }

  return matches;
}

function walkJsonStrings(value, basePath, onString, seen = new WeakSet()) {
  if (typeof value === "string") {
    onString(value, basePath);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      walkJsonStrings(value[i], [...basePath, i], onString, seen);
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    walkJsonStrings(child, [...basePath, key], onString, seen);
  }
}

function findMatchingUuidSyntax(str, compendiumRef) {
  if (str.includes("@UUID[")) {
    ENRICHER_UUID_REGEX.lastIndex = 0;
    let m;
    while ((m = ENRICHER_UUID_REGEX.exec(str)) !== null) {
      if (m[1].trim().startsWith(compendiumRef)) {
        return { syntax: "enricher", rawUuid: m[1].trim() };
      }
    }
  }
  if (str.includes("data-uuid")) {
    HTML_DATA_UUID_REGEX.lastIndex = 0;
    let m;
    while ((m = HTML_DATA_UUID_REGEX.exec(str)) !== null) {
      if (m[2].trim().startsWith(compendiumRef)) {
        return { syntax: "html-link", rawUuid: m[2].trim() };
      }
    }
  }
  if (str.trim().startsWith(compendiumRef) && !/\s/.test(str.trim())) {
    return { syntax: "bare-uuid", rawUuid: str.trim() };
  }
  return null;
}

/**
 * Scan non-flag JSON branches of an Actor, Item, or ActiveEffect for residual strings
 * referencing deleted or inactive modules.
 * @param {Object} dataObj
 * @param {{
 *   rootUuid: string,
 *   rootName: string,
 *   rootDocType: string,
 *   targetUuid: string,
 *   targetName: string,
 *   targetDocType: string,
 *   parentName?: string | null,
 *   isLocked?: boolean,
 *   isCompendium?: boolean,
 *   sourceLabel?: string
 * }} meta
 * @param {{ activeModuleIds: Set<string>, installedModuleIds: Set<string>, systemId?: string }} context
 * @param {Array<{ key: string, value: unknown }>} branches
 * @returns {Array<Object>}
 */
function scanBranchesForModuleStrings(branches, meta, context) {
  const findings = [];
  const seen = new Set();

  for (const [branchKey, branchValue] of branches) {
    if (branchValue === undefined || branchValue === null) continue;
    walkJsonStrings(branchValue, [branchKey], (str, pathSegments) => {
      const refs = extractModuleReferencesFromString(str);
      if (!refs.length) return;
      const fieldPath = formatFieldPath(pathSegments);

      for (const ref of refs) {
        const moduleState = classifyNamespace(ref.namespace, context);
        if (moduleState !== "orphaned" && moduleState !== "inactive") continue;

        const dedupKey = `${meta.targetUuid}::${fieldPath}::${ref.namespace}::${ref.matchedText}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        const isOrphaned = moduleState === "orphaned";
        let kind = "module-string";
        let canClean = false;
        let uuidRef = null;
        let changeIndex = null;
        let matchedKey = null;
        let matchedValue = null;

        if (
          meta.targetDocType === "ActiveEffect" &&
          pathSegments[0] === "changes" &&
          typeof pathSegments[1] === "number"
        ) {
          kind = "effect-change";
          canClean = !meta.isLocked;
          changeIndex = pathSegments[1];
          const changeObj = Array.isArray(branchValue) ? branchValue[changeIndex] : null;
          matchedKey = changeObj?.key ?? null;
          matchedValue = changeObj?.value ?? null;
        } else if (ref.matchType === "compendium-ref") {
          uuidRef = findMatchingUuidSyntax(str, ref.matchedText);
          if (uuidRef) {
            kind = "uuid-string";
            canClean = !meta.isLocked;
          }
        } else if (ref.matchType === "module-path" && isStandaloneModulePath(str)) {
          kind = "module-path";
          canClean = !meta.isLocked;
        }

        const bytes = utf8ByteSize(str);
        findings.push({
          id: `${meta.targetUuid}::str::${fieldPath}::${ref.namespace}::${findings.length}`,
          category: "string",
          kind,
          namespace: ref.namespace,
          moduleState,
          status: moduleState,
          severity: isOrphaned ? "warning" : "info",
          isOrphaned,
          isInactive: moduleState === "inactive",
          isLocked: Boolean(meta.isLocked),
          isCompendium: Boolean(meta.isCompendium),
          canClean,
          rootUuid: meta.rootUuid,
          rootName: meta.rootName,
          rootDocType: meta.rootDocType,
          targetUuid: meta.targetUuid,
          targetName: meta.targetName,
          targetDocType: meta.targetDocType,
          parentName: meta.parentName ?? null,
          sourceLabel: meta.sourceLabel || "World",
          fieldPath,
          pathSegments,
          matchedText: ref.matchedText,
          preview: previewText(str),
          fullValue: str,
          bytes,
          formattedSize: formatBytes(bytes),
          uuidRef,
          changeIndex,
          matchedKey,
          matchedValue
        });
      }
    });
  }

  return findings;
}

function collectFlagsFindings(flagsObj, prefix, kind, meta, context) {
  const findings = [];
  if (!flagsObj || typeof flagsObj !== "object") return findings;
  const maxFlagBytes = context.maxFlagBytes ?? DEFAULT_THRESHOLDS.maxFlagBytes;

  for (const [namespace, value] of Object.entries(flagsObj)) {
    if (value === undefined || namespace === "waifu") continue;
    const moduleState = classifyNamespace(namespace, context);
    if (moduleState !== "orphaned" && moduleState !== "inactive") continue;

    const bytes = utf8ByteSize(value);
    const isOrphaned = moduleState === "orphaned";
    const isBloated = bytes > maxFlagBytes;

    findings.push({
      id: `${meta.targetUuid}::${kind}::${namespace}`,
      category: "flag",
      kind,
      namespace,
      moduleState,
      status: moduleState,
      severity: isOrphaned ? (isBloated ? "critical" : "warning") : "info",
      isOrphaned,
      isInactive: moduleState === "inactive",
      isBloated,
      isLocked: Boolean(meta.isLocked),
      isCompendium: Boolean(meta.isCompendium),
      canClean: !meta.isLocked,
      rootUuid: meta.rootUuid,
      rootName: meta.rootName,
      rootDocType: meta.rootDocType,
      targetUuid: meta.targetUuid,
      targetName: meta.targetName,
      targetDocType: meta.targetDocType,
      parentName: meta.parentName ?? null,
      sourceLabel: meta.sourceLabel || "World",
      fieldPath: `${prefix}.${namespace}`,
      pathSegments: [...prefix.split("."), namespace],
      matchedText: `${prefix}.${namespace}`,
      preview: previewJsonValue(value),
      bytes,
      formattedSize: formatBytes(bytes)
    });
  }

  return findings;
}

function buildEntityBranches(entityObj, excludedKeys = SKIPPED_ROOT_BRANCHES) {
  const branches = [];
  for (const [key, val] of Object.entries(entityObj ?? {})) {
    if (excludedKeys.has(key) || val === undefined || val === null) continue;
    branches.push([key, val]);
  }
  return branches;
}

/**
 * Audit a single normalized Actor or Item snapshot (including embedded Items and ActiveEffects)
 * for residual flags and module strings left behind by deleted or disabled modules.
 * @param {Object} snapshot
 * @param {{ activeModuleIds: Set<string>, installedModuleIds: Set<string>, systemId?: string, maxFlagBytes?: number }} context
 * @returns {{ rootUuid: string, rootName: string, rootDocType: string, embeddedScannedCount: number, findings: Array<Object> }}
 */
export function auditEntitySnapshot(snapshot, context) {
  if (!snapshot || typeof snapshot !== "object") {
    return { rootUuid: "", rootName: "", rootDocType: "", embeddedScannedCount: 0, findings: [] };
  }

  const rootDocType = snapshot.docType || (Array.isArray(snapshot.items) ? "Actor" : "Item");
  const rootUuid = snapshot.uuid || `${rootDocType}.${snapshot.id || snapshot._id}`;
  const rootName = snapshot.name || snapshot.id || snapshot._id || rootUuid;
  const isLocked = Boolean(snapshot.isLocked);
  const isCompendium = Boolean(snapshot.isCompendium);
  const sourceLabel = snapshot.sourceLabel || (isCompendium ? "Compendium" : "World");

  const findings = [];
  let embeddedScannedCount = 0;

  const rootMeta = {
    rootUuid,
    rootName,
    rootDocType,
    targetUuid: rootUuid,
    targetName: rootName,
    targetDocType: rootDocType,
    parentName: null,
    isLocked,
    isCompendium,
    sourceLabel
  };

  findings.push(...collectFlagsFindings(snapshot.flags, "flags", "flag", rootMeta, context));

  if (rootDocType === "Actor" && snapshot.prototypeToken) {
    findings.push(
      ...collectFlagsFindings(
        snapshot.prototypeToken.flags,
        "prototypeToken.flags",
        "prototype-flag",
        rootMeta,
        context
      )
    );
    const protoNoFlags = { ...snapshot.prototypeToken };
    delete protoNoFlags.flags;
    findings.push(
      ...scanBranchesForModuleStrings(
        [
          ...buildEntityBranches(snapshot, new Set([...SKIPPED_ROOT_BRANCHES, "prototypeToken"])),
          ["prototypeToken", protoNoFlags]
        ],
        rootMeta,
        context
      )
    );
  } else {
    findings.push(
      ...scanBranchesForModuleStrings(buildEntityBranches(snapshot), rootMeta, context)
    );
  }

  const scanEffects = (effectsList, parentUuid, parentDisplayName) => {
    for (const effect of effectsList ?? []) {
      if (!effect) continue;
      embeddedScannedCount += 1;
      const effId = effect.id || effect._id;
      const effUuid = effect.uuid || `${parentUuid}.ActiveEffect.${effId}`;
      const effName = effect.name || effect.label || effId || "ActiveEffect";
      const effMeta = {
        rootUuid,
        rootName,
        rootDocType,
        targetUuid: effUuid,
        targetName: effName,
        targetDocType: "ActiveEffect",
        parentName: parentDisplayName,
        isLocked,
        isCompendium,
        sourceLabel
      };
      findings.push(...collectFlagsFindings(effect.flags, "flags", "flag", effMeta, context));
      findings.push(
        ...scanBranchesForModuleStrings(buildEntityBranches(effect), effMeta, context)
      );
    }
  };

  if (rootDocType === "Actor") {
    for (const item of snapshot.items ?? []) {
      if (!item) continue;
      embeddedScannedCount += 1;
      const itemId = item.id || item._id;
      const itemUuid = item.uuid || `${rootUuid}.Item.${itemId}`;
      const itemName = item.name || itemId || "Item";
      const itemMeta = {
        rootUuid,
        rootName,
        rootDocType,
        targetUuid: itemUuid,
        targetName: itemName,
        targetDocType: "Item",
        parentName: rootName,
        isLocked,
        isCompendium,
        sourceLabel
      };
      findings.push(...collectFlagsFindings(item.flags, "flags", "flag", itemMeta, context));
      findings.push(
        ...scanBranchesForModuleStrings(buildEntityBranches(item), itemMeta, context)
      );
      scanEffects(item.effects, itemUuid, `${rootName} › ${itemName}`);
    }
  }

  scanEffects(snapshot.effects, rootUuid, rootName);

  return {
    rootUuid,
    rootName,
    rootDocType,
    embeddedScannedCount,
    findings
  };
}

/**
 * Aggregate entity findings across multiple Actors/Items into a structured report.
 * @param {Array<{ rootUuid: string, rootName: string, rootDocType: string, embeddedScannedCount: number, findings: Array<Object> }>} entityResults
 * @returns {Object}
 */
export function summarizeEntityAudit(entityResults = []) {
  const uniqueRoots = new Map();
  let embeddedScannedCount = 0;
  const allFindings = [];

  for (const res of entityResults ?? []) {
    if (!res?.rootUuid) continue;
    if (!uniqueRoots.has(res.rootUuid)) {
      uniqueRoots.set(res.rootUuid, {
        uuid: res.rootUuid,
        name: res.rootName,
        docType: res.rootDocType,
        findingsCount: res.findings?.length ?? 0
      });
      embeddedScannedCount += Number(res.embeddedScannedCount) || 0;
      allFindings.push(...(res.findings ?? []));
    }
  }

  const sortedFindings = allFindings.toSorted(
    (a, b) =>
      (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0) ||
      Number(b.isOrphaned) - Number(a.isOrphaned) ||
      (Number(b.bytes) || 0) - (Number(a.bytes) || 0) ||
      a.rootName.localeCompare(b.rootName) ||
      a.namespace.localeCompare(b.namespace)
  );

  const byNsMap = new Map();
  for (const f of sortedFindings) {
    const cur = byNsMap.get(f.namespace) ?? {
      namespace: f.namespace,
      moduleState: f.moduleState,
      status: f.status,
      count: 0,
      flagsCount: 0,
      stringsCount: 0,
      bytes: 0
    };
    cur.count += 1;
    if (f.category === "flag") cur.flagsCount += 1;
    else cur.stringsCount += 1;
    cur.bytes += Number(f.bytes) || 0;
    byNsMap.set(f.namespace, cur);
  }

  const totalBytes = sortedFindings.reduce((sum, f) => sum + (Number(f.bytes) || 0), 0);
  const roots = [...uniqueRoots.values()];

  return {
    scannedAt: new Date().toISOString(),
    targetsCount: roots.length,
    actorsCount: roots.filter((r) => r.docType === "Actor").length,
    itemsCount: roots.filter((r) => r.docType === "Item").length,
    embeddedScannedCount,
    findingsCount: sortedFindings.length,
    orphanedCount: sortedFindings.filter((f) => f.isOrphaned).length,
    inactiveCount: sortedFindings.filter((f) => f.isInactive).length,
    flagsCount: sortedFindings.filter((f) => f.category === "flag").length,
    stringsCount: sortedFindings.filter((f) => f.category === "string").length,
    cleanableCount: sortedFindings.filter((f) => f.canClean).length,
    totalBytes,
    formattedTotalSize: formatBytes(totalBytes),
    byNamespace: [...byNsMap.values()]
      .map((ns) => ({ ...ns, formattedSize: formatBytes(ns.bytes) }))
      .toSorted((a, b) => b.count - a.count || b.bytes - a.bytes),
    roots,
    findings: sortedFindings
  };
}

/**
 * Audit a batch of normalized Actor/Item snapshots.
 * @param {Array<Object>} snapshots
 * @param {{ activeModuleIds: Set<string>, installedModuleIds: Set<string>, systemId?: string, maxFlagBytes?: number }} context
 * @returns {Object}
 */
export function auditEntityBatch(snapshots = [], context = {}) {
  const results = (snapshots ?? []).map((snap) => auditEntitySnapshot(snap, context));
  return summarizeEntityAudit(results);
}

/**
 * Remove cleaned findings from an existing entity audit report locally without re-scanning.
 * @param {Object} entityReport
 * @param {string | string[]} cleanedIds
 * @returns {Object}
 */
export function reconcileCleanedEntityFindings(entityReport, cleanedIds = []) {
  if (!entityReport) return entityReport;
  const idSet = new Set(Array.isArray(cleanedIds) ? cleanedIds : [cleanedIds]);
  if (!idSet.size) return entityReport;

  const remaining = (entityReport.findings ?? []).filter((f) => !idSet.has(f.id));
  const rootGroups = new Map();
  for (const root of entityReport.roots ?? []) {
    rootGroups.set(root.uuid, {
      rootUuid: root.uuid,
      rootName: root.name,
      rootDocType: root.docType,
      embeddedScannedCount: 0,
      findings: []
    });
  }
  for (const f of remaining) {
    if (!rootGroups.has(f.rootUuid)) {
      rootGroups.set(f.rootUuid, {
        rootUuid: f.rootUuid,
        rootName: f.rootName,
        rootDocType: f.rootDocType,
        embeddedScannedCount: 0,
        findings: []
      });
    }
    rootGroups.get(f.rootUuid).findings.push(f);
  }

  const next = summarizeEntityAudit([...rootGroups.values()]);
  next.embeddedScannedCount = entityReport.embeddedScannedCount ?? 0;
  next.scannedAt = entityReport.scannedAt;
  return next;
}
