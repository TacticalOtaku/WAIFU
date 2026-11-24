import { ACCENT_OPTIONS, THEME_OPTIONS } from "../constants.mjs";
import { buildReportCharts } from "./charts.mjs";
import { buildReportStatistics, compareAuditReports } from "./statistics.mjs";
import { escapeHtml, formatBytes } from "./utils.mjs";

/**
 * Compute overall world health score (0-100) and prioritized auto-fix recommendations.
 * @param {{ scenes: Object, uuids: Object, settings: Object, flags: Object, extras?: Object }} sections
 * @returns {Object}
 */
export function buildAuditSummary(sections) {
  const { scenes, uuids, settings, flags, extras } = sections;

  let penalty = 0;
  penalty += scenes.criticalCount * 14 + scenes.warningCount * 5;
  penalty += Math.min(25, scenes.pngAssetsCount * 3);
  penalty += Math.min(35, uuids.brokenCount * 3);
  penalty += Math.min(18, settings.bloatedCount * 4 + settings.orphanedCount * 2);
  penalty += Math.min(20, flags.orphanedNamespacesCount * 4 + flags.bloatedEntriesCount * 3);
  if (extras?.brokenMediaCount > 0) {
    penalty += Math.min(12, extras.brokenMediaCount * 2);
  }
  if (extras?.chatBloated) {
    penalty += extras.chatSeverity === "critical" ? 6 : 3;
  }

  const healthScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  let healthState = "healthy";
  if (healthScore < 60) healthState = "critical";
  else if (healthScore < 85) healthState = "warning";

  const criticalCount =
    scenes.criticalCount +
    uuids.items.filter((i) => i.severity === "critical").length +
    settings.items.filter((i) => i.severity === "critical").length +
    flags.groups.filter((g) => g.severity === "critical").length +
    (extras?.brokenMediaCount ?? 0) +
    (extras?.chatSeverity === "critical" ? 1 : 0);

  const warningCount =
    scenes.warningCount +
    uuids.items.filter((i) => i.severity === "warning").length +
    settings.items.filter((i) => i.severity === "warning").length +
    flags.groups.filter((g) => g.severity === "warning").length +
    (extras?.chatSeverity === "warning" ? 1 : 0) +
    (extras?.staleCombatsCount ? 1 : 0);

  const infoCount =
    settings.items.filter((i) => i.severity === "info").length +
    flags.groups.filter((g) => g.severity === "info").length +
    (extras?.unusedOptimizedCount ? 1 : 0);

  const fixableCounts = {
    sceneWebp: scenes.unoptimizedAssetsCount,
    duplicateWalls: scenes.redundantWallsTotal,
    nearDuplicateWalls: scenes.nearDuplicateWallsTotal ?? 0,
    orphanedTokens: scenes.orphanedTokensTotal ?? 0,
    uuidExact: uuids.exactMatchCount,
    uuidAuto: uuids.autoMatchCount ?? uuids.exactMatchCount,
    uuidTotal: uuids.brokenCount,
    orphanSettings: settings.orphanedCount,
    orphanFlags: flags.orphanedEntriesCount,
    staleCombats: extras?.staleCombatsCount ?? 0
  };

  const totalFixable =
    fixableCounts.sceneWebp +
    fixableCounts.duplicateWalls +
    fixableCounts.uuidAuto +
    fixableCounts.orphanSettings +
    fixableCounts.orphanFlags;

  const recommendations = [];
  if (fixableCounts.sceneWebp > 0) {
    recommendations.push({
      id: "convert-scene-webp",
      priority: scenes.pngAssetsCount > 0 ? "high" : "medium",
      tab: "scenes",
      action: "batchConvertWebp",
      count: fixableCounts.sceneWebp,
      pngCount: scenes.pngAssetsCount
    });
  }
  if (fixableCounts.duplicateWalls > 0) {
    recommendations.push({
      id: "dedupe-walls",
      priority: "medium",
      tab: "scenes",
      action: "batchDedupeWalls",
      count: fixableCounts.duplicateWalls
    });
  }
  if (fixableCounts.nearDuplicateWalls > 0) {
    recommendations.push({
      id: "dedupe-near-walls",
      priority: "low",
      tab: "scenes",
      action: "batchDedupeNearWalls",
      count: fixableCounts.nearDuplicateWalls
    });
  }
  if (fixableCounts.orphanedTokens > 0) {
    recommendations.push({
      id: "cleanup-orphaned-tokens",
      priority: "medium",
      tab: "scenes",
      action: "batchCleanOrphanTokens",
      count: fixableCounts.orphanedTokens
    });
  }
  if (fixableCounts.uuidAuto > 0) {
    recommendations.push({
      id: "apply-exact-uuids",
      priority: "high",
      tab: "uuids",
      action: "batchApplyExactUuids",
      count: fixableCounts.uuidAuto
    });
  }
  if (fixableCounts.orphanSettings > 0 || fixableCounts.orphanFlags > 0) {
    recommendations.push({
      id: "cleanup-orphaned-storage",
      priority: "medium",
      tab: "storage",
      action: "cleanupAllOrphans",
      count: fixableCounts.orphanSettings + fixableCounts.orphanFlags,
      settingsCount: fixableCounts.orphanSettings,
      flagsCount: fixableCounts.orphanFlags
    });
  }
  if (extras?.chatBloated) {
    recommendations.push({
      id: "prune-chat-log",
      priority: extras.chatSeverity === "critical" ? "high" : "medium",
      tab: "storage",
      action: "archiveChatMessages",
      count: extras.chatMessagesCount
    });
  }
  if (fixableCounts.staleCombats > 0) {
    recommendations.push({
      id: "cleanup-stale-combats",
      priority: "low",
      tab: "storage",
      action: "cleanStaleCombats",
      count: fixableCounts.staleCombats
    });
  }

  return {
    healthScore,
    healthState,
    totalIssues: criticalCount + warningCount,
    criticalCount,
    warningCount,
    infoCount,
    totalFixable,
    fixableCounts,
    recommendations
  };
}

/**
 * Create a complete serializable audit report object with precomputed detailed statistics.
 * @param {Object} params
 * @returns {Object}
 */
export function createAuditReport({
  meta,
  thresholds,
  scenes,
  uuids,
  settings,
  flags,
  extras = null,
  history = [],
  comparison = null
}) {
  const summary = buildAuditSummary({ scenes, uuids, settings, flags, extras });
  const base = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    meta,
    thresholds,
    summary,
    scenes,
    uuids,
    settings,
    flags,
    ...(extras ? { extras } : {}),
    ...(Array.isArray(history) && history.length ? { history } : {}),
    ...(comparison ? { comparison } : {})
  };
  base.statistics = buildReportStatistics(base);
  if (!base.comparison && Array.isArray(history) && history.length >= 2) {
    const prev = history[history.length - 2];
    if (prev && Number.isFinite(prev.healthScore)) {
      base.comparison = {
        previousGeneratedAt: prev.generatedAt ?? null,
        currentGeneratedAt: base.generatedAt,
        healthDelta: summary.healthScore - Number(prev.healthScore),
        previousHealth: Number(prev.healthScore),
        currentHealth: summary.healthScore,
        issuesDelta: summary.totalIssues - (Number(prev.totalIssues) || 0),
        reclaimableBytesDelta:
          (Number(base.statistics.storageStats.totalReclaimableBytes) || 0) -
          (Number(prev.reclaimableBytes) || 0),
        formattedReclaimableDelta: (() => {
          const d =
            (Number(base.statistics.storageStats.totalReclaimableBytes) || 0) -
            (Number(prev.reclaimableBytes) || 0);
          return d === 0 ? "0 B" : `${d > 0 ? "+" : "-"}${formatBytes(Math.abs(d))}`;
        })()
      };
    }
  }
  return base;
}

export { compareAuditReports };

/**
 * Serialize the audit report to pretty JSON.
 * @param {Object} report
 * @returns {string}
 */
export function formatReportJson(report) {
  return JSON.stringify(report, null, 2);
}

function getStats(report) {
  return report?.statistics ?? buildReportStatistics(report);
}

function renderUnicodeBar(part, total, width = 16) {
  const safeTotal = Number(total) || 0;
  const ratio = safeTotal > 0 ? Math.max(0, Math.min(1, (Number(part) || 0) / safeTotal)) : 0;
  const filled = Math.round(ratio * width);
  return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`;
}

function formatPct(part, total) {
  const safeTotal = Number(total) || 0;
  if (safeTotal <= 0) return "0.0%";
  return `${(((Number(part) || 0) / safeTotal) * 100).toFixed(1)}%`;
}

/**
 * Render a detailed structured Markdown diagnostic report with statistics & visual bars (supports "ru" and "en").
 * @param {Object} report
 * @param {"ru" | "en"} lang
 * @returns {string}
 */
export function formatReportMarkdown(report, lang = "en") {
  const ru = String(lang).toLowerCase().startsWith("ru");
  const { meta = {}, summary = {}, scenes = {}, uuids = {}, settings = {}, flags = {} } = report ?? {};
  const stats = getStats(report);
  const { scoreBreakdown, sceneStats, uuidStats, storageStats } = stats;
  const lines = [];

  lines.push(
    ru
      ? `# WAIFU — Отчёт аудита мира: ${meta.worldTitle ?? "Foundry World"}`
      : `# WAIFU — World Audit Report: ${meta.worldTitle ?? "Foundry World"}`
  );
  lines.push("");
  lines.push(
    ru
      ? `- **Дата аудита:** ${report.generatedAt}`
      : `- **Generated:** ${report.generatedAt}`
  );
  lines.push(
    ru
      ? `- **Система / Foundry:** ${meta.systemId ?? ""} ${meta.systemVersion ?? ""} / Foundry ${meta.foundryVersion ?? ""}`
      : `- **System / Foundry:** ${meta.systemId ?? ""} ${meta.systemVersion ?? ""} / Foundry ${meta.foundryVersion ?? ""}`
  );
  lines.push(
    ru
      ? `- **Модули:** активно ${meta.activeModulesCount ?? 0} из ${meta.installedModulesCount ?? 0} • **Длительность скана:** ${meta.durationMs ?? 0} мс`
      : `- **Modules:** ${meta.activeModulesCount ?? 0} active / ${meta.installedModulesCount ?? 0} installed • **Scan time:** ${meta.durationMs ?? 0} ms`
  );
  lines.push(
    ru
      ? `- **Индекс здоровья мира:** **${summary.healthScore ?? 100}%** (критических: ${summary.criticalCount ?? 0}, предупреждений: ${summary.warningCount ?? 0}, инфо: ${summary.infoCount ?? 0})`
      : `- **World Health Score:** **${summary.healthScore ?? 100}%** (critical: ${summary.criticalCount ?? 0}, warnings: ${summary.warningCount ?? 0}, info: ${summary.infoCount ?? 0})`
  );
  lines.push("");

  // Executive Statistics & Score Breakdown
  lines.push(ru ? "## Сводная статистика и формула индекса здоровья" : "## Executive Statistics & Health Breakdown");
  lines.push("");
  lines.push(
    ru
      ? "| Область аудита | Всего | Проблем | Критич. | Предупр. | Штраф к рейтингу | Распределение |"
      : "| Audit Domain | Total | Issues | Critical | Warning | Score Penalty | Distribution |"
  );
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | --- |");

  const domainLabels = ru
    ? {
        scenes: "Сцены",
        assets: "Текстуры сцен",
        uuids: "Ссылки @UUID",
        settings: "World Settings",
        flags: "Флаги документов"
      }
    : {
        scenes: "Scenes",
        assets: "Scene Textures",
        uuids: "@UUID Links",
        settings: "World Settings",
        flags: "Document Flags"
      };
  const penaltyByCat = Object.fromEntries(scoreBreakdown.categories.map((c) => [c.id, c.penalty]));
  const mapCatKey = { scenes: "scenes", assets: "media", uuids: "uuids", settings: "settings", flags: "flags" };

  for (const row of stats.domainMatrix) {
    const issues = row.critical + row.warning;
    const pen = penaltyByCat[mapCatKey[row.id]] ?? 0;
    const okShare = renderUnicodeBar(row.ok, Math.max(row.total, 1), 12);
    lines.push(
      `| ${domainLabels[row.id] ?? row.id} | ${row.total} | ${issues} | ${row.critical} | ${row.warning} | -${pen} | \`${okShare}\` ${formatPct(row.ok, row.total)} OK |`
    );
  }
  lines.push("");

  // Section 1: Scenes & Media
  lines.push(ru ? "## 1. Тяжёлые сцены и медиа-ресурсы" : "## 1. Heavy Scenes & Media");
  lines.push(
    ru
      ? `Проверено сцен: **${sceneStats.totalScenes}** (в норме: **${sceneStats.healthyScenes} / ${sceneStats.healthyPercent}%**, с проблемами: **${sceneStats.heavyScenesCount}**). PNG-текстур: **${scenes.pngAssetsCount ?? 0}**, всего не-WebP растра: **${scenes.unoptimizedAssetsCount ?? 0}**, дублей/нулевых стен: **${sceneStats.geometryTotals.redundantWallsTotal}**.`
      : `Scenes checked: **${sceneStats.totalScenes}** (healthy: **${sceneStats.healthyScenes} / ${sceneStats.healthyPercent}%**, with issues: **${sceneStats.heavyScenesCount}**). PNG textures: **${scenes.pngAssetsCount ?? 0}**, unoptimized raster: **${scenes.unoptimizedAssetsCount ?? 0}**, redundant/zero walls: **${sceneStats.geometryTotals.redundantWallsTotal}**.`
  );
  lines.push("");

  if (sceneStats.assetFormats.totalAssets > 0) {
    lines.push(ru ? "### Распределение форматов текстур сцен" : "### Scene Texture Format Breakdown");
    lines.push("");
    lines.push(ru ? "| Формат | Кол-во | Доля | Шкала |" : "| Format | Count | Share | Chart |");
    lines.push("| --- | ---: | ---: | --- |");
    const fmtRows = [
      [ru ? "WebP (оптимизировано)" : "WebP (optimized)", sceneStats.assetFormats.webp],
      [ru ? "PNG (тяжёлый растр)" : "PNG (heavy raster)", sceneStats.assetFormats.png],
      [ru ? "JPG / Прочий растр" : "JPG / Other raster", sceneStats.assetFormats.otherRaster],
      [ru ? "Видео (WebM / MP4)" : "Video (WebM / MP4)", sceneStats.assetFormats.video]
    ];
    for (const [label, count] of fmtRows) {
      lines.push(
        `| ${label} | ${count} | ${formatPct(count, sceneStats.assetFormats.totalAssets)} | \`${renderUnicodeBar(count, sceneStats.assetFormats.totalAssets, 16)}\` |`
      );
    }
    lines.push("");
  }

  if (sceneStats.totalScenes > 0) {
    lines.push(ru ? "### Статистика распределения метрик сцен" : "### Scene Metric Distributions");
    lines.push("");
    lines.push(
      ru
        ? "| Метрика | Мин | Среднее | Медиана | P95 | Макс | Сумма |"
        : "| Metric | Min | Avg | Median | P95 | Max | Total |"
    );
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    const d = sceneStats.distributions;
    const distRows = [
      [ru ? "Разрешение (MP)" : "Max Resolution (MP)", d.megapixels],
      [ru ? "Стены (Wall)" : "Walls", d.walls],
      [ru ? "Источники света" : "Ambient Lights", d.lights],
      [ru ? "Анимации" : "Animations", d.animations]
    ];
    for (const [label, stat] of distRows) {
      lines.push(
        `| ${label} | ${stat.min} | ${stat.avg} | ${stat.median} | ${stat.p95} | ${stat.max} | ${stat.total} |`
      );
    }
    lines.push("");
  }

  const problemScenes = (scenes.items ?? []).filter((s) => s.hasIssues);
  if (!problemScenes.length) {
    lines.push(ru ? "_Проблемных сцен не обнаружено._" : "_No heavy scenes detected._");
  } else {
    lines.push(
      ru
        ? "| Сцена | Статус | Рейтинг нагрузки | Макс. разрешение | PNG | Стены | Свет | Анимации |"
        : "| Scene | Status | Heaviness | Max Resolution | PNG | Walls | Lights | Animations |"
    );
    lines.push("| --- | --- | ---: | --- | ---: | ---: | ---: | ---: |");
    for (const s of problemScenes) {
      const res =
        s.maxResolution?.width > 0
          ? `${s.maxResolution.width}×${s.maxResolution.height} (${s.maxResolution.megapixels} MP)`
          : "—";
      lines.push(
        `| ${escapeMdCell(s.name)} | ${s.severity} | ${s.heavinessScore ?? 0} | ${res} | ${s.pngCount ?? 0} | ${s.wallsCount ?? 0} | ${s.lightsCount ?? 0} | ${s.animationsCount ?? 0} |`
      );
    }
  }
  lines.push("");

  // Section 2: Broken UUIDs
  lines.push(
    ru
      ? "## 2. Целостность ссылок @UUID (журналы, Loreframe, актёры)"
      : "## 2. @UUID Reference Integrity (Journals, Loreframe, Actors)"
  );
  lines.push(
    ru
      ? `Проверено ссылок: **${uuidStats.totalScanned}**, валидных: **${uuidStats.validCount} (${uuidStats.validPercent}%)**, битых: **${uuidStats.brokenCount}** (журналы: ${uuidStats.byCategory.journal}, флаги/Loreframe: ${uuidStats.byCategory.loreframe}, актёры: ${uuidStats.byCategory.actor}).`
      : `References scanned: **${uuidStats.totalScanned}**, valid: **${uuidStats.validCount} (${uuidStats.validPercent}%)**, broken: **${uuidStats.brokenCount}** (journals: ${uuidStats.byCategory.journal}, flags/Loreframe: ${uuidStats.byCategory.loreframe}, actors: ${uuidStats.byCategory.actor}).`
  );
  lines.push("");

  if (uuidStats.brokenCount > 0) {
    lines.push(ru ? "### Готовность к автоисправлению @UUID" : "### @UUID Auto-Fix Readiness");
    lines.push("");
    lines.push(ru ? "| Категория | Кол-во | Доля | Шкала |" : "| Readiness | Count | Share | Chart |");
    lines.push("| --- | ---: | ---: | --- |");
    const fixRows = [
      [ru ? "Точное совпадение (100%)" : "Exact Match (100%)", uuidStats.byFixability.exact],
      [ru ? "Похожий кандидат" : "Fuzzy Candidate", uuidStats.byFixability.fuzzy],
      [ru ? "Без кандидата (отвязка/ручн.)" : "No Match (Unlink/Manual)", uuidStats.byFixability.unmatched]
    ];
    for (const [label, count] of fixRows) {
      lines.push(
        `| ${label} | ${count} | ${formatPct(count, uuidStats.brokenCount)} | \`${renderUnicodeBar(count, uuidStats.brokenCount, 16)}\` |`
      );
    }
    lines.push("");
  }

  if (!(uuids.items ?? []).length) {
    lines.push(ru ? "_Битых ссылок не обнаружено._" : "_No broken @UUID links detected._");
  } else {
    lines.push(
      ru
        ? "| Источник | Путь | Битый UUID | Метка | Кандидат замены |"
        : "| Source | Path | Broken UUID | Label | Suggested Candidate |"
    );
    lines.push("| --- | --- | --- | --- | --- |");
    for (const item of uuids.items.slice(0, 100)) {
      const src =
        item.rootDocName === item.targetDocName
          ? item.rootDocName
          : `${item.rootDocName} -> ${item.targetDocName}`;
      const cand = item.bestCandidate
        ? `${item.bestCandidate.name} (${item.bestCandidate.uuid})`
        : "—";
      lines.push(
        `| ${escapeMdCell(src)} | \`${escapeMdCell(item.fieldPath)}\` | \`${escapeMdCell(item.rawUuid)}\` | ${escapeMdCell(item.label || "—")} | ${escapeMdCell(cand)} |`
      );
    }
  }
  lines.push("");

  // Section 3: World Settings & Storage Allocation
  lines.push(ru ? "## 3. World Settings и распределение базы" : "## 3. World Settings & Database Footprint");
  lines.push(
    ru
      ? `Всего записей: **${storageStats.totalSettingsCount}** (${storageStats.formattedSettingsSize}), раздутых: **${settings.bloatedCount ?? 0}**, осиротевших: **${settings.orphanedCount ?? 0}** (${storageStats.formattedReclaimableSettings}). Всего можно освободить (Settings + Flags): **${storageStats.formattedReclaimableTotal} (${storageStats.reclaimablePercent}%)**.`
      : `Total entries: **${storageStats.totalSettingsCount}** (${storageStats.formattedSettingsSize}), bloated: **${settings.bloatedCount ?? 0}**, orphaned: **${settings.orphanedCount ?? 0}** (${storageStats.formattedReclaimableSettings}). Total reclaimable (Settings + Flags): **${storageStats.formattedReclaimableTotal} (${storageStats.reclaimablePercent}%)**.`
  );
  lines.push("");

  lines.push(ru ? "### Распределение World Settings по статусу модулей" : "### World Settings by Module State");
  lines.push("");
  lines.push(ru ? "| Статус | Записей | Объём | Доля | Шкала |" : "| Module State | Entries | Size | Share | Chart |");
  lines.push("| --- | ---: | ---: | ---: | --- |");
  const stateLabels = ru
    ? { core: "Ядро / Система", active: "Активные", inactive: "Отключённые", orphaned: "Удалённые (сироты)" }
    : { core: "Core / System", active: "Active", inactive: "Disabled", orphaned: "Deleted (Orphaned)" };
  for (const st of storageStats.settingsByState) {
    lines.push(
      `| ${stateLabels[st.state] ?? st.state} | ${st.count} | ${st.formattedSize} | ${st.percent}% | \`${renderUnicodeBar(st.bytes, Math.max(storageStats.totalSettingsBytes, 1), 16)}\` |`
    );
  }
  lines.push("");

  if (storageStats.topNamespaces.length > 0) {
    lines.push(ru ? "### Топ пространств имён по объёму (Settings + Flags)" : "### Top Namespaces by Footprint (Settings + Flags)");
    lines.push("");
    lines.push(
      ru
        ? "| Модуль (Namespace) | Статус | Settings | Flags | Итого | Доля |"
        : "| Namespace | State | Settings | Flags | Total | Share |"
    );
    lines.push("| --- | --- | ---: | ---: | ---: | ---: |");
    for (const ns of storageStats.topNamespaces) {
      lines.push(
        `| \`${escapeMdCell(ns.namespace)}\` | ${stateLabels[ns.moduleState] ?? ns.moduleState} | ${ns.formattedSettingsSize} | ${ns.formattedFlagsSize} | ${ns.formattedSize} | ${ns.sharePercent}% |`
      );
    }
    lines.push("");
  }

  if (!(settings.items ?? []).length) {
    lines.push(ru ? "_Проблемных world settings нет._" : "_No bloated or orphaned world settings._");
  } else {
    lines.push(
      ru
        ? "| Ключ | Пространство имён | Статус | Размер |"
        : "| Key | Namespace | Status | Size |"
    );
    lines.push("| --- | --- | --- | ---: |");
    for (const st of settings.items.slice(0, 80)) {
      lines.push(
        `| \`${escapeMdCell(st.key)}\` | \`${escapeMdCell(st.namespace)}\` | ${st.status} | ${st.formattedSize} |`
      );
    }
  }
  lines.push("");

  // Section 4: Orphaned & Bloated Flags
  lines.push(
    ru
      ? "## 4. Осиротевшие и раздутые флаги документов"
      : "## 4. Orphaned & Bloated Document Flags"
  );
  lines.push(
    ru
      ? `Групп флагов: **${flags.groupsCount ?? 0}** (${storageStats.formattedFlagsSize}), от удалённых модулей: **${flags.orphanedNamespacesCount ?? 0}** пространств имён (${flags.orphanedEntriesCount ?? 0} документов, ${storageStats.formattedReclaimableFlags}).`
      : `Flag groups: **${flags.groupsCount ?? 0}** (${storageStats.formattedFlagsSize}), deleted modules: **${flags.orphanedNamespacesCount ?? 0}** namespaces (${flags.orphanedEntriesCount ?? 0} docs, ${storageStats.formattedReclaimableFlags}).`
  );
  lines.push("");

  if (storageStats.flagsByDocType.length > 0) {
    lines.push(
      ru
        ? "| Тип документа | Записей флагов | Размер | Доля |"
        : "| Document Type | Flag Entries | Size | Share |"
    );
    lines.push("| --- | ---: | ---: | ---: |");
    for (const dt of storageStats.flagsByDocType) {
      lines.push(
        `| ${escapeMdCell(dt.docType)} | ${dt.count} | ${dt.formattedSize} | ${dt.percent}% |`
      );
    }
    lines.push("");
  }

  if (!(flags.groups ?? []).length) {
    lines.push(ru ? "_Осиротевших или раздутых флагов нет._" : "_No orphaned or bloated flags._");
  } else {
    lines.push(
      ru
        ? "| Пространство имён | Статус | Документов | Типы | Размер |"
        : "| Namespace | Status | Documents | Types | Size |"
    );
    lines.push("| --- | --- | ---: | --- | ---: |");
    for (const grp of flags.groups.slice(0, 80)) {
      lines.push(
        `| \`${escapeMdCell(grp.namespace)}\` | ${grp.status} | ${grp.docCount} | ${(grp.docTypes ?? []).join(", ")} | ${grp.formattedSize} |`
      );
    }
  }
  lines.push("");

  // Section 5: Recommended Auto-Fixes
  lines.push(
    ru ? "## 5. Предлагаемые автоисправления" : "## 5. Recommended Auto-Fixes"
  );
  if (!(summary.recommendations ?? []).length) {
    lines.push(ru ? "- Автоисправления не требуются." : "- No automated fixes required.");
  } else {
    for (const rec of summary.recommendations) {
      if (rec.id === "convert-scene-webp") {
        lines.push(
          ru
            ? `- **Конвертация растровых карт в WebP:** ${rec.count} файлов (в т.ч. PNG: ${rec.pngCount}).`
            : `- **Convert raster maps to WebP:** ${rec.count} asset(s) (PNG: ${rec.pngCount}).`
        );
      } else if (rec.id === "dedupe-walls") {
        lines.push(
          ru
            ? `- **Очистка дублирующихся/нулевых стен:** ${rec.count} сегментов.`
            : `- **Remove duplicate/zero-length walls:** ${rec.count} segment(s).`
        );
      } else if (rec.id === "apply-exact-uuids") {
        lines.push(
          ru
            ? `- **Автозамена точных совпадений @UUID:** ${rec.count} ссылок.`
            : `- **Auto-replace exact @UUID matches:** ${rec.count} reference(s).`
        );
      } else if (rec.id === "cleanup-orphaned-storage") {
        lines.push(
          ru
            ? `- **Удаление осиротевших настроек и флагов (с бэкапом JSON):** ${rec.settingsCount} настроек + ${rec.flagsCount} флагов (${storageStats.formattedReclaimableTotal}).`
            : `- **Clean orphaned settings & flags (with JSON backup):** ${rec.settingsCount} setting(s) + ${rec.flagsCount} flag(s) (${storageStats.formattedReclaimableTotal}).`
        );
      } else if (rec.id === "dedupe-near-walls") {
        lines.push(
          ru
            ? `- **Очистка почти дублирующихся стен:** ${rec.count} сегментов.`
            : `- **Remove near-duplicate walls:** ${rec.count} segment(s).`
        );
      } else if (rec.id === "cleanup-orphaned-tokens") {
        lines.push(
          ru
            ? `- **Удаление осиротевших токенов без актёров:** ${rec.count} токенов.`
            : `- **Remove orphaned tokens:** ${rec.count} token(s).`
        );
      } else if (rec.id === "prune-chat-log") {
        lines.push(
          ru
            ? `- **Архивация и очистка старого лога чата:** ${rec.count} сообщений.`
            : `- **Archive & prune bloated chat log:** ${rec.count} messages.`
        );
      } else if (rec.id === "cleanup-stale-combats") {
        lines.push(
          ru
            ? `- **Удаление незавершённых/пустых боёв:** ${rec.count}.`
            : `- **Remove stale combats:** ${rec.count}.`
        );
      }
    }
  }

  if (report?.extras) {
    const ex = report.extras;
    lines.push("");
    lines.push(ru ? "## 6. Обслуживание мира (чат, бои, 404-медиа)" : "## 6. World Maintenance (Chat, Combats, 404 Media)");
    lines.push(
      ru
        ? `- **Лог чата:** ${ex.chatMessagesCount ?? 0} сообщений (${ex.formattedChatBytes ?? "0 B"}) • **Зависших боёв:** ${ex.staleCombatsCount ?? 0}/${ex.combatsCount ?? 0} • **Битых 404-медиа (вне сцен):** ${ex.brokenMediaCount ?? 0} • **Неиспользуемых файлов в waifu-optimized:** ${ex.unusedOptimizedCount ?? 0}.`
        : `- **Chat Log:** ${ex.chatMessagesCount ?? 0} messages (${ex.formattedChatBytes ?? "0 B"}) • **Stale Combats:** ${ex.staleCombatsCount ?? 0}/${ex.combatsCount ?? 0} • **Broken 404 Non-Scene Media:** ${ex.brokenMediaCount ?? 0} • **Unused files in waifu-optimized:** ${ex.unusedOptimizedCount ?? 0}.`
    );
  }

  return lines.join("\n");
}

/**
 * Render rich interactive/printable HTML report body with embedded SVG charts and full statistics.
 * Used both inside the WAIFU Report tab and inside standalone `.html` downloads.
 * @param {Object} report
 * @param {{ lang?: "ru" | "en" }} options
 * @returns {string}
 */
export function formatReportHtmlBody(report, options = {}) {
  const lang = String(options.lang ?? "en").toLowerCase().startsWith("ru") ? "ru" : "en";
  const ru = lang === "ru";
  const {
    meta = {},
    thresholds = {},
    summary = {},
    scenes = {},
    uuids = {},
    settings = {},
    flags = {}
  } = report ?? {};
  const stats = getStats(report);
  const charts = buildReportCharts(report, stats, lang);
  const { sceneStats, uuidStats, storageStats, scoreBreakdown } = stats;

  const t = ru
    ? {
        reportTitle: `Отчёт аудита мира: ${meta.worldTitle ?? "Foundry World"}`,
        generated: "Дата сканирования",
        system: "Система / Foundry",
        modules: "Активные модули",
        duration: "Длительность",
        healthTitle: "Индекс здоровья мира",
        healthPenalties: "Слагаемые штрафов к рейтингу",
        kpiScenes: "Сцены и графика",
        kpiScenesSub: `${sceneStats.healthyScenes}/${sceneStats.totalScenes} в норме • PNG: ${scenes.pngAssetsCount ?? 0}`,
        kpiUuids: "Валидность @UUID",
        kpiUuidsSub: `${uuidStats.brokenCount} битых из ${uuidStats.totalScanned}`,
        kpiStorage: "База World Settings",
        kpiStorageSub: `${storageStats.totalSettingsCount} записей • раздуто: ${settings.bloatedCount ?? 0}`,
        kpiReclaim: "Освобождаемый мусор",
        kpiReclaimSub: `${storageStats.reclaimablePercent}% от объёма • сироты-флаги: ${flags.orphanedNamespacesCount ?? 0}`,
        chartMatrix: "Матрица проблем по доменам",
        chartFormats: "Форматы текстур сцен",
        chartHeavyScenes: "Топ тяжёлых сцен (нагрузка)",
        chartResolution: "Разрешение карт (MP и порог)",
        chartUuids: "Целостность @UUID и автофикс",
        chartUuidDocs: "Документы с битыми @UUID",
        chartStorage: "Структура World Settings",
        chartNamespaces: "Крупнейшие модули (Settings + Flags)",
        sectionStats: "Детальная статистика метрик сцен",
        metric: "Метрика",
        min: "Мин",
        avg: "Среднее",
        median: "Медиана",
        p95: "P95",
        max: "Макс",
        total: "Сумма",
        mResolution: "Разрешение (MP)",
        mWalls: "Стены",
        mLights: "Источники света",
        mAnims: "Анимации",
        animSourcesTitle: "Источники анимаций и геометрия мира",
        sectionScenes: "Детализация тяжёлых сцен",
        colScene: "Сцена",
        colStatus: "Статус",
        colScore: "Нагрузка",
        colRes: "Макс. разрешение",
        colWalls: "Стены",
        colLights: "Свет",
        colAnims: "Анимации",
        noHeavyScenes: "Проблемных сцен не обнаружено.",
        sectionUuids: "Реестр битых ссылок @UUID",
        colSource: "Источник",
        colPath: "Путь",
        colBroken: "Битый UUID",
        colReason: "Причина",
        colCandidate: "Кандидат замены",
        noBrokenUuids: "Битых ссылок @UUID не обнаружено.",
        sectionStorage: "Флаги документов и проблемные настройки",
        colNs: "Пространство имён",
        colKey: "Ключ / Типы",
        colDocs: "Док-тов",
        colSize: "Размер",
        noStorageIssues: "Проблемных настроек или флагов не обнаружено.",
        sectionRecs: "План приоритетных действий",
        noRecs: "Все показатели в пределах нормы — автоисправления не требуются."
      }
    : {
        reportTitle: `World Audit Report: ${meta.worldTitle ?? "Foundry World"}`,
        generated: "Scanned At",
        system: "System / Foundry",
        modules: "Active Modules",
        duration: "Scan Time",
        healthTitle: "World Health Index",
        healthPenalties: "Health Score Deductions",
        kpiScenes: "Scenes & Media",
        kpiScenesSub: `${sceneStats.healthyScenes}/${sceneStats.totalScenes} healthy • PNG: ${scenes.pngAssetsCount ?? 0}`,
        kpiUuids: "@UUID Link Validity",
        kpiUuidsSub: `${uuidStats.brokenCount} broken of ${uuidStats.totalScanned}`,
        kpiStorage: "World Settings Size",
        kpiStorageSub: `${storageStats.totalSettingsCount} entries • bloated: ${settings.bloatedCount ?? 0}`,
        kpiReclaim: "Reclaimable Orphan Data",
        kpiReclaimSub: `${storageStats.reclaimablePercent}% of tracked • orphan groups: ${flags.orphanedNamespacesCount ?? 0}`,
        chartMatrix: "Domain Severity Matrix",
        chartFormats: "Scene Texture Format Mix",
        chartHeavyScenes: "Heaviest Scenes (Score)",
        chartResolution: "Map Megapixels vs Limit",
        chartUuids: "@UUID Integrity & Fix Readiness",
        chartUuidDocs: "Top Documents with Broken @UUID",
        chartStorage: "World Settings by Module State",
        chartNamespaces: "Top Namespaces (Settings + Flags)",
        sectionStats: "Scene Metric Distributions",
        metric: "Metric",
        min: "Min",
        avg: "Avg",
        median: "Median",
        p95: "P95",
        max: "Max",
        total: "Total",
        mResolution: "Max Resolution (MP)",
        mWalls: "Walls",
        mLights: "Ambient Lights",
        mAnims: "Animations",
        animSourcesTitle: "Animation Sources & World Geometry Totals",
        sectionScenes: "Heavy Scenes Breakdown",
        colScene: "Scene",
        colStatus: "Status",
        colScore: "Heaviness",
        colRes: "Max Resolution",
        colWalls: "Walls",
        colLights: "Lights",
        colAnims: "Anims",
        noHeavyScenes: "No heavy scenes detected.",
        sectionUuids: "Broken @UUID Registry",
        colSource: "Source Document",
        colPath: "Path",
        colBroken: "Broken UUID",
        colReason: "Reason",
        colCandidate: "Suggested Match",
        noBrokenUuids: "No broken @UUID references detected.",
        sectionStorage: "Flagged Settings & Document Flags",
        colNs: "Namespace",
        colKey: "Key / Document Types",
        colDocs: "Docs",
        colSize: "Size",
        noStorageIssues: "No bloated or orphaned settings or flags.",
        sectionRecs: "Recommended Remediation Plan",
        noRecs: "All audited areas are within thresholds — no auto-fixes needed."
      };

  const d = sceneStats.distributions;
  const distRowsHtml = [
    [t.mResolution, d.megapixels],
    [t.mWalls, d.walls],
    [t.mLights, d.lights],
    [t.mAnims, d.animations]
  ]
    .map(
      ([label, st]) =>
        `<tr><th scope="row">${escapeHtml(label)}</th><td>${st.min}</td><td>${st.avg}</td><td>${st.median}</td><td>${st.p95}</td><td><strong>${st.max}</strong></td><td>${st.total}</td></tr>`
    )
    .join("");

  const problemScenes = (scenes.items ?? []).filter((s) => s.hasIssues);
  const sceneRowsHtml = problemScenes
    .map((s) => {
      const res =
        s.maxResolution?.width > 0
          ? `${s.maxResolution.width}×${s.maxResolution.height} (${s.maxResolution.megapixels} MP)`
          : "—";
      const sevClass = s.severity === "critical" ? "is-critical" : "is-warning";
      return `<tr>
        <th scope="row">${escapeHtml(s.name)}</th>
        <td><span class="waifu-badge ${sevClass}">${escapeHtml(s.severity)}</span></td>
        <td>${s.heavinessScore ?? 0}</td>
        <td>${escapeHtml(res)}</td>
        <td>${s.pngCount ?? 0}</td>
        <td>${s.wallsCount ?? 0}</td>
        <td>${s.lightsCount ?? 0}</td>
        <td>${s.animationsCount ?? 0}</td>
      </tr>`;
    })
    .join("");

  const uuidRowsHtml = (uuids.items ?? [])
    .slice(0, 100)
    .map((item) => {
      const src =
        item.rootDocName === item.targetDocName
          ? item.rootDocName
          : `${item.rootDocName} › ${item.targetDocName}`;
      const cand = item.bestCandidate
        ? `${item.bestCandidate.name} (${Math.round((item.bestCandidate.score ?? 0) * 100)}%)`
        : "—";
      const sevClass = item.severity === "critical" ? "is-critical" : "is-warning";
      return `<tr>
        <th scope="row">${escapeHtml(src)}</th>
        <td><span class="waifu-mono">${escapeHtml(item.fieldPath)}</span></td>
        <td><span class="waifu-mono">${escapeHtml(item.rawUuid)}</span></td>
        <td><span class="waifu-badge ${sevClass}">${escapeHtml(item.reason || "missing")}</span></td>
        <td>${escapeHtml(cand)}</td>
      </tr>`;
    })
    .join("");

  const storageCombinedRows = [
    ...(settings.items ?? []).slice(0, 50).map((s) => ({
      ns: s.namespace,
      target: s.key,
      status: s.status,
      severity: s.severity,
      count: 1,
      size: s.formattedSize
    })),
    ...(flags.groups ?? []).slice(0, 50).map((g) => ({
      ns: g.namespace,
      target: (g.docTypes ?? []).join(", "),
      status: g.status,
      severity: g.severity,
      count: g.docCount,
      size: g.formattedSize
    }))
  ];

  const storageRowsHtml = storageCombinedRows
    .map((r) => {
      const sevClass =
        r.severity === "critical"
          ? "is-critical"
          : r.severity === "warning"
            ? "is-warning"
            : "is-info";
      return `<tr>
        <th scope="row"><span class="waifu-mono">${escapeHtml(r.ns)}</span></th>
        <td><span class="waifu-mono">${escapeHtml(r.target)}</span></td>
        <td><span class="waifu-badge ${sevClass}">${escapeHtml(r.status)}</span></td>
        <td>${r.count}</td>
        <td><strong>${escapeHtml(r.size)}</strong></td>
      </tr>`;
    })
    .join("");

  const recsHtml = (summary.recommendations ?? [])
    .map((rec) => {
      let text = rec.id;
      if (rec.id === "convert-scene-webp") {
        text = ru
          ? `Конвертировать ${rec.count} растровых текстур в WebP (PNG: ${rec.pngCount})`
          : `Convert ${rec.count} raster scene assets to WebP (PNG: ${rec.pngCount})`;
      } else if (rec.id === "dedupe-walls") {
        text = ru
          ? `Удалить ${rec.count} дублирующихся / нулевых сегментов стен`
          : `Remove ${rec.count} duplicate / zero-length wall segments`;
      } else if (rec.id === "apply-exact-uuids") {
        text = ru
          ? `Заменить ${rec.count} битых @UUID по точным совпадениям имён`
          : `Auto-replace ${rec.count} exact-match @UUID references`;
      } else if (rec.id === "cleanup-orphaned-storage") {
        text = ru
          ? `Очистить ${rec.settingsCount} настроек и ${rec.flagsCount} флагов удалённых модулей (${storageStats.formattedReclaimableTotal})`
          : `Clean ${rec.settingsCount} orphaned settings and ${rec.flagsCount} flags (${storageStats.formattedReclaimableTotal})`;
      } else if (rec.id === "dedupe-near-walls") {
        text = ru
          ? `Удалить ${rec.count} почти дублирующихся сегментов стен`
          : `Remove ${rec.count} near-duplicate wall segments`;
      } else if (rec.id === "cleanup-orphaned-tokens") {
        text = ru
          ? `Удалить ${rec.count} осиротевших токенов без актёров`
          : `Remove ${rec.count} orphaned tokens`;
      } else if (rec.id === "prune-chat-log") {
        text = ru
          ? `Архивировать и очистить лог чата (${rec.count} сообщений)`
          : `Archive & prune bloated chat log (${rec.count} messages)`;
      } else if (rec.id === "cleanup-stale-combats") {
        text = ru
          ? `Удалить ${rec.count} незавершённых/пустых боёв`
          : `Remove ${rec.count} stale combat encounters`;
      }
      const badgeTone = rec.priority === "high" ? "is-critical" : "is-warning";
      return `<li><span class="waifu-badge ${badgeTone}">${escapeHtml(rec.priority)}</span> <span>${escapeHtml(text)}</span></li>`;
    })
    .join("");

  const geo = sceneStats.geometryTotals;
  const animSrc = sceneStats.animationSources;

  return `
<article class="waifu-report-doc">
  <header class="waifu-report-banner">
    <div class="waifu-report-banner-main">
      <div class="waifu-report-kicker">WAIFU • WORLD AUDIT &amp; INTEGRITY</div>
      <h2>${escapeHtml(t.reportTitle)}</h2>
      <dl class="waifu-report-meta">
        <div><dt>${escapeHtml(t.generated)}</dt><dd>${escapeHtml(report?.generatedAt ?? "")}</dd></div>
        <div><dt>${escapeHtml(t.system)}</dt><dd>${escapeHtml(`${meta.systemId ?? ""} ${meta.systemVersion ?? ""} • Foundry ${meta.foundryVersion ?? ""}`)}</dd></div>
        <div><dt>${escapeHtml(t.modules)}</dt><dd>${meta.activeModulesCount ?? 0} / ${meta.installedModulesCount ?? 0}</dd></div>
        <div><dt>${escapeHtml(t.duration)}</dt><dd>${meta.durationMs ?? 0} ms</dd></div>
      </dl>
    </div>
    <div class="waifu-report-banner-gauge">
      ${charts.healthGaugeSvg}
      <div class="waifu-report-gauge-meta">
        <span>${escapeHtml(t.healthTitle)}</span>
        <small>-${scoreBreakdown.totalDeduction} pts</small>
      </div>
    </div>
  </header>

  <section class="waifu-exec-grid">
    <div class="waifu-exec-card">
      <span class="waifu-exec-k">${escapeHtml(t.kpiScenes)}</span>
      <strong class="waifu-exec-v">${sceneStats.healthyPercent}%</strong>
      <span class="waifu-exec-sub">${escapeHtml(t.kpiScenesSub)}</span>
    </div>
    <div class="waifu-exec-card">
      <span class="waifu-exec-k">${escapeHtml(t.kpiUuids)}</span>
      <strong class="waifu-exec-v">${uuidStats.validPercent}%</strong>
      <span class="waifu-exec-sub">${escapeHtml(t.kpiUuidsSub)}</span>
    </div>
    <div class="waifu-exec-card">
      <span class="waifu-exec-k">${escapeHtml(t.kpiStorage)}</span>
      <strong class="waifu-exec-v">${escapeHtml(storageStats.formattedSettingsSize)}</strong>
      <span class="waifu-exec-sub">${escapeHtml(t.kpiStorageSub)}</span>
    </div>
    <div class="waifu-exec-card">
      <span class="waifu-exec-k">${escapeHtml(t.kpiReclaim)}</span>
      <strong class="waifu-exec-v">${escapeHtml(storageStats.formattedReclaimableTotal)}</strong>
      <span class="waifu-exec-sub">${escapeHtml(t.kpiReclaimSub)}</span>
    </div>
  </section>

  ${
    charts.penaltyBarHtml
      ? `<section class="waifu-card">
          <h3><span>${escapeHtml(t.healthPenalties)}</span><span class="waifu-mono">-${scoreBreakdown.totalDeduction} / 100</span></h3>
          ${charts.penaltyBarHtml}
        </section>`
      : ""
  }

  <section class="waifu-chart-grid">
    <div class="waifu-card">
      <h3><span>${escapeHtml(t.chartMatrix)}</span></h3>
      ${charts.domainMatrixHtml}
    </div>
    <div class="waifu-card">
      <h3><span>${escapeHtml(t.chartFormats)}</span></h3>
      ${charts.assetFormatDonutHtml}
    </div>
    <div class="waifu-card">
      <h3><span>${escapeHtml(t.chartHeavyScenes)}</span></h3>
      ${charts.heavySceneBarsSvg}
    </div>
    <div class="waifu-card">
      <h3><span>${escapeHtml(t.chartResolution)}</span></h3>
      ${charts.sceneResolutionBarsSvg}
    </div>
    <div class="waifu-card">
      <h3><span>${escapeHtml(t.chartUuids)}</span></h3>
      ${charts.uuidDonutHtml}
    </div>
    <div class="waifu-card">
      <h3><span>${escapeHtml(t.chartUuidDocs)}</span></h3>
      ${charts.uuidTopDocsSvg}
    </div>
    <div class="waifu-card">
      <h3><span>${escapeHtml(t.chartStorage)}</span></h3>
      ${charts.storageDonutHtml}
    </div>
    <div class="waifu-card">
      <h3><span>${escapeHtml(t.chartNamespaces)}</span></h3>
      ${charts.topNamespacesSvg}
    </div>
  </section>

  <section class="waifu-chart-grid">
    <div class="waifu-card">
      <h3><span>${escapeHtml(t.sectionStats)}</span></h3>
      <div class="waifu-table-wrap">
        <table class="waifu-table waifu-stats-table">
          <thead>
            <tr>
              <th>${escapeHtml(t.metric)}</th>
              <th>${escapeHtml(t.min)}</th>
              <th>${escapeHtml(t.avg)}</th>
              <th>${escapeHtml(t.median)}</th>
              <th>${escapeHtml(t.p95)}</th>
              <th>${escapeHtml(t.max)}</th>
              <th>${escapeHtml(t.total)}</th>
            </tr>
          </thead>
          <tbody>${distRowsHtml}</tbody>
        </table>
      </div>
    </div>

    <div class="waifu-card">
      <h3><span>${escapeHtml(t.animSourcesTitle)}</span></h3>
      <div class="waifu-kv"><span>${escapeHtml(ru ? "Уровни / Тайлы / Токены" : "Levels / Tiles / Tokens")}</span><b>${geo.totalLevels} / ${geo.totalTiles} / ${geo.totalTokens}</b></div>
      <div class="waifu-kv"><span>${escapeHtml(ru ? "Стены (Двери / Дубли-нулевые)" : "Walls (Doors / Redundant)")}</span><b>${geo.totalWalls} (${geo.totalDoors} / ${geo.redundantWallsTotal})</b></div>
      <div class="waifu-kv"><span>${escapeHtml(ru ? "Анимации света / токенов" : "Animated Lights / Tokens")}</span><b>${animSrc.animatedLights} / ${animSrc.animatedTokens}</b></div>
      <div class="waifu-kv"><span>${escapeHtml(ru ? "Видео-слоты (тайлы/карты/рис.)" : "Video (Tiles / Levels / Drawings)")}</span><b>${animSrc.videoTiles} / ${animSrc.videoLevelAssets} / ${animSrc.videoDrawings}</b></div>
      <div class="waifu-kv"><span>${escapeHtml(ru ? "Сцены с погодой / Звуки / Регионы" : "Weather Scenes / Sounds / Regions")}</span><b>${animSrc.weatherScenes} / ${geo.totalSounds} / ${geo.totalRegions}</b></div>
      <div class="waifu-kv"><span>${escapeHtml(ru ? "Пороги: разрешение / стены / свет" : "Limits: Res / Walls / Lights")}</span><b>${thresholds.maxTextureResolution ?? 4096}px / ${thresholds.maxWalls ?? 300} / ${thresholds.maxLights ?? 40}</b></div>
    </div>
  </section>

  <section class="waifu-card">
    <h3><span>${escapeHtml(t.sectionRecs)}</span></h3>
    ${recsHtml ? `<ul class="waifu-report-recs">${recsHtml}</ul>` : `<p class="waifu-empty">${escapeHtml(t.noRecs)}</p>`}
  </section>

  <section class="waifu-card">
    <h3><span>${escapeHtml(t.sectionScenes)} (${problemScenes.length})</span></h3>
    ${
      sceneRowsHtml
        ? `<div class="waifu-table-wrap"><table class="waifu-table"><thead><tr><th>${escapeHtml(t.colScene)}</th><th>${escapeHtml(t.colStatus)}</th><th>${escapeHtml(t.colScore)}</th><th>${escapeHtml(t.colRes)}</th><th>PNG</th><th>${escapeHtml(t.colWalls)}</th><th>${escapeHtml(t.colLights)}</th><th>${escapeHtml(t.colAnims)}</th></tr></thead><tbody>${sceneRowsHtml}</tbody></table></div>`
        : `<p class="waifu-empty">${escapeHtml(t.noHeavyScenes)}</p>`
    }
  </section>

  <section class="waifu-card">
    <h3><span>${escapeHtml(t.sectionUuids)} (${uuids.brokenCount ?? 0})</span></h3>
    ${
      uuidRowsHtml
        ? `<div class="waifu-table-wrap"><table class="waifu-table"><thead><tr><th>${escapeHtml(t.colSource)}</th><th>${escapeHtml(t.colPath)}</th><th>${escapeHtml(t.colBroken)}</th><th>${escapeHtml(t.colReason)}</th><th>${escapeHtml(t.colCandidate)}</th></tr></thead><tbody>${uuidRowsHtml}</tbody></table></div>`
        : `<p class="waifu-empty">${escapeHtml(t.noBrokenUuids)}</p>`
    }
  </section>

  <section class="waifu-card">
    <h3><span>${escapeHtml(t.sectionStorage)}</span></h3>
    ${
      storageRowsHtml
        ? `<div class="waifu-table-wrap"><table class="waifu-table"><thead><tr><th>${escapeHtml(t.colNs)}</th><th>${escapeHtml(t.colKey)}</th><th>${escapeHtml(t.colStatus)}</th><th>${escapeHtml(t.colDocs)}</th><th>${escapeHtml(t.colSize)}</th></tr></thead><tbody>${storageRowsHtml}</tbody></table></div>`
        : `<p class="waifu-empty">${escapeHtml(t.noStorageIssues)}</p>`
    }
  </section>
  ${
    report?.extras
      ? `<section class="waifu-card">
          <h3><span>${escapeHtml(ru ? "Обслуживание мира (Чат, Бои, 404-медиа)" : "World Maintenance (Chat, Combats, 404 Media)")}</span></h3>
          <div class="waifu-kv"><span>${escapeHtml(ru ? "Лог чата" : "Chat Log")}</span><b>${report.extras.chatMessagesCount ?? 0} (${escapeHtml(report.extras.formattedChatBytes ?? "0 B")})</b></div>
          <div class="waifu-kv"><span>${escapeHtml(ru ? "Зависшие / пустые бои" : "Stale Combats")}</span><b>${report.extras.staleCombatsCount ?? 0} / ${report.extras.combatsCount ?? 0}</b></div>
          <div class="waifu-kv"><span>${escapeHtml(ru ? "Битые 404-медиа (вне сцен)" : "Broken 404 Non-Scene Media")}</span><b>${report.extras.brokenMediaCount ?? 0}</b></div>
          <div class="waifu-kv"><span>${escapeHtml(ru ? "Неиспользуемые файлы waifu-optimized" : "Unused waifu-optimized Files")}</span><b>${report.extras.unusedOptimizedCount ?? 0}</b></div>
        </section>`
      : ""
  }
</article>`.trim();
}

/**
 * Generate a standalone, self-contained HTML diagnostic report with full SVG charts,
 * Night/Parchment theme support, and print stylesheet.
 * @param {Object} report
 * @param {{ lang?: "ru" | "en", theme?: "night" | "parchment", accent?: string }} options
 * @returns {string}
 */
export function formatReportHtml(report, options = {}) {
  const lang = String(options.lang ?? "en").toLowerCase().startsWith("ru") ? "ru" : "en";
  const theme = THEME_OPTIONS.includes(options.theme) ? options.theme : "night";
  const accent = ACCENT_OPTIONS.includes(options.accent) ? options.accent : "brass";
  const title = escapeHtml(
    lang === "ru"
      ? `WAIFU — Отчёт аудита: ${report?.meta?.worldTitle ?? "Foundry World"}`
      : `WAIFU — World Audit Report: ${report?.meta?.worldTitle ?? "Foundry World"}`
  );
  const bodyHtml = formatReportHtmlBody(report, { lang });

  const standaloneCss = `
@font-face {
  font-family: "WAIFU Display"; font-weight: 400;
  src: local("Palatino Linotype"), local("PalatinoLinotype-Roman"), local("Book Antiqua"), local("Palatino"), local("Palatino-Roman");
  unicode-range: U+0000-024F, U+1E00-1EFF, U+2000-206F, U+20A0-20CF, U+2100-214F;
}
@font-face {
  font-family: "WAIFU Display"; font-weight: 700;
  src: local("Palatino Linotype Bold"), local("PalatinoLinotype-Bold"), local("Book Antiqua Bold"), local("Palatino Bold"), local("Palatino-Bold");
  unicode-range: U+0000-024F, U+1E00-1EFF, U+2000-206F, U+20A0-20CF, U+2100-214F;
}
:root { color-scheme: dark; }
.waifu-root {
  --surface-0: #0e1016; --surface-1: #151821; --surface-2: #1c202c; --surface-3: #252a38;
  --line: rgb(255 255 255 / 0.08); --line-strong: rgb(255 255 255 / 0.16);
  --text: #f0ece1; --text-2: #bfb9ab; --text-3: #9e988c;
  --acc-brass: #d8aa5f; --acc-embers: #e5784f; --acc-arcane: #a486ff;
  --acc-forest: #63c393; --acc-frost: #72baea; --acc-rose: #e37fa4;
  --accent: var(--acc-brass); --accent-ink: #191105;
  --accent-soft: color-mix(in oklab, var(--accent) 16%, transparent);
  --accent-line: color-mix(in oklab, var(--accent) 46%, transparent);
  --hp: #ea7670; --heal: #62c78e; --temp: #5faee8; --arcane: #a486ff; --warn: #eab450;
  --r-xs: 4px; --r-sm: 6px; --r-md: 10px; --r-lg: 14px;
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px;
  --font-ui: "Onest Variable", "Onest", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-display: "WAIFU Display", var(--font-ui);
  --font-num: "Onest Variable", "Onest", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --shadow-1: 0 1px 0 rgb(255 255 255 / 0.05) inset, 0 8px 24px rgb(0 0 0 / 0.36);
}
.waifu-root[data-theme="parchment"] {
  color-scheme: light;
  --surface-0: #efe8d8; --surface-1: #f8f4ea; --surface-2: #e7decb; --surface-3: #ddd1b8;
  --line: rgb(65 42 14 / 0.12); --line-strong: rgb(65 42 14 / 0.24);
  --text: #1c160d; --text-2: #43392b; --text-3: #5f5342; --accent-ink: #fffaf0;
  --hp: #a1231c; --heal: #1e5e3a; --temp: #185888; --arcane: #562cd4; --warn: #6f4e13;
  --acc-brass: #714e16; --acc-embers: #903819; --acc-arcane: #562cd4;
  --acc-forest: #1f5e3e; --acc-frost: #175783; --acc-rose: #a01c4c;
  --shadow-1: 0 1px 0 rgb(255 255 255 / 0.78) inset, 0 6px 18px rgb(65 42 14 / 0.12);
}
.waifu-root[data-accent="brass"] { --accent: var(--acc-brass); }
.waifu-root[data-accent="embers"] { --accent: var(--acc-embers); }
.waifu-root[data-accent="arcane"] { --accent: var(--acc-arcane); }
.waifu-root[data-accent="forest"] { --accent: var(--acc-forest); }
.waifu-root[data-accent="frost"] { --accent: var(--acc-frost); }
.waifu-root[data-accent="rose"] { --accent: var(--acc-rose); }
* { box-sizing: border-box; }
body { margin: 0; padding: 28px 20px 48px; background: var(--surface-0); color: var(--text); font: 0.8125rem/1.5 var(--font-ui); -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; }
svg text { font-family: var(--font-ui); }
.waifu-standalone-wrap { max-width: 1120px; margin: 0 auto; }
.waifu-standalone-bar { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 14px; }
.waifu-standalone-btn {
  padding: 6px 12px; border: 1px solid var(--line-strong); border-radius: var(--r-sm);
  background: var(--surface-1); color: var(--text); font: 500 12px var(--font-ui); cursor: pointer;
}
.waifu-report-doc { display: grid; gap: 16px; }
.waifu-report-banner {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px;
  padding: 20px; border: 1px solid var(--line-strong); border-radius: var(--r-lg);
  background: var(--surface-1); box-shadow: var(--shadow-1);
}
.waifu-report-kicker { font: 600 10.5px var(--font-ui); letter-spacing: 0.14em; color: var(--accent); margin-bottom: 4px; }
.waifu-report-banner h2 { margin: 0 0 12px; font: 700 22px/1.2 var(--font-display); color: var(--text); }
.waifu-report-meta { display: flex; flex-wrap: wrap; gap: 10px 22px; margin: 0; }
.waifu-report-meta dt { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-3); }
.waifu-report-meta dd { margin: 2px 0 0; font-size: 12.5px; color: var(--text-2); font-weight: 500; }
.waifu-report-banner-gauge { display: grid; justify-items: center; gap: 4px; padding: 8px 14px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface-0); }
.waifu-report-gauge-meta { display: flex; gap: 8px; align-items: baseline; font-size: 11px; color: var(--text-2); }
.waifu-gauge-num { font: 700 26px/1 var(--font-num); fill: var(--text); letter-spacing: -0.02em; }
.waifu-gauge-pct { font: 600 13px/1 var(--font-num); fill: var(--text-3); }
.waifu-gauge-sub { font: 600 9.5px/1 var(--font-ui); letter-spacing: 0.08em; text-transform: uppercase; }
.waifu-exec-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
.waifu-exec-card {
  display: grid; gap: 4px; padding: 14px; border: 1px solid var(--line); border-radius: var(--r-lg);
  background: var(--surface-1); box-shadow: var(--shadow-1);
}
.waifu-exec-k { font: 600 10.5px var(--font-ui); letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-3); }
.waifu-exec-v { font: 700 24px/1.1 var(--font-num); font-variant-numeric: tabular-nums; color: var(--text); }
.waifu-exec-sub { font-size: 12px; color: var(--text-2); }
.waifu-chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 14px; }
.waifu-card {
  display: grid; gap: 10px; padding: 14px; border: 1px solid var(--line); border-radius: var(--r-lg);
  background: var(--surface-1); box-shadow: var(--shadow-1); align-content: start;
}
.waifu-card h3 { display: flex; justify-content: space-between; align-items: center; margin: 0; padding-bottom: 8px; border-bottom: 1px solid var(--line); font: 600 14px var(--font-display); color: var(--text); }
.waifu-donut-wrap { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }
.waifu-donut-svg { flex: none; }
.waifu-donut-val { font: 700 17px var(--font-num); fill: var(--text); letter-spacing: -0.02em; }
.waifu-donut-val.is-compact { font-size: 13.5px; }
.waifu-donut-sub { font: 500 9.5px var(--font-ui); fill: var(--text-3); }
.waifu-legend { list-style: none; margin: 0; padding: 0; flex: 1 1 160px; display: grid; gap: 6px; }
.waifu-legend-row { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto auto; align-items: center; gap: 8px; font-size: 12px; }
.waifu-legend-swatch { inline-size: 10px; block-size: 10px; border-radius: 3px; }
.waifu-legend-label { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.waifu-legend-val { font: 600 12px var(--font-num); color: var(--text); font-variant-numeric: tabular-nums; }
.waifu-legend-pct { font: 500 11px var(--font-num); color: var(--text-3); min-width: 40px; text-align: end; }
.waifu-hbar-svg { inline-size: 100%; block-size: auto; display: block; }
.waifu-hbar-label { font: 500 11.5px var(--font-ui); fill: var(--text-2); }
.waifu-hbar-val { font: 600 11px var(--font-num); fill: var(--text); }
.waifu-hbar-limit { font: 600 9.5px var(--font-ui); fill: var(--text-3); }
.waifu-segbar-block { display: grid; gap: 8px; }
.waifu-matrix-wrap { display: grid; gap: 8px; }
.waifu-segbar { display: flex; block-size: 10px; border-radius: 99px; overflow: hidden; background: var(--surface-3); gap: 1px; }
.waifu-seg-fill { block-size: 100%; }
.waifu-seg-legend { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 11.5px; color: var(--text-2); }
.waifu-seg-pill { display: inline-flex; align-items: center; gap: 5px; }
.waifu-seg-pill i { inline-size: 8px; block-size: 8px; border-radius: 2px; display: inline-block; }
.waifu-kv { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; border-bottom: 1px solid var(--line); font-size: 12.5px; color: var(--text-2); }
.waifu-kv:last-child { border-bottom: 0; }
.waifu-kv b { color: var(--text); font-variant-numeric: tabular-nums; }
.waifu-table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--r-md); }
.waifu-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.waifu-stats-table { font-variant-numeric: tabular-nums; }
.waifu-table th, .waifu-table td { padding: 7px 9px; border-bottom: 1px solid var(--line); text-align: start; }
.waifu-table tbody th { font-weight: 600; }
.waifu-table thead th { background: var(--surface-2); color: var(--text-2); font-weight: 600; }
.waifu-mono { font-family: var(--font-mono); font-size: 11px; color: var(--text-2); word-break: break-all; }
.waifu-badge { display: inline-flex; padding: 2px 7px; border-radius: 99px; border: 1px solid var(--line); font: 600 10.5px var(--font-num); }
.waifu-badge.is-critical { border-color: color-mix(in oklab, var(--hp) 55%, transparent); background: color-mix(in oklab, var(--hp) 14%, transparent); color: var(--hp); }
.waifu-badge.is-warning { border-color: color-mix(in oklab, var(--warn) 55%, transparent); background: color-mix(in oklab, var(--warn) 14%, transparent); color: var(--warn); }
.waifu-badge.is-info { border-color: color-mix(in oklab, var(--temp) 55%, transparent); background: color-mix(in oklab, var(--temp) 14%, transparent); color: var(--temp); }
.waifu-badge.is-ok { border-color: color-mix(in oklab, var(--heal) 55%, transparent); background: color-mix(in oklab, var(--heal) 14%, transparent); color: var(--heal); }
.waifu-report-recs { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.waifu-report-recs li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2); }
.waifu-empty, .waifu-chart-empty { color: var(--text-3); margin: 8px 0; font-size: 12px; }
@media print {
  .waifu-standalone-bar { display: none; }
  body { background: #fff; color: #111; padding: 0; }
  .waifu-card, .waifu-exec-card, .waifu-report-banner { box-shadow: none; break-inside: avoid; }
}`;

  const toggleLabel = lang === "ru" ? "Ночь / Пергамент" : "Night / Parchment";
  const printLabel = lang === "ru" ? "Печать / PDF" : "Print / PDF";

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${standaloneCss}</style>
</head>
<body class="waifu-root" data-theme="${theme}" data-accent="${accent}">
  <div class="waifu-standalone-wrap">
    <div class="waifu-standalone-bar">
      <button type="button" class="waifu-standalone-btn" onclick="document.body.dataset.theme = document.body.dataset.theme === 'parchment' ? 'night' : 'parchment'">${escapeHtml(toggleLabel)}</button>
      <button type="button" class="waifu-standalone-btn" onclick="window.print()">${escapeHtml(printLabel)}</button>
    </div>
    ${bodyHtml}
  </div>
</body>
</html>`;
}

/**
 * Generate sanitized semantic HTML content for saving an audit report into a Foundry JournalEntryPage.
 * Avoids inline <style>/<svg> elements that ProseMirror strips while preserving rich statistics and tables.
 * @param {Object} report
 * @param {"ru" | "en"} lang
 * @returns {string}
 */
export function formatReportJournalHtml(report, lang = "en") {
  const ru = String(lang).toLowerCase().startsWith("ru");
  const { meta = {}, summary = {}, scenes = {}, uuids = {}, settings = {}, flags = {} } = report ?? {};
  const stats = getStats(report);
  const { scoreBreakdown, sceneStats, uuidStats, storageStats } = stats;

  const domainLabels = ru
    ? {
        scenes: "Сцены",
        assets: "Текстуры",
        uuids: "Ссылки @UUID",
        settings: "World Settings",
        flags: "Флаги"
      }
    : {
        scenes: "Scenes",
        assets: "Assets",
        uuids: "@UUID Links",
        settings: "World Settings",
        flags: "Document Flags"
      };
  const mapCatKey = { scenes: "scenes", assets: "media", uuids: "uuids", settings: "settings", flags: "flags" };
  const penaltyByCat = Object.fromEntries(scoreBreakdown.categories.map((c) => [c.id, c.penalty]));

  const summaryRows = stats.domainMatrix
    .map((row) => {
      const issues = row.critical + row.warning;
      const pen = penaltyByCat[mapCatKey[row.id]] ?? 0;
      const bar = renderUnicodeBar(row.ok, Math.max(row.total, 1), 12);
      return `<tr><td>${escapeHtml(domainLabels[row.id] ?? row.id)}</td><td>${row.total}</td><td>${issues}</td><td>-${pen}</td><td><code>${escapeHtml(bar)}</code> ${escapeHtml(formatPct(row.ok, row.total))}</td></tr>`;
    })
    .join("");

  const d = sceneStats.distributions;
  const distRows = [
    [ru ? "Разрешение (MP)" : "Resolution (MP)", d.megapixels],
    [ru ? "Стены" : "Walls", d.walls],
    [ru ? "Свет" : "Lights", d.lights],
    [ru ? "Анимации" : "Animations", d.animations]
  ]
    .map(
      ([name, st]) =>
        `<tr><td>${escapeHtml(name)}</td><td>${st.min}</td><td>${st.avg}</td><td>${st.median}</td><td>${st.p95}</td><td>${st.max}</td><td>${st.total}</td></tr>`
    )
    .join("");

  const sceneRows = (scenes.items ?? [])
    .filter((s) => s.hasIssues)
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.severity)}</td><td>${s.heavinessScore ?? 0}</td><td>${
          s.maxResolution?.width
            ? `${s.maxResolution.width}×${s.maxResolution.height} (${s.maxResolution.megapixels} MP)`
            : "—"
        }</td><td>${s.pngCount ?? 0}</td><td>${s.wallsCount ?? 0}</td><td>${s.lightsCount ?? 0}</td><td>${s.animationsCount ?? 0}</td></tr>`
    )
    .join("");

  const uuidRows = (uuids.items ?? [])
    .slice(0, 100)
    .map(
      (u) =>
        `<tr><td>${escapeHtml(u.rootDocName)}</td><td><code>${escapeHtml(u.fieldPath)}</code></td><td><code>${escapeHtml(u.rawUuid)}</code></td><td>${escapeHtml(u.bestCandidate?.name ?? "—")}</td></tr>`
    )
    .join("");

  const flagRows = (flags.groups ?? [])
    .slice(0, 80)
    .map(
      (g) =>
        `<tr><td><code>${escapeHtml(g.namespace)}</code></td><td>${escapeHtml(g.status)}</td><td>${g.docCount}</td><td>${escapeHtml(g.formattedSize)}</td></tr>`
    )
    .join("");

  return [
    `<h1>${escapeHtml(ru ? `WAIFU — Аудит мира: ${meta.worldTitle ?? "Foundry World"}` : `WAIFU — World Audit: ${meta.worldTitle ?? "Foundry World"}`)}</h1>`,
    `<p><strong>${escapeHtml(ru ? "Индекс здоровья" : "Health Score")}:</strong> ${summary.healthScore ?? 100}% • <strong>${escapeHtml(ru ? "Система" : "System")}:</strong> ${escapeHtml(`${meta.systemId ?? ""} ${meta.systemVersion ?? ""}`)} • <strong>${escapeHtml(ru ? "Дата" : "Date")}:</strong> ${escapeHtml(report?.generatedAt ?? "")}</p>`,
    `<h2>${escapeHtml(ru ? "Сводная статистика по доменам" : "Domain Summary Statistics")}</h2>`,
    `<table><thead><tr><th>${escapeHtml(ru ? "Домен" : "Domain")}</th><th>${escapeHtml(ru ? "Всего" : "Total")}</th><th>${escapeHtml(ru ? "Проблем" : "Issues")}</th><th>${escapeHtml(ru ? "Штраф" : "Penalty")}</th><th>${escapeHtml(ru ? "Норма" : "Healthy")}</th></tr></thead><tbody>${summaryRows}</tbody></table>`,
    `<h2>${escapeHtml(ru ? "Сцены и метрики" : "Scenes & Metrics")} (${scenes.heavyScenesCount ?? 0}/${scenes.totalScenes ?? 0})</h2>`,
    `<p>${escapeHtml(ru ? "Форматы текстур" : "Texture Formats")}: WebP ${sceneStats.assetFormats.webp}, PNG ${sceneStats.assetFormats.png}, ${escapeHtml(ru ? "Прочий растр" : "Other Raster")} ${sceneStats.assetFormats.otherRaster}, ${escapeHtml(ru ? "Видео" : "Video")} ${sceneStats.assetFormats.video}.</p>`,
    sceneStats.totalScenes > 0
      ? `<table><thead><tr><th>${escapeHtml(ru ? "Метрика" : "Metric")}</th><th>Min</th><th>Avg</th><th>Median</th><th>P95</th><th>Max</th><th>Total</th></tr></thead><tbody>${distRows}</tbody></table>`
      : "",
    sceneRows
      ? `<table><thead><tr><th>${escapeHtml(ru ? "Сцена" : "Scene")}</th><th>${escapeHtml(ru ? "Статус" : "Status")}</th><th>${escapeHtml(ru ? "Нагрузка" : "Score")}</th><th>${escapeHtml(ru ? "Разрешение" : "Res")}</th><th>PNG</th><th>${escapeHtml(ru ? "Стены" : "Walls")}</th><th>${escapeHtml(ru ? "Свет" : "Lights")}</th><th>${escapeHtml(ru ? "Анимации" : "Anims")}</th></tr></thead><tbody>${sceneRows}</tbody></table>`
      : `<p>${escapeHtml(ru ? "Проблем со сценами нет." : "No scene issues detected.")}</p>`,
    `<h2>${escapeHtml(ru ? "Ссылки @UUID" : "@UUID References")} (${uuidStats.validCount}/${uuidStats.totalScanned} OK, ${uuids.brokenCount ?? 0} ${escapeHtml(ru ? "битых" : "broken")})</h2>`,
    uuidRows
      ? `<table><thead><tr><th>${escapeHtml(ru ? "Источник" : "Source")}</th><th>${escapeHtml(ru ? "Путь" : "Path")}</th><th>UUID</th><th>${escapeHtml(ru ? "Кандидат" : "Candidate")}</th></tr></thead><tbody>${uuidRows}</tbody></table>`
      : `<p>${escapeHtml(ru ? "Битых ссылок не обнаружено." : "No broken @UUID links.")}</p>`,
    `<h2>${escapeHtml(ru ? "Настройки и флаги" : "Settings & Flags")}</h2>`,
    `<p>${escapeHtml(ru ? "World settings" : "World settings")}: ${escapeHtml(storageStats.formattedSettingsSize)} • ${escapeHtml(ru ? "Можно освободить (сироты)" : "Reclaimable (orphaned)")}: ${escapeHtml(storageStats.formattedReclaimableTotal)} (${storageStats.reclaimablePercent}%)</p>`,
    flagRows
      ? `<table><thead><tr><th>Namespace</th><th>${escapeHtml(ru ? "Статус" : "Status")}</th><th>${escapeHtml(ru ? "Документов" : "Docs")}</th><th>${escapeHtml(ru ? "Размер" : "Size")}</th></tr></thead><tbody>${flagRows}</tbody></table>`
      : `<p>${escapeHtml(ru ? "Осиротевших или раздутых флагов нет." : "No orphaned or bloated flags.")}</p>`
  ]
    .filter(Boolean)
    .join("\n");
}

function escapeMdCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}
