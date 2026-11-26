import {
  AUDIT_HISTORY_SETTING,
  CORE_NAMESPACES,
  DEFAULT_THRESHOLDS,
  IGNORE_RULES_SETTING,
  LAST_AUDIT_REPORT_SETTING,
  MODULE_ID,
  SEVERITY_ORDER
} from "../constants.mjs";
import { formatBytes, utf8ByteSize } from "./utils.mjs";

const INTERNAL_WAIFU_SETTINGS = new Set([
  `${MODULE_ID}.${LAST_AUDIT_REPORT_SETTING}`,
  `${MODULE_ID}.${AUDIT_HISTORY_SETTING}`,
  `${MODULE_ID}.${IGNORE_RULES_SETTING}`
]);

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
  const ignoredKeys = context.ignoredSettingKeys instanceof Set
    ? context.ignoredSettingKeys
    : new Set(context.ignoredSettingKeys ?? []);
  const analyzed = [];
  let totalBytes = 0;

  for (const entry of entries ?? []) {
    if (!entry?.key || INTERNAL_WAIFU_SETTINGS.has(entry.key)) continue;
    const { namespace, settingKey } = splitSettingKey(entry.key);
    const bytes = utf8ByteSize(entry.value);
    totalBytes += bytes;

    const moduleState = classifyNamespace(namespace, context);
    const isIgnored = ignoredKeys.has(entry.key);
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
      isIgnored,
      canDelete: isOrphaned || isBloated
    });
  }

  return summarizeSettingsAudit(analyzed);
}

/**
 * Aggregate analyzed world settings into the standard `report.settings` section.
 * @param {Array<Object>} analyzed
 * @returns {Object}
 */
export function summarizeSettingsAudit(analyzed = []) {
  const list = [...(analyzed ?? [])];
  const totalBytes = list.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0);
  const flagged = list
    .filter((item) => item.status !== "ok" && !item.isIgnored)
    .toSorted(
      (a, b) =>
        SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
        b.bytes - a.bytes ||
        a.key.localeCompare(b.key)
    );
  const ignoredItems = list
    .filter((item) => item.status !== "ok" && item.isIgnored)
    .toSorted((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key));

  const byNamespaceMap = Object.groupBy(list, (item) => item.namespace);
  const byNamespace = Object.entries(byNamespaceMap)
    .map(([namespace, items]) => {
      const nsBytes = items.reduce((sum, i) => sum + (Number(i.bytes) || 0), 0);
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

  const orphanedItems = flagged.filter((i) => i.isOrphaned);
  const bloatedItems = flagged.filter((i) => i.isBloated);

  return {
    totalSettingsCount: list.length,
    totalBytes,
    formattedTotalSize: formatBytes(totalBytes),
    flaggedCount: flagged.length,
    bloatedCount: bloatedItems.length,
    orphanedCount: orphanedItems.length,
    orphanedBytes: orphanedItems.reduce((sum, i) => sum + (Number(i.bytes) || 0), 0),
    inactiveCount: flagged.filter((i) => i.isInactive).length,
    ignoredCount: ignoredItems.length,
    ignoredItems,
    items: flagged,
    allItems: list.toSorted((a, b) => b.bytes - a.bytes),
    byNamespace
  };
}

/**
 * Build grouped flag summaries from flat document-flag entries.
 * @param {Array<Object>} rows
 * @param {boolean} isIgnored
 * @returns {Array<Object>}
 */
export function buildFlagGroups(rows = [], isIgnored = false) {
  const groupedByNs = Object.groupBy(rows ?? [], (item) => `${item.namespace}::${item.status}`);
  return Object.values(groupedByNs)
    .map((entries) => {
      const first = entries[0];
      const groupBytes = entries.reduce((sum, i) => sum + (Number(i.bytes) || 0), 0);
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
        isIgnored,
        docCount: entries.length,
        docTypes,
        bytes: groupBytes,
        formattedSize: formatBytes(groupBytes),
        targets: entries.toSorted((a, b) => (Number(b.bytes) || 0) - (Number(a.bytes) || 0))
      };
    })
    .toSorted(
      (a, b) =>
        SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
        b.bytes - a.bytes ||
        a.namespace.localeCompare(b.namespace)
    );
}

/**
 * Aggregate grouped document flags into the standard `report.flags` section.
 * @param {Array<Object>} groups
 * @param {Array<Object>} ignoredGroups
 * @returns {Object}
 */
export function summarizeFlagGroups(groups = [], ignoredGroups = []) {
  const sortGroups = (list) =>
    [...(list ?? [])].toSorted(
      (a, b) =>
        SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
        (Number(b.bytes) || 0) - (Number(a.bytes) || 0) ||
        a.namespace.localeCompare(b.namespace)
    );

  const sortedGroups = sortGroups(groups);
  const sortedIgnored = sortGroups(ignoredGroups);
  const activeEntries = sortedGroups.flatMap((g) => g.targets ?? []);
  const orphanedEntries = activeEntries.filter((i) => i.isOrphaned);
  const orphanedBytes = orphanedEntries.reduce((sum, i) => sum + (Number(i.bytes) || 0), 0);

  return {
    totalFlaggedEntries: activeEntries.length,
    groupsCount: sortedGroups.length,
    orphanedEntriesCount: orphanedEntries.length,
    orphanedNamespacesCount: new Set(orphanedEntries.map((i) => i.namespace)).size,
    orphanedBytes,
    formattedOrphanedSize: formatBytes(orphanedBytes),
    inactiveEntriesCount: activeEntries.filter((i) => i.isInactive).length,
    bloatedEntriesCount: activeEntries.filter((i) => i.isBloated).length,
    ignoredGroupsCount: sortedIgnored.length,
    ignoredGroups: sortedIgnored,
    groups: sortedGroups,
    items: activeEntries.toSorted((a, b) => (Number(b.bytes) || 0) - (Number(a.bytes) || 0))
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
  const ignoredNamespaces = context.ignoredFlagNamespaces instanceof Set
    ? context.ignoredFlagNamespaces
    : new Set(context.ignoredFlagNamespaces ?? []);
  const analyzed = [];
  const ignoredAnalyzed = [];

  for (const entry of flagEntries ?? []) {
    if (!entry?.namespace || entry.namespace === "waifu") continue;
    const moduleState = classifyNamespace(entry.namespace, context);
    const bytes = utf8ByteSize(entry.value);
    const isBloated = bytes > maxFlagBytes;
    const isOrphaned = moduleState === "orphaned";
    const isInactive = moduleState === "inactive";
    const isIgnored = ignoredNamespaces.has(entry.namespace);

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

    const row = {
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
      isInactive,
      isIgnored
    };

    if (isIgnored) ignoredAnalyzed.push(row);
    else analyzed.push(row);
  }

  const groups = buildFlagGroups(analyzed, false);
  const ignoredGroups = buildFlagGroups(ignoredAnalyzed, true);
  return summarizeFlagGroups(groups, ignoredGroups);
}

/**
 * Audit additional world maintenance health signals: Chat log size, stale Combats,
 * broken 404 non-scene media, and unreferenced files in `waifu-optimized`.
 * @param {{
 *   chatMessagesCount?: number,
 *   chatBytes?: number,
 *   maxChatMessages?: number,
 *   combats?: Array<{ id: string, round?: number, started?: boolean, combatantsCount?: number, sceneName?: string }>,
 *   brokenMedia?: Array<{ docType: string, docUuid: string, docName: string, field: string, src: string, statusCode?: number | null }>,
 *   unusedOptimizedFiles?: Array<{ path: string, filename: string }>
 * }} input
 * @returns {Object}
 */
export function auditWorldHealthExtras(input = {}) {
  const chatMessagesCount = Number(input.chatMessagesCount) || 0;
  const chatBytes = Number(input.chatBytes) || 0;
  const maxChatMessages = Number(input.maxChatMessages) || DEFAULT_THRESHOLDS.maxChatMessages;

  let chatSeverity = "ok";
  if (chatMessagesCount > maxChatMessages * 3) chatSeverity = "critical";
  else if (chatMessagesCount > maxChatMessages) chatSeverity = "warning";

  const combats = Array.isArray(input.combats) ? input.combats : [];
  const staleCombats = combats.filter(
    (c) => !c.started || Number(c.round) === 0 || (Number(c.combatantsCount) || 0) === 0
  );

  const brokenMedia = Array.isArray(input.brokenMedia) ? input.brokenMedia : [];
  const unusedOptimizedFiles = Array.isArray(input.unusedOptimizedFiles)
    ? input.unusedOptimizedFiles
    : [];

  return {
    chatMessagesCount,
    chatBytes,
    formattedChatBytes: formatBytes(chatBytes),
    maxChatMessages,
    chatSeverity,
    chatBloated: chatMessagesCount > maxChatMessages,
    combatsCount: combats.length,
    staleCombatsCount: staleCombats.length,
    staleCombats,
    brokenMediaCount: brokenMedia.length,
    brokenMedia,
    unusedOptimizedCount: unusedOptimizedFiles.length,
    unusedOptimizedFiles
  };
}
