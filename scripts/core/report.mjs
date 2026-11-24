import { escapeHtml, formatBytes } from "./utils.mjs";

/**
 * Compute overall world health score (0-100) and prioritized auto-fix recommendations.
 * @param {{ scenes: Object, uuids: Object, settings: Object, flags: Object }} sections
 * @returns {Object}
 */
export function buildAuditSummary(sections) {
  const { scenes, uuids, settings, flags } = sections;

  let penalty = 0;
  penalty += scenes.criticalCount * 14 + scenes.warningCount * 5;
  penalty += Math.min(25, scenes.pngAssetsCount * 3);
  penalty += Math.min(35, uuids.brokenCount * 3);
  penalty += Math.min(18, settings.bloatedCount * 4 + settings.orphanedCount * 2);
  penalty += Math.min(20, flags.orphanedNamespacesCount * 4 + flags.bloatedEntriesCount * 3);

  const healthScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  let healthState = "healthy";
  if (healthScore < 60) healthState = "critical";
  else if (healthScore < 85) healthState = "warning";

  const criticalCount =
    scenes.criticalCount +
    uuids.items.filter((i) => i.severity === "critical").length +
    settings.items.filter((i) => i.severity === "critical").length +
    flags.groups.filter((g) => g.severity === "critical").length;

  const warningCount =
    scenes.warningCount +
    uuids.items.filter((i) => i.severity === "warning").length +
    settings.items.filter((i) => i.severity === "warning").length +
    flags.groups.filter((g) => g.severity === "warning").length;

  const infoCount =
    settings.items.filter((i) => i.severity === "info").length +
    flags.groups.filter((g) => g.severity === "info").length;

  const fixableCounts = {
    sceneWebp: scenes.unoptimizedAssetsCount,
    duplicateWalls: scenes.redundantWallsTotal,
    uuidExact: uuids.exactMatchCount,
    uuidTotal: uuids.brokenCount,
    orphanSettings: settings.orphanedCount,
    orphanFlags: flags.orphanedEntriesCount
  };

  const totalFixable =
    fixableCounts.sceneWebp +
    fixableCounts.duplicateWalls +
    fixableCounts.uuidExact +
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
  if (fixableCounts.uuidExact > 0) {
    recommendations.push({
      id: "apply-exact-uuids",
      priority: "high",
      tab: "uuids",
      action: "batchApplyExactUuids",
      count: fixableCounts.uuidExact
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
 * Create a complete serializable audit report object.
 * @param {Object} params
 * @returns {Object}
 */
export function createAuditReport({ meta, thresholds, scenes, uuids, settings, flags }) {
  const summary = buildAuditSummary({ scenes, uuids, settings, flags });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    meta,
    thresholds,
    summary,
    scenes,
    uuids,
    settings,
    flags
  };
}

/**
 * Serialize the audit report to pretty JSON.
 * @param {Object} report
 * @returns {string}
 */
export function formatReportJson(report) {
  return JSON.stringify(report, null, 2);
}

/**
 * Render a structured Markdown diagnostic report (supports "ru" and "en").
 * @param {Object} report
 * @param {"ru" | "en"} lang
 * @returns {string}
 */
export function formatReportMarkdown(report, lang = "en") {
  const ru = String(lang).toLowerCase().startsWith("ru");
  const { meta, summary, scenes, uuids, settings, flags } = report;
  const lines = [];

  lines.push(
    ru
      ? `# WAIFU — Отчёт аудита мира: ${meta.worldTitle}`
      : `# WAIFU — World Audit Report: ${meta.worldTitle}`
  );
  lines.push("");
  lines.push(
    ru
      ? `- **Дата:** ${report.generatedAt}`
      : `- **Generated:** ${report.generatedAt}`
  );
  lines.push(
    ru
      ? `- **Система / Foundry:** ${meta.systemId} ${meta.systemVersion} / Foundry ${meta.foundryVersion}`
      : `- **System / Foundry:** ${meta.systemId} ${meta.systemVersion} / Foundry ${meta.foundryVersion}`
  );
  lines.push(
    ru
      ? `- **Модули:** активно ${meta.activeModulesCount} из ${meta.installedModulesCount}`
      : `- **Modules:** ${meta.activeModulesCount} active / ${meta.installedModulesCount} installed`
  );
  lines.push(
    ru
      ? `- **Индекс здоровья мира:** ${summary.healthScore}% (критических: ${summary.criticalCount}, предупреждений: ${summary.warningCount})`
      : `- **World Health Score:** ${summary.healthScore}% (critical: ${summary.criticalCount}, warnings: ${summary.warningCount})`
  );
  lines.push("");

  // Section 1: Scenes
  lines.push(ru ? "## 1. Тяжёлые сцены" : "## 1. Heavy Scenes");
  lines.push(
    ru
      ? `Проверено сцен: **${scenes.totalScenes}**, с проблемами: **${scenes.heavyScenesCount}**, PNG-текстур: **${scenes.pngAssetsCount}**, дублей/нулевых стен: **${scenes.redundantWallsTotal}**.`
      : `Scenes checked: **${scenes.totalScenes}**, with issues: **${scenes.heavyScenesCount}**, PNG textures: **${scenes.pngAssetsCount}**, redundant/zero walls: **${scenes.redundantWallsTotal}**.`
  );
  lines.push("");

  const problemScenes = scenes.items.filter((s) => s.hasIssues);
  if (!problemScenes.length) {
    lines.push(ru ? "_Проблемных сцен не обнаружено._" : "_No heavy scenes detected._");
  } else {
    lines.push(
      ru
        ? "| Сцена | Статус | Макс. разрешение | PNG | Стены | Свет | Анимации |"
        : "| Scene | Status | Max Resolution | PNG | Walls | Lights | Animations |"
    );
    lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: |");
    for (const s of problemScenes) {
      const res =
        s.maxResolution.width > 0
          ? `${s.maxResolution.width}×${s.maxResolution.height} (${s.maxResolution.megapixels} MP)`
          : "—";
      lines.push(
        `| ${escapeMdCell(s.name)} | ${s.severity} | ${res} | ${s.pngCount} | ${s.wallsCount} | ${s.lightsCount} | ${s.animationsCount} |`
      );
    }
  }
  lines.push("");

  // Section 2: Broken UUIDs
  lines.push(
    ru
      ? "## 2. Битые ссылки @UUID (журналы, Loreframe, актёры)"
      : "## 2. Broken @UUID References (Journals, Loreframe, Actors)"
  );
  lines.push(
    ru
      ? `Проверено ссылок: **${uuids.totalScanned}**, битых: **${uuids.brokenCount}** (журналы: ${uuids.journalCount}, флаги/Loreframe: ${uuids.loreframeCount}, актёры: ${uuids.actorCount}, точных замен найдено: ${uuids.exactMatchCount}).`
      : `References scanned: **${uuids.totalScanned}**, broken: **${uuids.brokenCount}** (journals: ${uuids.journalCount}, flags/Loreframe: ${uuids.loreframeCount}, actors: ${uuids.actorCount}, exact matches found: ${uuids.exactMatchCount}).`
  );
  lines.push("");

  if (!uuids.items.length) {
    lines.push(ru ? "_Битых ссылок не обнаружено._" : "_No broken @UUID links detected._");
  } else {
    lines.push(
      ru
        ? "| Источник | Путь | Битый UUID | Метка | Кандидат замены |"
        : "| Source | Path | Broken UUID | Label | Suggested Candidate |"
    );
    lines.push("| --- | --- | --- | --- | --- |");
    for (const item of uuids.items.slice(0, 100)) {
      const src = item.rootDocName === item.targetDocName
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

  // Section 3: World Settings
  lines.push(ru ? "## 3. World Settings" : "## 3. World Settings");
  lines.push(
    ru
      ? `Всего записей: **${settings.totalSettingsCount}** (${settings.formattedTotalSize}), раздутых: **${settings.bloatedCount}**, осиротевших: **${settings.orphanedCount}** (${formatBytes(settings.orphanedBytes)}).`
      : `Total entries: **${settings.totalSettingsCount}** (${settings.formattedTotalSize}), bloated: **${settings.bloatedCount}**, orphaned: **${settings.orphanedCount}** (${formatBytes(settings.orphanedBytes)}).`
  );
  lines.push("");

  if (!settings.items.length) {
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
      ? `Групп флагов: **${flags.groupsCount}**, от удалённых модулей: **${flags.orphanedNamespacesCount}** пространств имён (${flags.orphanedEntriesCount} документов, ${flags.formattedOrphanedSize}).`
      : `Flag groups: **${flags.groupsCount}**, deleted modules: **${flags.orphanedNamespacesCount}** namespaces (${flags.orphanedEntriesCount} docs, ${flags.formattedOrphanedSize}).`
  );
  lines.push("");

  if (!flags.groups.length) {
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
        `| \`${escapeMdCell(grp.namespace)}\` | ${grp.status} | ${grp.docCount} | ${grp.docTypes.join(", ")} | ${grp.formattedSize} |`
      );
    }
  }
  lines.push("");

  // Section 5: Recommended Auto-Fixes
  lines.push(
    ru ? "## 5. Предлагаемые автоисправления" : "## 5. Recommended Auto-Fixes"
  );
  if (!summary.recommendations.length) {
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
            ? `- **Удаление осиротевших настроек и флагов (с бэкапом JSON):** ${rec.settingsCount} настроек + ${rec.flagsCount} флагов.`
            : `- **Clean orphaned settings & flags (with JSON backup):** ${rec.settingsCount} setting(s) + ${rec.flagsCount} flag(s).`
        );
      }
    }
  }

  return lines.join("\n");
}

/**
 * Generate sanitized HTML content for saving an audit report into a Foundry JournalEntryPage.
 * @param {Object} report
 * @param {"ru" | "en"} lang
 * @returns {string}
 */
export function formatReportJournalHtml(report, lang = "en") {
  const ru = String(lang).toLowerCase().startsWith("ru");
  const { meta, summary, scenes, uuids, settings, flags } = report;

  const sceneRows = scenes.items
    .filter((s) => s.hasIssues)
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.severity)}</td><td>${
          s.maxResolution.width
            ? `${s.maxResolution.width}×${s.maxResolution.height}`
            : "—"
        }</td><td>${s.pngCount}</td><td>${s.wallsCount}</td><td>${s.lightsCount}</td><td>${s.animationsCount}</td></tr>`
    )
    .join("");

  const uuidRows = uuids.items
    .slice(0, 100)
    .map(
      (u) =>
        `<tr><td>${escapeHtml(u.rootDocName)}</td><td><code>${escapeHtml(u.fieldPath)}</code></td><td><code>${escapeHtml(u.rawUuid)}</code></td><td>${escapeHtml(u.bestCandidate?.name ?? "—")}</td></tr>`
    )
    .join("");

  const flagRows = flags.groups
    .slice(0, 80)
    .map(
      (g) =>
        `<tr><td><code>${escapeHtml(g.namespace)}</code></td><td>${escapeHtml(g.status)}</td><td>${g.docCount}</td><td>${escapeHtml(g.formattedSize)}</td></tr>`
    )
    .join("");

  return [
    `<h1>${escapeHtml(ru ? `WAIFU — Аудит мира: ${meta.worldTitle}` : `WAIFU — World Audit: ${meta.worldTitle}`)}</h1>`,
    `<p><strong>${escapeHtml(ru ? "Индекс здоровья" : "Health Score")}:</strong> ${summary.healthScore}% • <strong>${escapeHtml(ru ? "Дата" : "Date")}:</strong> ${escapeHtml(report.generatedAt)}</p>`,
    `<h2>${escapeHtml(ru ? "Сцены" : "Scenes")} (${scenes.heavyScenesCount}/${scenes.totalScenes})</h2>`,
    sceneRows
      ? `<table><thead><tr><th>${escapeHtml(ru ? "Сцена" : "Scene")}</th><th>${escapeHtml(ru ? "Статус" : "Status")}</th><th>${escapeHtml(ru ? "Разрешение" : "Res")}</th><th>PNG</th><th>${escapeHtml(ru ? "Стены" : "Walls")}</th><th>${escapeHtml(ru ? "Свет" : "Lights")}</th><th>${escapeHtml(ru ? "Анимации" : "Anims")}</th></tr></thead><tbody>${sceneRows}</tbody></table>`
      : `<p>${escapeHtml(ru ? "Проблем со сценами нет." : "No scene issues detected.")}</p>`,
    `<h2>${escapeHtml(ru ? "Битые @UUID" : "Broken @UUID")} (${uuids.brokenCount})</h2>`,
    uuidRows
      ? `<table><thead><tr><th>${escapeHtml(ru ? "Источник" : "Source")}</th><th>${escapeHtml(ru ? "Путь" : "Path")}</th><th>UUID</th><th>${escapeHtml(ru ? "Кандидат" : "Candidate")}</th></tr></thead><tbody>${uuidRows}</tbody></table>`
      : `<p>${escapeHtml(ru ? "Битых ссылок не обнаружено." : "No broken @UUID links.")}</p>`,
    `<h2>${escapeHtml(ru ? "Настройки и флаги" : "Settings & Flags")}</h2>`,
    `<p>${escapeHtml(ru ? "World settings" : "World settings")}: ${escapeHtml(settings.formattedTotalSize)} (${settings.orphanedCount} ${escapeHtml(ru ? "сирот" : "orphaned")})</p>`,
    flagRows
      ? `<table><thead><tr><th>Namespace</th><th>${escapeHtml(ru ? "Статус" : "Status")}</th><th>${escapeHtml(ru ? "Документов" : "Docs")}</th><th>${escapeHtml(ru ? "Размер" : "Size")}</th></tr></thead><tbody>${flagRows}</tbody></table>`
      : `<p>${escapeHtml(ru ? "Осиротевших или раздутых флагов нет." : "No orphaned or bloated flags.")}</p>`
  ].join("\n");
}

function escapeMdCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}
