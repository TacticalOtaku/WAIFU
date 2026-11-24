import { CORE_NAMESPACES, DEFAULT_THRESHOLDS, SEVERITY_ORDER } from "../constants.mjs";
import { formatBytes, utf8ByteSize } from "./utils.mjs";

/**
 * Classify a module/system namespace against currently installed & active Foundry packages.
 * @param {string} namespace
 * @param {{ activeModuleIds: Set<string>, installedModuleIds: Set<string>, systemId?: string }} context
 * @returns {"core" | "active" | "inactive" | "orphaned"}
 */
export function classifyNamespace(namespace, context) {
  if (!namespace || CORE_NAMESPACES.has(namespace) || namespace === context.systemId) {
    return "core";
  }
  if (context.activeModuleIds?.has(namespace)) return "active";
  if (context.installedModuleIds?.has(namespace)) return "inactive";
  return "orphaned";
}

/**
 * Split a Foundry setting key ("namespace.settingName") into parts safely.
 * @param {string} fullKey
 * @returns {{ namespace: string, settingKey: string }}
 */
export function splitSettingKey(fullKey) {
  const str = String(fullKey ?? "");
  const dot = str.indexOf(".");
  if (dot <= 0) return { namespace: "core", settingKey: str };
  return {
    namespace: str.slice(0, dot),
    settingKey: str.slice(dot + 1)
  };
}

/**
 * Audit world-scoped settings for bloated payloads and orphaned/inactive module namespaces.
 * @param {Array<{ id?: string, key: string, value: unknown }>} entries
 * @param {{
 *   activeModuleIds: Set<string>,
 *   installedModuleIds: Set<string>,
 *   systemId?: string,
 *   maxSettingBytes?: number
 * }} context
 * @returns {Object}
 */
export function auditWorldSettings(entries, context) {
  const maxSettingBytes = context.maxSettingBytes ?? DEFAULT_THRESHOLDS.maxSettingBytes;
  const analyzed = [];
  let totalBytes = 0;

  for (const entry of entries ?? []) {
    if (!entry?.key) continue;
    const { namespace, settingKey } = splitSettingKey(entry.key);
    const bytes = utf8ByteSize(entry.value);
    totalBytes += bytes;

    const moduleState = classifyNamespace(namespace, context);
    const isBloated = bytes > maxSettingBytes;
    const isOrphaned = moduleState === "orphaned";
    const isInactive = moduleState === "inactive";

    let status = "ok";
    let severity = "ok";
    if (isOrphaned) {
      status = "orphaned";
      severity = isBloated ? "critical" : "warning";
    } else if (isBloated) {
      status = isInactive ? "inactive" : "bloated";
      severity = bytes > maxSettingBytes * 4 ? "critical" : "warning";
    } else if (isInactive) {
      status = "inactive";
      severity = "info";
    }

    analyzed.push({
      id: entry.id ?? entry.key,
      key: entry.key,
      namespace,
      settingKey,
      bytes,
      formattedSize: formatBytes(bytes),
      moduleState,
      status,
      severity,
      isBloated,
      isOrphaned,
      isInactive,
      canDelete: isOrphaned || isBloated
    });
  }

  const flagged = analyzed
    .filter((item) => item.status !== "ok")
    .toSorted(
      (a, b) =>
        SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
        b.bytes - a.bytes ||
        a.key.localeCompare(b.key)
    );

  const byNamespaceMap = Object.groupBy(analyzed, (item) => item.namespace);
  const byNamespace = Object.entries(byNamespaceMap)
    .map(([namespace, items]) => {
      const nsBytes = items.reduce((sum, i) => sum + i.bytes, 0);
      return {
        namespace,
        moduleState: items[0].moduleState,
        count: items.length,
        bytes: nsBytes,
        formattedSize: formatBytes(nsBytes),
        sharePercent: totalBytes > 0 ? Number(((nsBytes / totalBytes) * 100).toFixed(1)) : 0
      };
    })
    .toSorted((a, b) => b.bytes - a.bytes);

  const orphanedItems = analyzed.filter((i) => i.isOrphaned);
  const bloatedItems = analyzed.filter((i) => i.isBloated);

  return {
    totalSettingsCount: analyzed.length,
    totalBytes,
    formattedTotalSize: formatBytes(totalBytes),
    flaggedCount: flagged.length,
    bloatedCount: bloatedItems.length,
    orphanedCount: orphanedItems.length,
    orphanedBytes: orphanedItems.reduce((sum, i) => sum + i.bytes, 0),
    inactiveCount: analyzed.filter((i) => i.isInactive).length,
    items: flagged,
    allItems: analyzed.toSorted((a, b) => b.bytes - a.bytes),
    byNamespace
  };
}

/**
 * Audit document flag namespaces across the world for deleted modules and bloated payloads.
 * @param {Array<{
 *   docType: string,
 *   docId: string,
 *   docName: string,
 *   docUuid: string,
 *   parentName?: string | null,
 *   parentUuid?: string | null,
 *   namespace: string,
 *   value: unknown
 * }>} flagEntries
 * @param {{
 *   activeModuleIds: Set<string>,
 *   installedModuleIds: Set<string>,
 *   systemId?: string,
 *   maxFlagBytes?: number
 * }} context
 * @returns {Object}
 */
export function auditDocumentFlags(flagEntries, context) {
  const maxFlagBytes = context.maxFlagBytes ?? DEFAULT_THRESHOLDS.maxFlagBytes;
  const analyzed = [];

  for (const entry of flagEntries ?? []) {
    if (!entry?.namespace || entry.namespace === "waifu") continue;
    const moduleState = classifyNamespace(entry.namespace, context);
    const bytes = utf8ByteSize(entry.value);
    const isBloated = bytes > maxFlagBytes;
    const isOrphaned = moduleState === "orphaned";
    const isInactive = moduleState === "inactive";

    // Core/system flags are only reported if severely bloated
    if (moduleState === "core" && !isBloated) continue;
    if (moduleState === "active" && !isBloated) continue;

    let status = "ok";
    let severity = "ok";
    if (isOrphaned) {
      status = "orphaned";
      severity = isBloated ? "critical" : "warning";
    } else if (isBloated) {
      status = isInactive ? "inactive" : "bloated";
      severity = bytes > maxFlagBytes * 4 ? "critical" : "warning";
    } else if (isInactive) {
      status = "inactive";
      severity = "info";
    }

    analyzed.push({
      id: `${entry.docUuid}::${entry.namespace}`,
      docType: entry.docType,
      docId: entry.docId,
      docName: entry.docName || entry.docId,
      docUuid: entry.docUuid,
      parentName: entry.parentName ?? null,
      parentUuid: entry.parentUuid ?? null,
      namespace: entry.namespace,
      bytes,
      formattedSize: formatBytes(bytes),
      moduleState,
      status,
      severity,
      isBloated,
      isOrphaned,
      isInactive
    });
  }

  const groupedByNs = Object.groupBy(analyzed, (item) => `${item.namespace}::${item.status}`);
  const groups = Object.values(groupedByNs)
    .map((entries) => {
      const first = entries[0];
      const groupBytes = entries.reduce((sum, i) => sum + i.bytes, 0);
      const maxSeverity = entries.reduce(
        (best, i) => (SEVERITY_ORDER[i.severity] > SEVERITY_ORDER[best] ? i.severity : best),
        "info"
      );
      const docTypes = [...new Set(entries.map((e) => e.docType))].sort();
      return {
        id: `${first.namespace}::${first.status}`,
        namespace: first.namespace,
        moduleState: first.moduleState,
        status: first.status,
        severity: maxSeverity,
        isOrphaned: first.isOrphaned,
        isInactive: first.isInactive,
        isBloated: entries.some((e) => e.isBloated),
        docCount: entries.length,
        docTypes,
        bytes: groupBytes,
        formattedSize: formatBytes(groupBytes),
        targets: entries.toSorted((a, b) => b.bytes - a.bytes)
      };
    })
    .toSorted(
      (a, b) =>
        SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
        b.bytes - a.bytes ||
        a.namespace.localeCompare(b.namespace)
    );

  const orphanedEntries = analyzed.filter((i) => i.isOrphaned);

  return {
    totalFlaggedEntries: analyzed.length,
    groupsCount: groups.length,
    orphanedEntriesCount: orphanedEntries.length,
    orphanedNamespacesCount: new Set(orphanedEntries.map((i) => i.namespace)).size,
    orphanedBytes: orphanedEntries.reduce((sum, i) => sum + i.bytes, 0),
    formattedOrphanedSize: formatBytes(orphanedEntries.reduce((sum, i) => sum + i.bytes, 0)),
    inactiveEntriesCount: analyzed.filter((i) => i.isInactive).length,
    bloatedEntriesCount: analyzed.filter((i) => i.isBloated).length,
    groups,
    items: analyzed.toSorted((a, b) => b.bytes - a.bytes)
  };
}
