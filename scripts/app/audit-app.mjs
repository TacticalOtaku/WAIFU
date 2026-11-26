import { ACCENT_OPTIONS, MODULE_ID, SEVERITY_ORDER, THEME_OPTIONS } from "../constants.mjs";
import { buildReportCharts } from "../core/charts.mjs";
import {
  compareAuditReports,
  formatReportHtml,
  formatReportHtmlBody,
  formatReportJournalHtml,
  formatReportJson,
  formatReportMarkdown
} from "../core/report.mjs";
import { buildReportStatistics } from "../core/statistics.mjs";
import { escapeHtml, formatBytes, interpolate } from "../core/utils.mjs";
import { searchUuidCatalog } from "../core/uuid-audit.mjs";
import {
  archiveAndPruneChatMessages,
  batchPatchUuidOccurrences,
  cleanupRedundantWalls,
  cleanupStaleCombats,
  convertSceneAssetsToWebp,
  deleteFlagGroup,
  deleteSingleDocumentFlag,
  deleteWorldSettingByKey,
  deleteWorldSettingsBatch,
  disableLightAnimations,
  downloadStorageBackup,
  focusSceneOnCanvas,
  parseBackupPayload,
  patchDocumentUuidOccurrence,
  removeOrphanedTokens,
  restoreBackupPayload,
  snapshotWallsForBackup
} from "../foundry/auto-fixer.mjs";
import {
  buildCandidateCatalog,
  readIgnoreRules,
  readThresholdSettings,
  runWorldAudit,
  toggleIgnoreRule
} from "../foundry/world-audit-runner.mjs";

const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEXT_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Foundry v14 ApplicationV2 diagnostic report workspace for world auditing and safe auto-fixes.
 */
export class WaifuAuditApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this._report = options.report ?? null;
    this._customComparison = null;
    this._activeTab = "hub";
    this._drawerSceneId = null;
    this._autofixChecked = new Set();
    this._autofixQueueStamp = null;
    this._autofixBackupFirst = true;
    this._reportMode = "visual";
    this._busy = false;
    this._progressPercent = 0;
    this._progressLabel = "";
    this._abortController = null;
    this._updateUuidLabel = false;
    this._appearanceOpen = false;
    this._statusMessage = "";
    this._filters = {
      scenesQuery: "",
      scenesTag: "all",
      uuidsQuery: "",
      uuidsTag: "all",
      storageQuery: "",
      storageTag: "all"
    };
    this._sortState = {};
    this._scrollState = {};
    this._resizeObserver = null;
    this._docClickListener = null;
  }

  static DEFAULT_OPTIONS = {
    id: "waifu-audit-window",
    tag: "div",
    classes: ["waifu-window", "waifu-root"],
    window: {
      title: "WAIFU.WindowTitle",
      icon: "fa-solid fa-stethoscope",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 1180,
      height: 820
    },
    actions: {
      runAudit: WaifuAuditApp.#onRunAudit,
      cancelOperation: WaifuAuditApp.#onCancelOperation,
      selectTab: WaifuAuditApp.#onSelectTab,
      drillDown: WaifuAuditApp.#onDrillDown,
      goHub: WaifuAuditApp.#onGoHub,
      openSceneDrawer: WaifuAuditApp.#onOpenSceneDrawer,
      closeSceneDrawer: WaifuAuditApp.#onCloseSceneDrawer,
      closeDrawerBackdrop: WaifuAuditApp.#onCloseDrawerBackdrop,
      toggleAutofixItem: WaifuAuditApp.#onToggleAutofixItem,
      toggleAutofixBackupFirst: WaifuAuditApp.#onToggleAutofixBackupFirst,
      executeSelectedAutofixes: WaifuAuditApp.#onExecuteSelectedAutofixes,
      saveInlineThresholds: WaifuAuditApp.#onSaveInlineThresholds,
      openFoundrySettings: WaifuAuditApp.#onOpenFoundrySettings,
      setReportMode: WaifuAuditApp.#onSetReportMode,
      toggleAppearanceMenu: WaifuAuditApp.#onToggleAppearanceMenu,
      setTheme: WaifuAuditApp.#onSetTheme,
      setAccent: WaifuAuditApp.#onSetAccent,
      openModuleSettings: WaifuAuditApp.#onOpenModuleSettings,
      setSceneFilter: WaifuAuditApp.#onSetSceneFilter,
      setUuidFilter: WaifuAuditApp.#onSetUuidFilter,
      setStorageFilter: WaifuAuditApp.#onSetStorageFilter,
      sortTable: WaifuAuditApp.#onSortTable,
      convertSingleAsset: WaifuAuditApp.#onConvertSingleAsset,
      batchConvertWebp: WaifuAuditApp.#onBatchConvertWebp,
      dedupeSceneWalls: WaifuAuditApp.#onDedupeSceneWalls,
      batchDedupeWalls: WaifuAuditApp.#onBatchDedupeWalls,
      dedupeNearWalls: WaifuAuditApp.#onDedupeNearWalls,
      batchDedupeNearWalls: WaifuAuditApp.#onBatchDedupeNearWalls,
      cleanOrphanTokens: WaifuAuditApp.#onCleanOrphanTokens,
      batchCleanOrphanTokens: WaifuAuditApp.#onBatchCleanOrphanTokens,
      disableSceneLightAnims: WaifuAuditApp.#onDisableSceneLightAnims,
      focusSceneCanvas: WaifuAuditApp.#onFocusSceneCanvas,
      toggleUpdateUuidLabel: WaifuAuditApp.#onToggleUpdateUuidLabel,
      applySingleUuid: WaifuAuditApp.#onApplySingleUuid,
      pickUuidManual: WaifuAuditApp.#onPickUuidManual,
      unlinkSingleUuid: WaifuAuditApp.#onUnlinkSingleUuid,
      batchApplyExactUuids: WaifuAuditApp.#onBatchApplyExactUuids,
      batchUnlinkNoMatch: WaifuAuditApp.#onBatchUnlinkNoMatch,
      inspectSetting: WaifuAuditApp.#onInspectSetting,
      deleteSingleSetting: WaifuAuditApp.#onDeleteSingleSetting,
      deleteAllOrphanSettings: WaifuAuditApp.#onDeleteAllOrphanSettings,
      inspectFlagGroup: WaifuAuditApp.#onInspectFlagGroup,
      deleteFlagGroup: WaifuAuditApp.#onDeleteFlagGroup,
      deleteAllOrphanFlags: WaifuAuditApp.#onDeleteAllOrphanFlags,
      cleanupAllOrphans: WaifuAuditApp.#onCleanupAllOrphans,
      fixAllRecommended: WaifuAuditApp.#onFixAllRecommended,
      backupStorage: WaifuAuditApp.#onBackupStorage,
      restoreBackup: WaifuAuditApp.#onRestoreBackup,
      compareReportFile: WaifuAuditApp.#onCompareReportFile,
      clearComparison: WaifuAuditApp.#onClearComparison,
      toggleIgnoreItem: WaifuAuditApp.#onToggleIgnoreItem,
      manageIgnoreRules: WaifuAuditApp.#onManageIgnoreRules,
      archiveChatMessages: WaifuAuditApp.#onArchiveChatMessages,
      cleanStaleCombats: WaifuAuditApp.#onCleanStaleCombats,
      exportHtml: WaifuAuditApp.#onExportHtml,
      exportMarkdown: WaifuAuditApp.#onExportMarkdown,
      exportJson: WaifuAuditApp.#onExportJson,
      copyMarkdown: WaifuAuditApp.#onCopyMarkdown,
      saveJournalReport: WaifuAuditApp.#onSaveJournalReport,
      openDocumentSheet: WaifuAuditApp.#onOpenDocumentSheet
    }
  };

  static PARTS = {
    masthead: {
      template: `modules/${MODULE_ID}/templates/masthead.hbs`
    },
    main: {
      template: `modules/${MODULE_ID}/templates/main.hbs`,
      scrollable: [".waifu-panel"]
    }
  };

  /**
   * Ensure singleton window opens cleanly and triggers initial audit if empty.
   * @param {Object | null} initialReport
   * @returns {WaifuAuditApp}
   */
  static openWindow(initialReport = null) {
    const existing = foundry.applications.instances.get(WaifuAuditApp.DEFAULT_OPTIONS.id);
    if (existing) {
      if (initialReport) existing._report = initialReport;
      existing.render({ force: true });
      return existing;
    }
    const app = new WaifuAuditApp({ report: initialReport });
    app.render({ force: true });
    if (!app._report) {
      queueMicrotask(() => app.executeAudit());
    }
    return app;
  }

  #t(key, params = null) {
    const raw = game.i18n.localize(key);
    return params ? interpolate(raw, params) : raw;
  }

  #getLang() {
    return String(game.i18n?.lang ?? "en").toLowerCase().startsWith("ru") ? "ru" : "en";
  }

  #getAppearance() {
    let theme = "night";
    let accent = "brass";
    try {
      const storedTheme = game.settings.get(MODULE_ID, "theme");
      if (THEME_OPTIONS.includes(storedTheme)) theme = storedTheme;
      const storedAccent = game.settings.get(MODULE_ID, "accent");
      if (ACCENT_OPTIONS.includes(storedAccent)) accent = storedAccent;
    } catch {
      // Fallback to defaults if accessed before settings init
    }
    return { theme, accent };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const report = this._report;
    const { theme, accent } = this.#getAppearance();
    const thresholds = report?.thresholds ?? readThresholdSettings();
    const lang = this.#getLang();

    const emptyScenes = {
      totalScenes: 0,
      heavyScenesCount: 0,
      criticalCount: 0,
      warningCount: 0,
      pngAssetsCount: 0,
      unoptimizedAssetsCount: 0,
      oversizedAssetsCount: 0,
      redundantWallsTotal: 0,
      items: [],
      convertibleAssets: []
    };
    const emptyUuids = {
      totalScanned: 0,
      brokenCount: 0,
      journalCount: 0,
      loreframeCount: 0,
      actorCount: 0,
      exactMatchCount: 0,
      withCandidateCount: 0,
      items: []
    };
    const emptySettings = {
      totalSettingsCount: 0,
      totalBytes: 0,
      formattedTotalSize: "0 B",
      flaggedCount: 0,
      bloatedCount: 0,
      orphanedCount: 0,
      orphanedBytes: 0,
      items: [],
      byNamespace: []
    };
    const emptyFlags = {
      totalFlaggedEntries: 0,
      groupsCount: 0,
      orphanedEntriesCount: 0,
      orphanedNamespacesCount: 0,
      orphanedBytes: 0,
      formattedOrphanedSize: "0 B",
      groups: [],
      items: []
    };
    const emptySummary = {
      healthScore: 100,
      healthState: "healthy",
      totalIssues: 0,
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
      totalFixable: 0,
      recommendations: []
    };

    const scenes = report?.scenes ?? emptyScenes;
    const uuids = report?.uuids ?? emptyUuids;
    const settings = report?.settings ?? emptySettings;
    const flags = report?.flags ?? emptyFlags;
    const extras = report?.extras ?? {
      chatMessagesCount: 0,
      chatBytes: 0,
      formattedChatBytes: "0 B",
      maxChatMessages: thresholds.maxChatMessages ?? 1000,
      chatBloated: false,
      combatsCount: 0,
      staleCombatsCount: 0,
      staleCombats: [],
      brokenMediaCount: 0,
      brokenMedia: [],
      unusedOptimizedCount: 0,
      unusedOptimizedFiles: []
    };
    const summaryRaw = report?.summary ?? emptySummary;
    const summary = {
      ...summaryRaw,
      healthStateBadge: summaryRaw.healthState === "healthy" ? "ok" : summaryRaw.healthState
    };

    const effectiveReport = report ?? {
      meta: {},
      thresholds,
      summary,
      scenes,
      uuids,
      settings,
      flags,
      extras
    };
    const stats = report?.statistics ?? buildReportStatistics(effectiveReport);
    const charts = buildReportCharts(effectiveReport, stats, lang);

    const activeModules = [...(game.modules ?? [])].filter((m) => m.active).length;
    const installedModules = game.modules?.size ?? 0;

    const storageIssuesTotal = settings.flaggedCount + flags.groupsCount;
    const validDomains = new Set(["health", "autofix", "scenes", "uuids", "storage", "report"]);
    if (this._activeTab !== "hub" && !validDomains.has(this._activeTab)) {
      this._activeTab = "hub";
    }

    const domainMeta = {
      health: { title: this.#t("WAIFU.Domains.HealthFull") },
      autofix: { title: this.#t("WAIFU.Domains.AutofixFull") },
      scenes: { title: this.#t("WAIFU.Domains.ScenesFull") },
      uuids: { title: this.#t("WAIFU.Domains.UuidsFull") },
      storage: { title: this.#t("WAIFU.Domains.StorageFull") },
      report: { title: this.#t("WAIFU.Domains.ReportFull") }
    };

    const drillPills = [
      { id: "health", shortLabel: this.#t("WAIFU.Domains.HealthShort"), count: 0, hasCount: false },
      { id: "autofix", shortLabel: this.#t("WAIFU.Domains.AutofixShort"), count: summary.totalFixable, hasCount: summary.totalFixable > 0 },
      { id: "scenes", shortLabel: this.#t("WAIFU.Domains.ScenesShort"), count: scenes.heavyScenesCount, hasCount: scenes.heavyScenesCount > 0 },
      { id: "uuids", shortLabel: this.#t("WAIFU.Domains.UuidsShort"), count: uuids.brokenCount, hasCount: uuids.brokenCount > 0 },
      { id: "storage", shortLabel: this.#t("WAIFU.Domains.StorageShort"), count: storageIssuesTotal, hasCount: storageIssuesTotal > 0 },
      { id: "report", shortLabel: this.#t("WAIFU.Domains.ReportShort"), count: 0, hasCount: false }
    ].map((p) => ({ ...p, active: p.id === this._activeTab }));

    const mapSceneRow = (scene) => {
      const tags = scene.isIgnored ? ["ignored"] : ["all"];
      if (!scene.isIgnored) {
        if (scene.hasIssues) tags.push("heavy");
        if (scene.flags?.hasUnoptimizedRaster) tags.push("png");
        if (scene.flags?.excessiveWalls || scene.flags?.excessiveLights || scene.flags?.excessiveAnimations) {
          tags.push("geometry");
        }
        if (scene.flags?.hasMissingAsset || scene.flags?.hasHeavyBytes) {
          tags.push("missing");
        }
      }

      const issueAssets = (scene.assets ?? [])
        .filter((asset) => asset.isUnoptimizedRaster || asset.isOversized || asset.isMissing || asset.isHeavyBytes)
        .map((asset) => ({
          ...asset,
          slotLabel:
            asset.slotType === "tile"
              ? "Tile"
              : asset.levelName
                ? `${asset.levelName}`
                : asset.slotType === "scene-foreground"
                  ? "FG"
                  : "BG"
        }));

      const assetPaths = (scene.assets ?? []).map((a) => a.src).join(" ");
      return {
        ...scene,
        severityRank: SEVERITY_ORDER[scene.severity] ?? 0,
        severityLabel: this.#t(`WAIFU.Severity.${scene.severity}`),
        issueAssets,
        issueAssetsPrimary: issueAssets.slice(0, 3),
        issueAssetsExtra: issueAssets.slice(3),
        hasExcessiveAnimsWithLights:
          scene.flags?.excessiveAnimations && scene.animatedLightIds?.length > 0,
        filterTags: tags.join(" "),
        searchText: `${scene.name} ${assetPaths}`.toLowerCase()
      };
    };
    const sceneRows = [
      ...(scenes.items ?? []).map(mapSceneRow),
      ...(scenes.ignoredItems ?? []).map(mapSceneRow)
    ];

    const mapUuidRow = (item) => {
      const tags = item.isIgnored ? ["ignored"] : ["all", item.sourceCategory];
      if (!item.isIgnored && item.bestCandidate) tags.push("matched");
      const sourceTitle =
        item.rootDocName === item.targetDocName
          ? item.rootDocName
          : `${item.rootDocName} › ${item.targetDocName}`;
      return {
        ...item,
        sourceTitle,
        sourceBadge: item.loreframeTemplate
          ? `Loreframe: ${item.loreframeTemplate}`
          : item.isLoreframe
            ? "Loreframe / Flags"
            : item.targetDocType,
        reasonLabel: this.#t(`WAIFU.Uuids.Reason.${item.reason}`),
        candidates: (item.candidates ?? []).map((cand) => ({
          ...cand,
          percent: Math.round(cand.score * 100)
        })),
        filterTags: tags.join(" "),
        searchText: `${sourceTitle} ${item.fieldPath} ${item.rawUuid} ${item.label}`.toLowerCase()
      };
    };
    const uuidRows = [
      ...(uuids.items ?? []).map(mapUuidRow),
      ...(uuids.ignoredItems ?? []).map(mapUuidRow)
    ];

    const mapSettingRow = (item) => ({
      ...item,
      filterTags: item.isIgnored ? "ignored" : `all ${item.status}`,
      statusLabel: this.#t(`WAIFU.Storage.Status.${item.status}`),
      searchText: `${item.namespace} ${item.settingKey} ${item.status}`.toLowerCase()
    });
    const settingRows = [
      ...(settings.items ?? []).map(mapSettingRow),
      ...(settings.ignoredItems ?? []).map(mapSettingRow)
    ];

    const mapFlagGroupRow = (group) => ({
      ...group,
      filterTags: group.isIgnored ? "ignored" : `all ${group.status}`,
      docTypesLabel: group.docTypes.join(", "),
      statusLabel: this.#t(`WAIFU.Storage.Status.${group.status}`),
      searchText: `${group.namespace} ${group.docTypes.join(" ")} ${group.status}`.toLowerCase()
    });
    const flagGroupRows = [
      ...(flags.groups ?? []).map(mapFlagGroupRow),
      ...(flags.ignoredGroups ?? []).map(mapFlagGroupRow)
    ];

    const recommendations = summary.recommendations.map((rec) => {
      if (rec.id === "convert-scene-webp") {
        return {
          ...rec,
          label: this.#t("WAIFU.Overview.ApplySceneWebp", { count: rec.count }),
          detail: `PNG: ${rec.pngCount} / Total raster: ${rec.count}`
        };
      }
      if (rec.id === "dedupe-walls") {
        return {
          ...rec,
          label: this.#t("WAIFU.Overview.ApplyWallCleanup", { count: rec.count }),
          detail: "Zero-length & exact duplicate Wall segments"
        };
      }
      if (rec.id === "dedupe-near-walls") {
        return {
          ...rec,
          label: this.#t("WAIFU.Overview.ApplyNearWallCleanup", { count: rec.count }),
          detail: `<= ${thresholds.nearDuplicateWallTolerance ?? 2}px tolerance`
        };
      }
      if (rec.id === "cleanup-orphaned-tokens") {
        return {
          ...rec,
          label: this.#t("WAIFU.Overview.ApplyOrphanTokenCleanup", { count: rec.count }),
          detail: "Missing linked Actor"
        };
      }
      if (rec.id === "apply-exact-uuids") {
        return {
          ...rec,
          label: this.#t("WAIFU.Overview.ApplyUuidExact", { count: rec.count }),
          detail: `>= ${Math.round((thresholds.uuidMinAutoConfidence ?? 1) * 100)}% confidence`
        };
      }
      if (rec.id === "prune-chat-log") {
        return {
          ...rec,
          label: this.#t("WAIFU.Extras.ChatTitle"),
          detail: `${rec.count} messages (${extras.formattedChatBytes})`
        };
      }
      if (rec.id === "cleanup-stale-combats") {
        return {
          ...rec,
          label: this.#t("WAIFU.Extras.StaleCombatsTitle"),
          detail: `${rec.count} unstarted / empty`
        };
      }
      return {
        ...rec,
        label: this.#t("WAIFU.Overview.ApplyOrphanCleanup", { count: rec.count }),
        detail: `Settings: ${rec.settingsCount} • Flags: ${rec.flagsCount} (${stats.storageStats.formattedReclaimableTotal})`
      };
    });

    const d = stats.sceneStats.distributions;
    const sceneDistributionRows = [
      { label: this.#t("WAIFU.Stats.MetricRes"), ...d.megapixels },
      { label: this.#t("WAIFU.Stats.MetricWalls"), ...d.walls },
      { label: this.#t("WAIFU.Stats.MetricLights"), ...d.lights },
      { label: this.#t("WAIFU.Stats.MetricAnims"), ...d.animations }
    ];

    const markdownPreview = report ? formatReportMarkdown(report, lang) : "";
    const visualReportHtml = report ? formatReportHtmlBody(report, { lang }) : "";
    const journalPreviewHtml = report ? formatReportJournalHtml(report, lang) : "";

    const rawComparison = this._customComparison ?? report?.comparison ?? null;
    const formatSigned = (n) => (n > 0 ? `+${n}` : String(n));
    const comparison = rawComparison
      ? {
          ...rawComparison,
          isHealthUp: rawComparison.healthDelta > 0,
          isHealthDown: rawComparison.healthDelta < 0,
          healthDeltaLabel: `${formatSigned(rawComparison.healthDelta)}%`,
          issuesDeltaLabel: formatSigned(rawComparison.issuesDelta ?? 0),
          uuidsDeltaLabel: formatSigned(rawComparison.brokenUuidsDelta ?? 0),
          reclaimableDelta: rawComparison.formattedReclaimableDelta ?? "0 B"
        }
      : null;

    const ignoreRules = readIgnoreRules();
    const totalIgnoredCount =
      ignoreRules.scenes.length +
      ignoreRules.settings.length +
      ignoreRules.flags.length +
      ignoreRules.uuids.length;

    const uuidsAutoCount = uuids.autoMatchCount ?? uuids.exactMatchCount ?? 0;
    const uuidsUnmatchedCount =
      uuids.unmatchedCount ??
      (uuids.items ?? []).filter((item) => !item.bestCandidate).length;

    const storageIgnoredCount =
      (settings.ignoredCount ?? 0) + (flags.ignoredGroupsCount ?? 0);

    // Synchronize interactive Dry-Run Autofix Queue when a new audit report arrives
    const safeRecs = recommendations.filter((rec) =>
      ["convert-scene-webp", "dedupe-walls", "dedupe-near-walls", "cleanup-orphaned-tokens", "apply-exact-uuids", "cleanup-orphaned-storage"].includes(rec.id)
    );
    const stamp = report?.generatedAt ?? "__empty__";
    if (this._autofixQueueStamp !== stamp) {
      this._autofixQueueStamp = stamp;
      this._autofixChecked = new Set(
        safeRecs.filter((rec) => rec.id !== "dedupe-near-walls").map((rec) => rec.id)
      );
    }
    const tabShortMap = {
      scenes: this.#t("WAIFU.Domains.ScenesShort"),
      uuids: this.#t("WAIFU.Domains.UuidsShort"),
      storage: this.#t("WAIFU.Domains.StorageShort")
    };
    const autofixQueue = safeRecs.map((rec) => ({
      ...rec,
      tabLabel: tabShortMap[rec.tab] ?? rec.tab,
      checked: this._autofixChecked.has(rec.id)
    }));
    const autofixSelectedCount = autofixQueue.filter((item) => item.checked).length;

    const shortActionLabel = (recId) => {
      if (recId === "convert-scene-webp") return this.#t("WAIFU.Scenes.BtnConvertWebp");
      if (recId === "dedupe-walls" || recId === "dedupe-near-walls") return this.#t("WAIFU.Scenes.BtnDedupeWalls");
      if (recId === "apply-exact-uuids") return this.#t("WAIFU.Uuids.BtnApply");
      if (recId === "cleanup-orphaned-storage") return this.#t("WAIFU.Hub.W5Action");
      return this.#t("WAIFU.Autofix.BtnCleanShort");
    };
    const hubAutofixPreview = safeRecs.slice(0, 3).map((rec, idx) => ({
      ...rec,
      primary: idx === 0,
      btnText: shortActionLabel(rec.id)
    }));

    const hubTopScenes = (scenes.items ?? []).slice(0, 2).map((sc) => {
      const hasRes = sc.maxResolution?.megapixels > 0;
      const metric = hasRes
        ? `${sc.maxResolution.megapixels} MP${sc.pngCount ? " • PNG" : ""}${sc.totalKnownAssetBytes ? ` • ${sc.formattedTotalAssetBytes}` : ""}`
        : `${sc.wallsCount} ${this.#t("WAIFU.Stats.WallsCountShort")}${sc.redundantWallIds?.length ? ` • ${sc.redundantWallIds.length} dup` : ""}`;
      return {
        id: sc.id,
        title: sc.levelsCount > 1 ? `${sc.name} (${sc.levelsCount} ${this.#t("WAIFU.Stats.LevelsShort")})` : sc.name,
        metric,
        tone: sc.severity === "critical" ? "critical" : sc.severity === "warning" ? "warning" : "ok"
      };
    });

    const hubTopUuidDocs = stats.uuidStats.topOffendingDocs.slice(0, 2).map((d) => ({
      title: d.rootDocName,
      metric:
        d.exactCount > 0
          ? `${d.count} ${this.#t("WAIFU.Hub.BrokenWord")} • ${d.exactCount} ${this.#t("WAIFU.Hub.ExactWord")}`
          : `${d.count} ${this.#t("WAIFU.Hub.BrokenWord")}`,
      tone: d.criticalCount > 0 ? "critical" : "info"
    }));

    const hubTopNamespaces = stats.storageStats.topNamespaces.slice(0, 2).map((ns) => {
      const stateKey = ["orphaned", "inactive", "core"].includes(ns.moduleState) ? ns.moduleState : "ok";
      return {
        title: `${ns.namespace} (${this.#t(`WAIFU.Storage.Status.${stateKey}`)})`,
        metric:
          ns.flagDocsCount > 0
            ? `${ns.formattedSize} • ${ns.flagDocsCount} doc`
            : ns.formattedSize,
        tone: ns.moduleState === "orphaned" ? "critical" : "warning"
      };
    });

    const penToneMap = {
      scenes: { label: this.#t("WAIFU.Domains.ScenesShort"), tone: "critical", colorCss: "var(--hp)", cap: 100 },
      media: { label: this.#t("WAIFU.Charts.TextureFormats"), tone: "warning", colorCss: "var(--warn)", cap: 25 },
      uuids: { label: this.#t("WAIFU.Domains.UuidsShort"), tone: "arcane", colorCss: "var(--arcane)", cap: 35 },
      settings: { label: "World Settings", tone: "info", colorCss: "var(--temp)", cap: 18 },
      flags: { label: this.#t("WAIFU.Storage.FlagsShort"), tone: "warning", colorCss: "var(--warn)", cap: 20 }
    };
    const penaltyRows = stats.scoreBreakdown.categories.map((cat) => {
      const cfg = penToneMap[cat.id] ?? { label: cat.id, tone: "warning", colorCss: "var(--warn)", cap: 25 };
      const widthPct = cat.penalty > 0 ? Math.min(100, Math.max(8, Math.round((cat.penalty / cfg.cap) * 100))) : 0;
      return {
        label: cfg.label,
        tone: cat.penalty > 0 ? cfg.tone : "ok",
        colorCss: cfg.colorCss,
        widthPct,
        valueLabel: cat.penalty > 0 ? `-${cat.penalty} ${this.#t("WAIFU.Hub.PtsUnit")}` : `0 ${this.#t("WAIFU.Hub.PtsUnit")} (${this.#t("WAIFU.Severity.ok")})`
      };
    });

    const domainLabelMap = {
      scenes: this.#t("WAIFU.Domains.ScenesShort"),
      assets: this.#t("WAIFU.Stats.TexturesShort"),
      uuids: this.#t("WAIFU.Domains.UuidsShort"),
      settings: "World Settings",
      flags: this.#t("WAIFU.Storage.FlagsShort")
    };
    const domainMatrixRows = stats.domainMatrix.map((row) => ({
      ...row,
      label: domainLabelMap[row.id] ?? row.id
    }));

    const alertsCount =
      (extras.chatBloated ? 1 : 0) +
      (extras.staleCombatsCount > 0 ? 1 : 0) +
      (extras.brokenMediaCount > 0 ? 1 : 0) +
      (extras.unusedOptimizedCount > 0 ? 1 : 0);

    const penTextParts = stats.scoreBreakdown.categories
      .filter((c) => c.penalty > 0)
      .map((c) => `${domainLabelMap[c.id] ?? c.id} -${c.penalty}`);

    const hubMeta = {
      w1Sub: this.#t("WAIFU.Overview.ExecHealthSub", {
        critical: summary.criticalCount,
        warning: summary.warningCount,
        deduction: stats.scoreBreakdown.totalDeduction
      }),
      w1PenaltySummary: penTextParts.length ? penTextParts.join(" • ") : this.#t("WAIFU.Severity.ok"),
      sparkTitle: this.#t("WAIFU.Hub.SparkTitle", { count: report?.history?.length || 1 }),
      w2Sub: this.#t("WAIFU.Hub.W2Sub", { fixes: summary.totalFixable, alerts: alertsCount }),
      w3Sub: `${scenes.totalScenes} ${this.#t("WAIFU.Stats.ScenesWord")} • ${stats.sceneStats.geometryTotals.totalLevels} v14 • ${stats.sceneStats.geometryTotals.totalWalls} ${this.#t("WAIFU.Stats.WallsCountShort")} • ${stats.sceneStats.geometryTotals.totalLights} ${this.#t("WAIFU.Stats.LightsShort")}`,
      w3HealthyUnit: `${this.#t("WAIFU.Severity.ok").toLowerCase()} (${scenes.heavyScenesCount} ${this.#t("WAIFU.Hub.WithIssuesWord")})`,
      w3Footer: `${scenes.criticalCount} ${this.#t("WAIFU.Hub.CritShort")} • ${scenes.warningCount} ${this.#t("WAIFU.Hub.WarnShort")} • ${thresholds.maxMegapixels} MP`,
      w4Sub: `${uuids.totalScanned} ${this.#t("WAIFU.Hub.LinksScanned")}`,
      w4ValidUnit: `${this.#t("WAIFU.Hub.ValidWord")} (${uuids.brokenCount})`,
      w4Breakdown: `${uuidsAutoCount} exact • ${stats.uuidStats.byFixability.fuzzy} ~ • ${uuidsUnmatchedCount} ?`,
      w4Footer: `${uuids.journalCount} J • ${uuids.loreframeCount} Lore • ${uuids.actorCount} A`,
      w5Sub: `${stats.storageStats.formattedTrackedSize} • World Settings & Flags`,
      w5ReclaimUnit: `${this.#t("WAIFU.Sidebar.Reclaimable").toLowerCase()} (${stats.storageStats.reclaimablePercent}%)`,
      w5Breakdown: `${settings.orphanedCount} ${this.#t("WAIFU.Hub.OrphanSettingsWord")} • ${flags.orphanedNamespacesCount} ${this.#t("WAIFU.Hub.OrphanFlagsWord")}`,
      w6Sub: `schema v2 • HTML / MD / JSON / 15 ${this.#t("WAIFU.Hub.LimitsWord")}`
    };

    const drawerTarget = this._drawerSceneId
      ? sceneRows.find((s) => s.id === this._drawerSceneId) ?? null
      : null;
    const drawerScene = drawerTarget
      ? {
          ...drawerTarget,
          drawerAssets: (drawerTarget.assets ?? []).map((asset) => ({
            ...asset,
            hasIssue: Boolean(asset.isUnoptimizedRaster || asset.isOversized || asset.isMissing || asset.isHeavyBytes),
            slotHeader: `${asset.slotLabel} (${asset.slotType})`,
            detailLine: [
              asset.src,
              asset.width > 0 ? `${asset.width}×${asset.height} (${asset.megapixels} MP)` : "",
              asset.formattedByteSize || ""
            ]
              .filter(Boolean)
              .join(" • ")
          }))
        }
      : null;

    const narrowHubCards = [
      {
        tab: "health",
        title: this.#t("WAIFU.Hub.W1Title"),
        summary: `${summary.healthScore}% • -${stats.scoreBreakdown.totalDeduction} ${this.#t("WAIFU.Hub.PtsUnit")}`,
        tone: summary.healthStateBadge
      },
      {
        tab: "autofix",
        title: this.#t("WAIFU.Hub.W2Title"),
        summary: `${summary.totalFixable} • Chat ${extras.chatMessagesCount} • ${extras.staleCombatsCount} Combats`,
        tone: summary.totalFixable > 0 ? "ok" : "info"
      },
      {
        tab: "scenes",
        title: this.#t("WAIFU.Hub.W3Title"),
        summary: `${stats.sceneStats.healthyScenes}/${stats.sceneStats.totalScenes} OK • ${scenes.pngAssetsCount} PNG • ${scenes.redundantWallsTotal} dup`,
        tone: scenes.criticalCount > 0 ? "critical" : scenes.heavyScenesCount > 0 ? "warning" : "ok"
      },
      {
        tab: "uuids",
        title: this.#t("WAIFU.Hub.W4Title"),
        summary: `${stats.uuidStats.validPercent}% OK • ${uuids.brokenCount} • ${uuidsAutoCount} exact`,
        tone: uuids.brokenCount > 0 ? "info" : "ok"
      },
      {
        tab: "storage",
        title: this.#t("WAIFU.Hub.W5Title"),
        summary: `${stats.storageStats.formattedReclaimableTotal} • ${storageIssuesTotal}`,
        tone: stats.storageStats.totalReclaimableBytes > 0 ? "warning" : "ok"
      },
      {
        tab: "report",
        title: this.#t("WAIFU.Hub.W6Title"),
        summary: "HTML • MD • JSON • Journal",
        tone: "info"
      }
    ];

    const ignoreSummaryLine = `Scenes: ${ignoreRules.scenes.length} • Settings: ${ignoreRules.settings.length} • Flags: ${ignoreRules.flags.length} • @UUID: ${ignoreRules.uuids.length}`;

    return {
      ...context,
      hasReport: Boolean(report),
      meta: report?.meta ?? {},
      busy: this._busy,
      progressPercent: this._progressPercent,
      progressLabel: this._progressLabel,
      updateUuidLabel: this._updateUuidLabel,
      appearanceOpen: this._appearanceOpen,
      isNightTheme: theme === "night",
      isParchmentTheme: theme === "parchment",
      accents: ACCENT_OPTIONS.map((id) => ({
        id,
        label: this.#t(`WAIFU.Theme.${id[0].toUpperCase()}${id.slice(1)}`),
        active: id === accent
      })),
      summary,
      healthStateLabel: this.#t(`WAIFU.Severity.${summary.healthStateBadge}`),
      stats,
      charts,
      extras,
      hasExtrasAlerts: Boolean(
        extras.chatBloated ||
          extras.staleCombatsCount > 0 ||
          extras.brokenMediaCount > 0 ||
          extras.unusedOptimizedCount > 0
      ),
      comparison,
      hasCustomComparison: Boolean(this._customComparison),
      hasTrendOrComparison: Boolean(charts.healthTrendSvg || comparison),
      totalIgnoredCount,
      ignoreSummaryLine,
      uuidsAutoCount,
      uuidsUnmatchedCount,
      uuidMissingPackCount: stats.uuidStats.byReason["missing-pack"] ?? 0,
      scenes,
      uuids,
      settings,
      flags,
      thresholds,
      inlineThresholds: {
        maxAssetMb: Math.max(1, Math.round((thresholds.maxAssetBytes || 15 * 1024 * 1024) / (1024 * 1024))),
        maxSettingKb: Math.max(1, Math.round((thresholds.maxSettingBytes || 16 * 1024) / 1024)),
        maxFlagKb: Math.max(1, Math.round((thresholds.maxFlagBytes || 32 * 1024) / 1024))
      },
      formattedThresholdBytes: formatBytes(thresholds.maxSettingBytes),
      formattedFlagThresholdBytes: formatBytes(thresholds.maxFlagBytes),
      worldLine: this.#t("WAIFU.Header.WorldMeta", {
        world: game.world?.title ?? "World",
        system: game.system?.id ?? "",
        systemVersion: game.system?.version ?? ""
      }),
      modulesLine: this.#t("WAIFU.Header.ModulesMeta", {
        active: activeModules,
        installed: installedModules
      }),
      scanLine: report
        ? this.#t("WAIFU.Header.ScanMeta", {
            time: new Date(report.generatedAt).toLocaleTimeString(),
            duration: report.meta?.durationMs ?? 0
          })
        : this.#t("WAIFU.Header.NeverScanned"),
      hasAnyFixable: summary.totalFixable > 0,
      drillPills,
      isDrillDown: this._activeTab !== "hub",
      activeDomainTitle: domainMeta[this._activeTab]?.title ?? "",
      isHubActive: this._activeTab === "hub",
      isHealthActive: this._activeTab === "health",
      isAutofixActive: this._activeTab === "autofix",
      isScenesActive: this._activeTab === "scenes",
      isUuidsActive: this._activeTab === "uuids",
      isStorageActive: this._activeTab === "storage",
      isReportActive: this._activeTab === "report",
      isReportVisual: this._reportMode === "visual",
      isReportMarkdown: this._reportMode === "markdown",
      isReportJournal: this._reportMode === "journal",
      hubMeta,
      hubAutofixPreview,
      hubTopScenes,
      hubTopUuidDocs,
      hubTopNamespaces,
      hubHasOrphans: settings.orphanedCount > 0 || flags.orphanedEntriesCount > 0,
      narrowHubCards,
      penaltyRows,
      domainMatrixRows,
      autofixQueue,
      autofixSelectedCount,
      autofixBackupFirst: this._autofixBackupFirst,
      drawerScene,
      filters: this._filters,
      sceneFilterChips: [
        { id: "all", label: this.#t("WAIFU.Scenes.FilterAll") },
        { id: "heavy", label: this.#t("WAIFU.Scenes.FilterHeavy") },
        { id: "png", label: this.#t("WAIFU.Scenes.FilterPng") },
        { id: "geometry", label: this.#t("WAIFU.Scenes.FilterGeometry") },
        { id: "missing", label: this.#t("WAIFU.Scenes.FilterMissing") },
        ...(scenes.ignoredCount > 0
          ? [{ id: "ignored", label: `${this.#t("WAIFU.Ignore.FilterChip")} (${scenes.ignoredCount})` }]
          : [])
      ].map((c) => ({ ...c, active: c.id === this._filters.scenesTag })),
      uuidFilterChips: [
        { id: "all", label: this.#t("WAIFU.Uuids.FilterAll") },
        { id: "journal", label: this.#t("WAIFU.Uuids.FilterJournals") },
        { id: "loreframe", label: this.#t("WAIFU.Uuids.FilterLoreframe") },
        { id: "actor", label: this.#t("WAIFU.Uuids.FilterActors") },
        { id: "other", label: this.#t("WAIFU.Uuids.FilterOther") },
        { id: "matched", label: this.#t("WAIFU.Uuids.FilterWithMatch") },
        ...(uuids.ignoredCount > 0
          ? [{ id: "ignored", label: `${this.#t("WAIFU.Ignore.FilterChip")} (${uuids.ignoredCount})` }]
          : [])
      ].map((c) => ({ ...c, active: c.id === this._filters.uuidsTag })),
      storageFilterChips: [
        { id: "all", label: this.#t("WAIFU.Storage.FilterAll") },
        { id: "orphaned", label: this.#t("WAIFU.Storage.FilterOrphaned") },
        { id: "inactive", label: this.#t("WAIFU.Storage.FilterInactive") },
        { id: "bloated", label: this.#t("WAIFU.Storage.FilterBloated") },
        ...(storageIgnoredCount > 0
          ? [{ id: "ignored", label: `${this.#t("WAIFU.Ignore.FilterChip")} (${storageIgnoredCount})` }]
          : [])
      ].map((c) => ({ ...c, active: c.id === this._filters.storageTag })),
      sceneRows,
      uuidRows,
      settingRows,
      flagGroupRows,
      sceneDistributionRows,
      recommendations,
      markdownPreview,
      visualReportHtml,
      journalPreviewHtml,
      statusMessage: this._statusMessage
    };
  }

  _preRender(context, options) {
    super._preRender?.(context, options);
    this._scrollState = {};
    if (!this.element) return;
    for (const panel of this.element.querySelectorAll("[data-panel]")) {
      this._scrollState[`panel:${panel.dataset.panel}`] = panel.scrollTop;
    }
    for (const wrap of this.element.querySelectorAll(".waifu-table-wrap")) {
      const tbl = wrap.querySelector("table[data-waifu-table]");
      if (tbl) {
        this._scrollState[`table:${tbl.dataset.waifuTable}`] = {
          top: wrap.scrollTop,
          left: wrap.scrollLeft
        };
      }
    }
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    if (!this._report && !this._busy) {
      queueMicrotask(() => this.executeAudit({ silent: true }));
    }
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const { theme, accent } = this.#getAppearance();
    this.element.dataset.theme = theme;
    this.element.dataset.accent = accent;
    const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    this.element.dataset.motion = reduced
      ? "off"
      : document.body?.classList?.contains("performance-low")
        ? "reduced"
        : "full";

    this.#bindLayoutObserver();
    this.#bindFilterInputs();
    this.#bindTabKeyboard();
    this.#bindMenuDismiss();
    this.#reapplySortState();
    this.#applyDomFilters();
    this.#restoreScrollState();
  }

  async close(options = {}) {
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    if (this._docClickListener) {
      document.removeEventListener("pointerdown", this._docClickListener);
      this._docClickListener = null;
    }
    return super.close(options);
  }

  #bindLayoutObserver() {
    if (this._resizeObserver) this._resizeObserver.disconnect();
    const updateWidthState = (width) => {
      this.element.dataset.layout = width < 860 ? "narrow" : "standard";
    };
    updateWidthState(this.element.getBoundingClientRect().width || 1180);
    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateWidthState(entry.contentRect.width);
      }
    });
    this._resizeObserver.observe(this.element);
  }

  #bindFilterInputs() {
    for (const input of this.element.querySelectorAll("[data-filter-input]")) {
      if (input.dataset.waifuBound) continue;
      input.dataset.waifuBound = "1";
      input.addEventListener("input", (event) => {
        const kind = event.currentTarget.dataset.filterInput;
        const val = event.currentTarget.value ?? "";
        if (kind === "scenes") this._filters.scenesQuery = val;
        else if (kind === "uuids") this._filters.uuidsQuery = val;
        else if (kind === "storage") this._filters.storageQuery = val;
        this.#applyDomFilters();
      });
    }
  }

  #bindTabKeyboard() {
    const tablist = this.element.querySelector('[role="tablist"]');
    if (!tablist || tablist.dataset.waifuBound) return;
    tablist.dataset.waifuBound = "1";

    tablist.addEventListener("keydown", (event) => {
      const tabs = [...tablist.querySelectorAll('[role="tab"]')];
      const currentIdx = tabs.indexOf(document.activeElement);
      if (currentIdx < 0) return;

      let nextIdx = -1;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        nextIdx = (currentIdx + 1) % tabs.length;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        nextIdx = (currentIdx - 1 + tabs.length) % tabs.length;
      } else if (event.key === "Home") {
        nextIdx = 0;
      } else if (event.key === "End") {
        nextIdx = tabs.length - 1;
      }
      if (nextIdx < 0) return;

      event.preventDefault();
      const targetTab = tabs[nextIdx];
      targetTab.focus();
      this.#switchTab(targetTab.dataset.tab);
    });
  }

  #bindMenuDismiss() {
    if (this._docClickListener) {
      document.removeEventListener("pointerdown", this._docClickListener);
    }
    this._docClickListener = (event) => {
      if (!this._appearanceOpen) return;
      const wrap = this.element.querySelector(".waifu-menu-wrap");
      if (wrap && !wrap.contains(event.target)) {
        this._appearanceOpen = false;
        this.render({ parts: ["masthead"] });
      }
    };
    document.addEventListener("pointerdown", this._docClickListener);
  }

  #switchTab(tabId) {
    const normalized = tabId === "overview" ? "hub" : tabId;
    if (!normalized || this._activeTab === normalized) return;
    this._activeTab = normalized;
    this._drawerSceneId = null;

    const crumbBar = this.element?.querySelector(".waifu-crumb-bar");
    if (crumbBar) crumbBar.hidden = normalized === "hub";
    const activeCrumbEl = this.element?.querySelector(".waifu-crumb-active");
    if (activeCrumbEl) {
      const titleKeyMap = {
        health: "WAIFU.Domains.HealthFull",
        autofix: "WAIFU.Domains.AutofixFull",
        scenes: "WAIFU.Domains.ScenesFull",
        uuids: "WAIFU.Domains.UuidsFull",
        storage: "WAIFU.Domains.StorageFull",
        report: "WAIFU.Domains.ReportFull"
      };
      activeCrumbEl.textContent = titleKeyMap[normalized] ? this.#t(titleKeyMap[normalized]) : "";
    }

    const drawerEl = this.element?.querySelector(".waifu-drawer-backdrop");
    if (drawerEl) drawerEl.hidden = true;

    for (const tabBtn of this.element.querySelectorAll('[role="tab"]')) {
      const selected = tabBtn.dataset.tab === normalized;
      tabBtn.setAttribute("aria-selected", selected ? "true" : "false");
      tabBtn.tabIndex = selected ? 0 : -1;
      if (selected) {
        tabBtn.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }
    for (const panel of this.element.querySelectorAll("[data-panel]")) {
      panel.hidden = panel.dataset.panel !== normalized;
    }
  }

  #applyDomFilters() {
    const applyGroup = (rowSelector, query, tag) => {
      const normQ = query.trim().toLowerCase();
      for (const row of this.element.querySelectorAll(rowSelector)) {
        const text = row.dataset.search ?? "";
        const cats = (row.dataset.category ?? "").split(/\s+/);
        const matchesQuery = !normQ || text.includes(normQ);
        const matchesTag = !tag || tag === "all" || cats.includes(tag);
        row.hidden = !(matchesQuery && matchesTag);
      }
    };

    applyGroup('[data-waifu-row="scene"]', this._filters.scenesQuery, this._filters.scenesTag);
    applyGroup('[data-waifu-row="uuid"]', this._filters.uuidsQuery, this._filters.uuidsTag);
    applyGroup('[data-waifu-row="setting"]', this._filters.storageQuery, this._filters.storageTag);
    applyGroup('[data-waifu-row="flag-group"]', this._filters.storageQuery, this._filters.storageTag);
  }

  #restoreScrollState() {
    if (!this.element || !this._scrollState) return;
    for (const panel of this.element.querySelectorAll("[data-panel]")) {
      const top = this._scrollState[`panel:${panel.dataset.panel}`];
      if (Number.isFinite(top) && top > 0) panel.scrollTop = top;
    }
    for (const wrap of this.element.querySelectorAll(".waifu-table-wrap")) {
      const tbl = wrap.querySelector("table[data-waifu-table]");
      const saved = tbl ? this._scrollState[`table:${tbl.dataset.waifuTable}`] : null;
      if (saved) {
        if (saved.top > 0) wrap.scrollTop = saved.top;
        if (saved.left > 0) wrap.scrollLeft = saved.left;
      }
    }
  }

  #sortTableElement(table, colIndex, direction, type = "string") {
    const tbody = table?.tBodies?.[0];
    const headerRow = table?.tHead?.rows?.[0];
    if (!tbody || !headerRow || !headerRow.cells?.[colIndex]) return;
    for (const header of headerRow.cells) {
      header.removeAttribute("aria-sort");
    }
    headerRow.cells[colIndex].setAttribute("aria-sort", direction);

    const factor = direction === "ascending" ? 1 : -1;
    const rows = [...tbody.rows];
    const readVal = (row) => {
      const cell = row.cells[colIndex];
      return cell?.dataset?.value ?? cell?.textContent?.trim() ?? "";
    };

    const sorted = rows.toSorted((rowA, rowB) => {
      const valA = readVal(rowA);
      const valB = readVal(rowB);
      if (type === "number") {
        return factor * ((Number(valA) || 0) - (Number(valB) || 0));
      }
      return factor * TEXT_COLLATOR.compare(String(valA), String(valB));
    });

    for (const row of sorted) {
      if (typeof tbody.moveBefore === "function") tbody.moveBefore(row, null);
      else tbody.appendChild(row);
    }
  }

  #reapplySortState() {
    if (!this.element) return;
    for (const [tableKey, state] of Object.entries(this._sortState ?? {})) {
      if (!state) continue;
      const table = this.element.querySelector(`table[data-waifu-table="${CSS.escape(tableKey)}"]`);
      if (table) {
        this.#sortTableElement(table, state.colIndex, state.direction, state.type);
      }
    }
  }

  #updateProgressDom(percent, label) {
    this._progressPercent = Math.max(0, Math.min(100, Math.round(percent)));
    this._progressLabel = label;
    if (!this.element) return;
    const bar = this.element.querySelector("[data-waifu-progress]");
    const fill = this.element.querySelector("[data-waifu-progress-fill]");
    const text = this.element.querySelector("[data-waifu-progress-label]");
    const pctText = this.element.querySelector("[data-waifu-progress-pct]");
    if (bar) bar.hidden = !this._busy;
    if (fill) fill.style.width = `${this._progressPercent}%`;
    if (text) text.textContent = this._progressLabel;
    if (pctText) pctText.textContent = `${this._progressPercent}%`;
  }

  #getDialogRoot(arg1, arg2) {
    return arg1?.element ?? arg2?.element ?? (arg1 instanceof HTMLElement ? arg1 : null);
  }

  #pickJsonFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.style.display = "none";
      const cleanup = () => input.remove();
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        cleanup();
        if (!file) return resolve(null);
        try {
          resolve({ name: file.name, text: await file.text() });
        } catch {
          resolve(null);
        }
      });
      input.addEventListener("cancel", () => {
        cleanup();
        resolve(null);
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  #announceStatus(message) {
    this._statusMessage = message;
    const region = this.element?.querySelector("[data-waifu-status]");
    if (region) region.textContent = message;
  }

  async executeAudit({ silent = false } = {}) {
    if (this._busy) return this._report;
    this._busy = true;
    this._abortController = new AbortController();
    this._progressPercent = 5;
    this._progressLabel = this.#t("WAIFU.Progress.Scanning");
    if (this.rendered) this.render({ force: false });

    try {
      this._report = await runWorldAudit({}, {
        signal: this._abortController.signal,
        onProgress: (info) => {
          if (info.phase === "media" && info.total > 0) {
            const pct = 10 + Math.round((info.completed / info.total) * 70);
            this.#updateProgressDom(
              pct,
              `${this.#t("WAIFU.Progress.ProbingMedia")} (${info.completed}/${info.total})`
            );
          } else if (info.phase === "uuids") {
            this.#updateProgressDom(85, this.#t("WAIFU.Progress.ScanningUuids"));
          } else if (info.phase === "storage") {
            this.#updateProgressDom(95, this.#t("WAIFU.Progress.ScanningStorage"));
          }
        }
      });
      const msg = this.#t("WAIFU.Notifications.AuditComplete", {
        duration: this._report.meta.durationMs,
        issues: this._report.summary.totalIssues
      });
      this._statusMessage = msg;
      if (!silent) ui.notifications.info(msg);
    } catch (error) {
      if (error?.name === "AbortError") {
        ui.notifications.info(this.#t("WAIFU.Notifications.Cancelled"));
      } else {
        console.error("WAIFU | Audit failed", error);
        ui.notifications.error(error?.message || "WAIFU audit failed");
      }
    } finally {
      this._busy = false;
      this._abortController = null;
      this._progressPercent = 0;
      this._progressLabel = "";
      if (this.rendered) this.render({ force: false });
    }
    return this._report;
  }

  async #openDialog(config = {}) {
    const { theme, accent } = this.#getAppearance();
    const userRender = config.render;
    return DialogV2.wait({
      ...config,
      classes: ["waifu-root", "waifu-dialog", ...(config.classes ?? [])],
      render: (arg1, arg2) => {
        const root = this.#getDialogRoot(arg1, arg2);
        if (root) {
          root.classList.add("waifu-root", "waifu-dialog");
          root.dataset.theme = theme;
          root.dataset.accent = accent;
        }
        userRender?.(arg1, arg2);
      }
    });
  }

  async #confirmAction(message, { withBackupOption = false, previewLines = [] } = {}) {
    let content = `<p>${escapeHtml(message)}</p>`;
    if (Array.isArray(previewLines) && previewLines.length > 0) {
      const itemsHtml = previewLines
        .slice(0, 12)
        .map((line) => `<li><code>${escapeHtml(line)}</code></li>`)
        .join("");
      const extraNote =
        previewLines.length > 12
          ? `<li><em>+${previewLines.length - 12} more...</em></li>`
          : "";
      content += `<ul class="waifu-confirm-preview">${itemsHtml}${extraNote}</ul>`;
    }
    if (withBackupOption) {
      content += `<label style="display:flex;align-items:center;gap:8px;margin-top:8px;"><input type="checkbox" name="backupFirst" checked> ${escapeHtml(
        this.#t("WAIFU.Dialogs.DownloadBackupLabel")
      )}</label>`;
    }

    return this.#openDialog({
      window: { title: this.#t("WAIFU.Dialogs.ConfirmTitle") },
      content,
      buttons: [
        {
          action: "confirm",
          label: game.i18n.localize("Confirm"),
          icon: "fa-solid fa-check",
          default: true,
          callback: (_event, button) => ({
            confirmed: true,
            backupFirst: Boolean(button.form?.elements?.backupFirst?.checked)
          })
        },
        {
          action: "cancel",
          label: game.i18n.localize("Cancel"),
          icon: "fa-solid fa-xmark",
          callback: () => ({ confirmed: false, backupFirst: false })
        }
      ],
      rejectClose: false
    });
  }

  // ── Action Handlers ──────────────────────────────────────────────────

  static async #onRunAudit() {
    await this.executeAudit();
  }

  static #onCancelOperation() {
    this._abortController?.abort();
  }

  static #onSelectTab(_event, target) {
    this.#switchTab(target.dataset.tab);
  }

  static #onDrillDown(event, target) {
    if (event.target.closest("button, a, input, select, summary, label")) return;
    this.#switchTab(target.dataset.tab);
  }

  static #onGoHub() {
    this.#switchTab("hub");
  }

  static #onOpenSceneDrawer(_event, target) {
    const sceneId = target.dataset.sceneId;
    if (!sceneId) return;
    this._drawerSceneId = sceneId;
    this.render({ parts: ["main"] });
  }

  static #onCloseSceneDrawer() {
    if (!this._drawerSceneId) return;
    this._drawerSceneId = null;
    this.render({ parts: ["main"] });
  }

  static #onCloseDrawerBackdrop(event, target) {
    if (event.target !== target) return;
    this._drawerSceneId = null;
    this.render({ parts: ["main"] });
  }

  static #onToggleAutofixItem(_event, target) {
    const id = target.dataset.autofixId;
    if (!id) return;
    if (target.checked) this._autofixChecked.add(id);
    else this._autofixChecked.delete(id);
    this.render({ parts: ["main"] });
  }

  static #onToggleAutofixBackupFirst(_event, target) {
    this._autofixBackupFirst = Boolean(target.checked);
  }

  static async #onExecuteSelectedAutofixes() {
    if (!this._report || this._busy) return;
    const selected = new Set(this._autofixChecked);
    if (!selected.size) {
      ui.notifications.info(this.#t("WAIFU.Notifications.NothingToFix"));
      return;
    }

    const minConfidence = Number(this._report.thresholds?.uuidMinAutoConfidence) || 1.0;
    const autoUuids = selected.has("apply-exact-uuids")
      ? this._report.uuids.items.filter(
          (u) =>
            u.bestCandidate &&
            (u.bestCandidate.confidence === "exact" ||
              (Number(u.bestCandidate.score) || 0) >= minConfidence)
        )
      : [];
    const webpAssets = selected.has("convert-scene-webp") ? this._report.scenes.convertibleAssets : [];
    const wallScenes = selected.has("dedupe-walls")
      ? this._report.scenes.items.filter((s) => s.redundantWallIds.length > 0)
      : [];
    const nearWallScenes = selected.has("dedupe-near-walls")
      ? this._report.scenes.items.filter((s) => s.nearDuplicateWallIds?.length > 0)
      : [];
    const orphanTokenScenes = selected.has("cleanup-orphaned-tokens")
      ? this._report.scenes.items.filter((s) => s.orphanedTokenIds?.length > 0)
      : [];
    const orphanSettings = selected.has("cleanup-orphaned-storage")
      ? this._report.settings.items.filter((s) => s.isOrphaned)
      : [];
    const orphanFlagGroups = selected.has("cleanup-orphaned-storage")
      ? this._report.flags.groups.filter((g) => g.isOrphaned)
      : [];

    const previewLines = [
      ...webpAssets.slice(0, 4).map((a) => `WebP: ${a.sceneName} -> ${a.src}`),
      ...wallScenes.slice(0, 3).map((s) => `Walls: ${s.name} (-${s.redundantWallIds.length})`),
      ...nearWallScenes.slice(0, 3).map((s) => `~Walls: ${s.name} (-${s.nearDuplicateWallIds.length})`),
      ...orphanTokenScenes.slice(0, 3).map((s) => `Tokens: ${s.name} (-${s.orphanedTokenIds.length})`),
      ...autoUuids.slice(0, 3).map((u) => `@UUID: ${u.rawUuid} -> ${u.bestCandidate.name}`),
      ...orphanSettings.slice(0, 3).map((s) => `Setting: ${s.key}`),
      ...orphanFlagGroups.slice(0, 3).map((g) => `Flags: ${g.namespace} (${g.docCount} docs)`)
    ];

    if (!previewLines.length) {
      ui.notifications.info(this.#t("WAIFU.Notifications.NothingToFix"));
      return;
    }

    const res = await this.#confirmAction(
      `${this.#t("WAIFU.Autofix.ApplySelected")} (${selected.size})`,
      { withBackupOption: false, previewLines }
    );
    if (!res?.confirmed) return;

    if (this._autofixBackupFirst) {
      const deletedWalls = [...wallScenes, ...nearWallScenes]
        .map((sc) =>
          snapshotWallsForBackup(sc.id, [
            ...(selected.has("dedupe-walls") ? sc.redundantWallIds : []),
            ...(selected.has("dedupe-near-walls") ? sc.nearDuplicateWallIds ?? [] : [])
          ])
        )
        .filter(Boolean);
      const sceneMedia = webpAssets.map((a) => ({
        sceneId: a.sceneId,
        slotType: a.slotType,
        levelId: a.levelId ?? null,
        tileId: a.tileId ?? null,
        oldSrc: a.src
      }));
      downloadStorageBackup(this._report, { deletedWalls, sceneMedia });
    }

    this._busy = true;
    this._abortController = new AbortController();
    this.render({ force: false });

    try {
      if (webpAssets.length) {
        await convertSceneAssetsToWebp(webpAssets, this._report.thresholds, {
          signal: this._abortController.signal
        });
      }
      for (const sc of wallScenes) {
        await cleanupRedundantWalls(sc.id, sc.redundantWallIds);
      }
      for (const sc of nearWallScenes) {
        await cleanupRedundantWalls(sc.id, sc.nearDuplicateWallIds);
      }
      for (const sc of orphanTokenScenes) {
        await removeOrphanedTokens(sc.id, sc.orphanedTokenIds);
      }
      if (autoUuids.length) {
        await batchPatchUuidOccurrences(
          autoUuids.map((occurrence) => ({
            occurrence,
            action: {
              mode: "replace",
              newUuid: occurrence.bestCandidate.uuid,
              newLabel:
                this._updateUuidLabel && occurrence.reason !== "missing-anchor"
                  ? occurrence.bestCandidate.name
                  : undefined
            }
          }))
        );
      }
      if (orphanSettings.length) {
        await deleteWorldSettingsBatch(orphanSettings.map((s) => s.key));
      }
      for (const grp of orphanFlagGroups) {
        await deleteFlagGroup(grp);
      }
    } finally {
      this._busy = false;
      this._abortController = null;
    }
    await this.executeAudit();
  }

  static #onOpenFoundrySettings() {
    game.settings.sheet.render(true);
  }

  static async #onSaveInlineThresholds() {
    if (this._busy) return;
    const container = this.element?.querySelector("[data-thresholds-studio]");
    if (!container) return;
    const t = readThresholdSettings();
    const readVal = (name) => container.querySelector(`[data-threshold-field="${name}"]`);

    const values = {
      maxTextureResolution: Number(readVal("maxTextureResolution")?.value) || t.maxTextureResolution,
      maxMegapixels: Number(readVal("maxMegapixels")?.value) || t.maxMegapixels,
      maxAssetBytes: (Number(readVal("maxAssetMb")?.value) || 15) * 1024 * 1024,
      maxWalls: Number(readVal("maxWalls")?.value) || t.maxWalls,
      maxLights: Number(readVal("maxLights")?.value) || t.maxLights,
      maxAnimations: Number(readVal("maxAnimations")?.value) || t.maxAnimations,
      nearDuplicateWallTolerance: Number.isFinite(Number(readVal("nearDuplicateWallTolerance")?.value))
        ? Math.max(0, Number(readVal("nearDuplicateWallTolerance").value))
        : t.nearDuplicateWallTolerance,
      maxSettingBytes: (Number(readVal("maxSettingKb")?.value) || 16) * 1024,
      maxFlagBytes: (Number(readVal("maxFlagKb")?.value) || 32) * 1024,
      webpQuality: Math.min(1, Math.max(0.5, Number(readVal("webpQuality")?.value) || 0.85)),
      uuidMinAutoConfidence: Math.min(1, Math.max(0.75, Number(readVal("uuidMinAutoConfidence")?.value) || 1)),
      maxChatMessages: Number(readVal("maxChatMessages")?.value) || t.maxChatMessages,
      downscaleOnConvert: Boolean(readVal("downscaleOnConvert")?.checked),
      skipLargerWebp: Boolean(readVal("skipLargerWebp")?.checked),
      includeChatMessages: Boolean(readVal("includeChatMessages")?.checked)
    };

    for (const [k, v] of Object.entries(values)) {
      await game.settings.set(MODULE_ID, k, v);
    }
    await this.executeAudit();
  }

  static #onSetReportMode(_event, target) {
    const mode = target.dataset.mode;
    if (!["visual", "markdown", "journal"].includes(mode) || this._reportMode === mode) return;
    this._reportMode = mode;
    this.render({ parts: ["main"] });
  }

  static #onToggleAppearanceMenu() {
    this._appearanceOpen = !this._appearanceOpen;
    this.render({ parts: ["masthead"] });
  }

  static async #onSetTheme(_event, target) {
    const theme = target.dataset.themeVal;
    if (!THEME_OPTIONS.includes(theme)) return;
    await game.settings.set(MODULE_ID, "theme", theme);
    this.element.dataset.theme = theme;
    this.render({ parts: ["masthead"] });
  }

  static async #onSetAccent(_event, target) {
    const accent = target.dataset.accentVal;
    if (!ACCENT_OPTIONS.includes(accent)) return;
    await game.settings.set(MODULE_ID, "accent", accent);
    this.element.dataset.accent = accent;
    this.render({ parts: ["masthead"] });
  }

  static async #onOpenModuleSettings() {
    const t = readThresholdSettings();
    const content = `
      <div class="waifu-settings-grid">
        <label class="waifu-settings-field">
          <span>${escapeHtml(this.#t("WAIFU.Settings.MaxTextureResolution.Name"))}</span>
          <input type="number" name="maxTextureResolution" min="256" step="256" value="${t.maxTextureResolution}">
        </label>
        <label class="waifu-settings-field">
          <span>${escapeHtml(this.#t("WAIFU.Settings.MaxMegapixels.Name"))}</span>
          <input type="number" name="maxMegapixels" min="1" step="1" value="${t.maxMegapixels}">
        </label>
        <label class="waifu-settings-field">
          <span>${escapeHtml(this.#t("WAIFU.Settings.MaxAssetBytes.Name"))} (MB)</span>
          <input type="number" name="maxAssetMb" min="1" step="1" value="${Math.round(t.maxAssetBytes / (1024 * 1024))}">
        </label>
        <label class="waifu-settings-field">
          <span>${escapeHtml(this.#t("WAIFU.Settings.MaxWalls.Name"))}</span>
          <input type="number" name="maxWalls" min="10" step="10" value="${t.maxWalls}">
        </label>
        <label class="waifu-settings-field">
          <span>${escapeHtml(this.#t("WAIFU.Settings.MaxLights.Name"))}</span>
          <input type="number" name="maxLights" min="1" step="5" value="${t.maxLights}">
        </label>
        <label class="waifu-settings-field">
          <span>${escapeHtml(this.#t("WAIFU.Settings.MaxAnimations.Name"))}</span>
          <input type="number" name="maxAnimations" min="1" step="1" value="${t.maxAnimations}">
        </label>
        <label class="waifu-settings-field">
          <span>${escapeHtml(this.#t("WAIFU.Settings.NearDuplicateWallTolerance.Name"))}</span>
          <input type="number" name="nearDuplicateWallTolerance" min="0" max="10" step="1" value="${t.nearDuplicateWallTolerance}">
        </label>
        <label class="waifu-settings-field">
          <span>${escapeHtml(this.#t("WAIFU.Settings.WebpQuality.Name"))}</span>
          <input type="number" name="webpQuality" min="0.5" max="1" step="0.05" value="${t.webpQuality}">
        </label>
        <label class="waifu-settings-field">
          <span>${escapeHtml(this.#t("WAIFU.Settings.MaxSettingBytes.Name"))} (KB)</span>
          <input type="number" name="maxSettingKb" min="1" step="1" value="${Math.round(t.maxSettingBytes / 1024)}">
        </label>
        <label class="waifu-settings-field">
          <span>${escapeHtml(this.#t("WAIFU.Settings.MaxFlagBytes.Name"))} (KB)</span>
          <input type="number" name="maxFlagKb" min="1" step="1" value="${Math.round(t.maxFlagBytes / 1024)}">
        </label>
        <label class="waifu-settings-field">
          <span>${escapeHtml(this.#t("WAIFU.Settings.UuidMinAutoConfidence.Name"))}</span>
          <input type="number" name="uuidMinAutoConfidence" min="0.75" max="1" step="0.05" value="${t.uuidMinAutoConfidence}">
        </label>
        <label class="waifu-settings-field">
          <span>${escapeHtml(this.#t("WAIFU.Settings.MaxChatMessages.Name"))}</span>
          <input type="number" name="maxChatMessages" min="100" step="100" value="${t.maxChatMessages}">
        </label>
        <label class="waifu-settings-field is-check">
          <input type="checkbox" name="downscaleOnConvert" ${t.downscaleOnConvert ? "checked" : ""}>
          <span>${escapeHtml(this.#t("WAIFU.Settings.DownscaleOnConvert.Name"))}</span>
        </label>
        <label class="waifu-settings-field is-check">
          <input type="checkbox" name="skipLargerWebp" ${t.skipLargerWebp ? "checked" : ""}>
          <span>${escapeHtml(this.#t("WAIFU.Settings.SkipLargerWebp.Name"))}</span>
        </label>
        <label class="waifu-settings-field is-check">
          <input type="checkbox" name="includeChatMessages" ${t.includeChatMessages ? "checked" : ""}>
          <span>${escapeHtml(this.#t("WAIFU.Settings.IncludeChatMessages.Name"))}</span>
        </label>
      </div>
    `;

    const res = await this.#openDialog({
      window: { title: this.#t("WAIFU.Dialogs.ThresholdsTitle") },
      content,
      buttons: [
        {
          action: "save",
          label: this.#t("WAIFU.Dialogs.BtnSaveAndAudit"),
          icon: "fa-solid fa-check",
          default: true,
          callback: (_ev, btn) => {
            const el = btn.form?.elements;
            return {
              action: "save",
              values: {
                maxTextureResolution: Number(el?.maxTextureResolution?.value) || t.maxTextureResolution,
                maxMegapixels: Number(el?.maxMegapixels?.value) || t.maxMegapixels,
                maxAssetBytes: (Number(el?.maxAssetMb?.value) || 15) * 1024 * 1024,
                maxWalls: Number(el?.maxWalls?.value) || t.maxWalls,
                maxLights: Number(el?.maxLights?.value) || t.maxLights,
                maxAnimations: Number(el?.maxAnimations?.value) || t.maxAnimations,
                nearDuplicateWallTolerance: Number.isFinite(Number(el?.nearDuplicateWallTolerance?.value))
                  ? Math.max(0, Number(el.nearDuplicateWallTolerance.value))
                  : t.nearDuplicateWallTolerance,
                maxSettingBytes: (Number(el?.maxSettingKb?.value) || 16) * 1024,
                maxFlagBytes: (Number(el?.maxFlagKb?.value) || 32) * 1024,
                webpQuality: Math.min(1, Math.max(0.5, Number(el?.webpQuality?.value) || 0.85)),
                uuidMinAutoConfidence: Math.min(1, Math.max(0.75, Number(el?.uuidMinAutoConfidence?.value) || 1)),
                maxChatMessages: Number(el?.maxChatMessages?.value) || t.maxChatMessages,
                downscaleOnConvert: Boolean(el?.downscaleOnConvert?.checked),
                skipLargerWebp: Boolean(el?.skipLargerWebp?.checked),
                includeChatMessages: Boolean(el?.includeChatMessages?.checked)
              }
            };
          }
        },
        {
          action: "foundry",
          label: this.#t("WAIFU.Dialogs.BtnFoundrySettings"),
          icon: "fa-solid fa-sliders",
          callback: () => ({ action: "foundry" })
        },
        {
          action: "cancel",
          label: game.i18n.localize("Cancel"),
          callback: () => ({ action: "cancel" })
        }
      ],
      rejectClose: false
    });

    if (res?.action === "foundry") {
      game.settings.sheet.render(true);
      return;
    }
    if (res?.action === "save" && res.values) {
      for (const [k, v] of Object.entries(res.values)) {
        await game.settings.set(MODULE_ID, k, v);
      }
      await this.executeAudit();
    }
  }

  static #onSetSceneFilter(_event, target) {
    this._filters.scenesTag = target.dataset.filter || "all";
    this.render({ parts: ["main"] });
  }

  static #onSetUuidFilter(_event, target) {
    this._filters.uuidsTag = target.dataset.filter || "all";
    this.render({ parts: ["main"] });
  }

  static #onSetStorageFilter(_event, target) {
    this._filters.storageTag = target.dataset.filter || "all";
    this.render({ parts: ["main"] });
  }

  static #onSortTable(_event, target) {
    const th = target.closest("th");
    const table = target.closest("table");
    if (!th || !table) return;

    const direction = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
    const colIndex = th.cellIndex;
    const type = th.dataset.type || "string";
    const tableKey = table.dataset.waifuTable;
    if (tableKey) {
      this._sortState[tableKey] = { colIndex, direction, type };
    }

    this.#sortTableElement(table, colIndex, direction, type);
    this.#announceStatus(`${target.textContent.trim()} (${direction})`);
  }

  static async #onConvertSingleAsset(_event, target) {
    if (!this._report || this._busy) return;
    const { sceneId, assetSrc } = target.dataset;
    const matchingAssets = this._report.scenes.convertibleAssets.filter(
      (a) => a.sceneId === sceneId && a.src === assetSrc
    );
    if (!matchingAssets.length) return;

    await this.#runWebpConversion(matchingAssets);
  }

  static async #onBatchConvertWebp() {
    if (!this._report || this._busy) return;
    const assets = this._report.scenes.convertibleAssets;
    if (!assets.length) {
      ui.notifications.info(this.#t("WAIFU.Notifications.NothingToFix"));
      return;
    }

    const previewLines = [...new Set(assets.map((a) => `${a.sceneName}: ${a.src}`))];
    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmWebpBatch", { count: assets.length }),
      { previewLines }
    );
    if (!res?.confirmed) return;

    await this.#runWebpConversion(assets);
  }

  async #runWebpConversion(assets) {
    this._busy = true;
    this._abortController = new AbortController();
    this._progressPercent = 2;
    this._progressLabel = this.#t("WAIFU.Progress.ConvertingWebp");
    this.render({ force: false });
    try {
      const result = await convertSceneAssetsToWebp(assets, this._report.thresholds, {
        signal: this._abortController.signal,
        onProgress: (info) => {
          const pct = info.total > 0 ? Math.round((info.current / info.total) * 100) : 0;
          this.#updateProgressDom(
            pct,
            `${this.#t("WAIFU.Progress.ConvertingWebp")} (${info.current}/${info.total})`
          );
        }
      });
      if (result.convertedCount > 0) {
        ui.notifications.info(
          this.#t("WAIFU.Notifications.WebpConverted", {
            count: result.convertedCount,
            saved: result.formattedSaved
          })
        );
      }
      if (result.skippedCount > 0) {
        ui.notifications.info(
          this.#t("WAIFU.Notifications.WebpSkippedLarger", { count: result.skippedCount })
        );
      }
      if (result.aborted) {
        ui.notifications.info(this.#t("WAIFU.Notifications.Cancelled"));
      }
      for (const fail of result.failures) {
        ui.notifications.warn(
          this.#t("WAIFU.Notifications.WebpFailed", { src: fail.src, error: fail.error })
        );
      }
    } finally {
      this._busy = false;
      this._abortController = null;
      this._progressPercent = 0;
      this._progressLabel = "";
    }
    await this.executeAudit({ silent: true });
  }

  static async #onDedupeSceneWalls(_event, target) {
    if (!this._report || this._busy) return;
    const scene = this._report.scenes.items.find((s) => s.id === target.dataset.sceneId);
    if (!scene?.redundantWallIds?.length) return;

    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmDedupeWalls", {
        count: scene.redundantWallIds.length,
        scene: scene.name
      })
    );
    if (!res?.confirmed) return;

    const removed = await cleanupRedundantWalls(scene.id, scene.redundantWallIds);
    ui.notifications.info(
      this.#t("WAIFU.Notifications.WallsCleaned", { count: removed, scene: scene.name })
    );
    await this.executeAudit({ silent: true });
  }

  static async #onBatchDedupeWalls() {
    if (!this._report || this._busy) return;
    const targets = this._report.scenes.items.filter((s) => s.redundantWallIds.length > 0);
    if (!targets.length) return;

    const total = targets.reduce((sum, s) => sum + s.redundantWallIds.length, 0);
    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmDedupeWalls", { count: total, scene: `${targets.length} scenes` }),
      { previewLines: targets.map((s) => `${s.name}: ${s.redundantWallIds.length} walls`) }
    );
    if (!res?.confirmed) return;

    for (const sc of targets) {
      await cleanupRedundantWalls(sc.id, sc.redundantWallIds);
    }
    await this.executeAudit({ silent: true });
  }

  static async #onDedupeNearWalls(_event, target) {
    if (!this._report || this._busy) return;
    const scene = this._report.scenes.items.find((s) => s.id === target.dataset.sceneId);
    if (!scene?.nearDuplicateWallIds?.length) return;

    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmNearWalls", {
        count: scene.nearDuplicateWallIds.length,
        scene: scene.name
      }),
      { withBackupOption: true }
    );
    if (!res?.confirmed) return;
    if (res.backupFirst) {
      const snap = snapshotWallsForBackup(scene.id, scene.nearDuplicateWallIds);
      downloadStorageBackup(this._report, { deletedWalls: snap ? [snap] : [] });
    }

    const removed = await cleanupRedundantWalls(scene.id, scene.nearDuplicateWallIds);
    ui.notifications.info(
      this.#t("WAIFU.Notifications.WallsCleaned", { count: removed, scene: scene.name })
    );
    await this.executeAudit({ silent: true });
  }

  static async #onBatchDedupeNearWalls() {
    if (!this._report || this._busy) return;
    const targets = this._report.scenes.items.filter((s) => s.nearDuplicateWallIds?.length > 0);
    if (!targets.length) return;

    const total = targets.reduce((sum, s) => sum + s.nearDuplicateWallIds.length, 0);
    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmNearWalls", { count: total, scene: `${targets.length} scenes` }),
      {
        withBackupOption: true,
        previewLines: targets.map((s) => `${s.name}: ${s.nearDuplicateWallIds.length} ~dup walls`)
      }
    );
    if (!res?.confirmed) return;
    if (res.backupFirst) {
      const deletedWalls = targets
        .map((sc) => snapshotWallsForBackup(sc.id, sc.nearDuplicateWallIds))
        .filter(Boolean);
      downloadStorageBackup(this._report, { deletedWalls });
    }

    for (const sc of targets) {
      await cleanupRedundantWalls(sc.id, sc.nearDuplicateWallIds);
    }
    await this.executeAudit({ silent: true });
  }

  static async #onCleanOrphanTokens(_event, target) {
    if (!this._report || this._busy) return;
    const scene = this._report.scenes.items.find((s) => s.id === target.dataset.sceneId);
    if (!scene?.orphanedTokenIds?.length) return;

    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmOrphanTokens", {
        count: scene.orphanedTokenIds.length,
        scene: scene.name
      })
    );
    if (!res?.confirmed) return;

    const removed = await removeOrphanedTokens(scene.id, scene.orphanedTokenIds);
    ui.notifications.info(
      this.#t("WAIFU.Notifications.OrphanTokensCleaned", { count: removed, scene: scene.name })
    );
    await this.executeAudit({ silent: true });
  }

  static async #onBatchCleanOrphanTokens() {
    if (!this._report || this._busy) return;
    const targets = this._report.scenes.items.filter((s) => s.orphanedTokenIds?.length > 0);
    if (!targets.length) return;

    const total = targets.reduce((sum, s) => sum + s.orphanedTokenIds.length, 0);
    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmOrphanTokens", { count: total, scene: `${targets.length} scenes` }),
      { previewLines: targets.map((s) => `${s.name}: ${s.orphanedTokenIds.length} tokens`) }
    );
    if (!res?.confirmed) return;

    for (const sc of targets) {
      await removeOrphanedTokens(sc.id, sc.orphanedTokenIds);
    }
    await this.executeAudit({ silent: true });
  }

  static async #onFocusSceneCanvas(_event, target) {
    const sceneId = target.dataset.sceneId;
    if (!sceneId) return;
    const scene = this._report?.scenes?.allItems?.find((s) => s.id === sceneId);
    const firstWallId = scene?.redundantWallIds?.[0] ?? scene?.nearDuplicateWallIds?.[0];
    await focusSceneOnCanvas(sceneId, { wallId: firstWallId });
  }

  static #onToggleUpdateUuidLabel(_event, target) {
    this._updateUuidLabel = Boolean(target.checked);
  }

  static async #onDisableSceneLightAnims(_event, target) {
    if (!this._report || this._busy) return;
    const scene = this._report.scenes.items.find((s) => s.id === target.dataset.sceneId);
    if (!scene?.animatedLightIds?.length) return;

    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmDisableLightAnims", {
        count: scene.animatedLightIds.length,
        scene: scene.name
      })
    );
    if (!res?.confirmed) return;

    const updated = await disableLightAnimations(scene.id, scene.animatedLightIds);
    ui.notifications.info(
      this.#t("WAIFU.Notifications.LightAnimsCleared", { count: updated, scene: scene.name })
    );
    await this.executeAudit({ silent: true });
  }

  static async #onApplySingleUuid(_event, target) {
    if (!this._report || this._busy) return;
    const occId = target.dataset.occId;
    const occurrence = this._report.uuids.items.find((item) => item.id === occId);
    if (!occurrence) return;

    const selectEl = this.element.querySelector(
      `select[data-uuid-select="${CSS.escape(occId)}"]`
    );
    const chosenUuid = selectEl?.value || occurrence.bestCandidate?.uuid;
    if (!chosenUuid) return;

    const matchedCandidate = occurrence.candidates?.find((c) => c.uuid === chosenUuid);
    const newLabel =
      this._updateUuidLabel && occurrence.reason !== "missing-anchor"
        ? matchedCandidate?.name
        : undefined;
    await patchDocumentUuidOccurrence(occurrence, {
      mode: "replace",
      newUuid: chosenUuid,
      newLabel
    });
    ui.notifications.info(
      this.#t("WAIFU.Notifications.UuidReplaced", { doc: occurrence.targetDocName })
    );
    await this.executeAudit({ silent: true });
  }

  static async #onPickUuidManual(_event, target) {
    if (!this._report || this._busy) return;
    const occId = target.dataset.occId;
    const occurrence = this._report.uuids.items.find((item) => item.id === occId);
    if (!occurrence) return;

    const catalog = buildCandidateCatalog();
    const initialQuery = occurrence.label || "";
    const content = `
      <div style="display:grid;gap:8px;">
        <div class="waifu-mono">${escapeHtml(occurrence.rawUuid)} (${escapeHtml(occurrence.targetDocType || "Any")})</div>
        <div style="display:flex;gap:6px;">
          <input type="search" data-manual-search value="${escapeHtml(initialQuery)}" placeholder="${escapeHtml(this.#t("WAIFU.Uuids.ManualSearchPlaceholder"))}" style="flex:1;">
          <label class="waifu-check-pill"><input type="checkbox" data-manual-anytype> ${escapeHtml(this.#t("WAIFU.Uuids.AnyTypeLabel"))}</label>
        </div>
        <div class="waifu-modal-list" data-manual-results></div>
      </div>
    `;

    let chosen = null;
    await this.#openDialog({
      window: { title: this.#t("WAIFU.Dialogs.ManualPickerTitle") },
      content,
      render: (arg1, arg2) => {
        const root = this.#getDialogRoot(arg1, arg2);
        if (!root) return;
        const searchInput = root.querySelector("[data-manual-search]");
        const anyTypeBox = root.querySelector("[data-manual-anytype]");
        const resultsEl = root.querySelector("[data-manual-results]");
        if (!searchInput || !resultsEl) return;

        const refresh = () => {
          const docType = anyTypeBox?.checked ? null : occurrence.targetDocType;
          const items = searchUuidCatalog(searchInput.value, catalog, { docType, limit: 30 });
          resultsEl.innerHTML = items.length
            ? items
                .map(
                  (item) =>
                    `<div class="waifu-modal-row">
                      <div class="waifu-cell-stack">
                        <strong>${escapeHtml(item.name)}</strong>
                        <span class="waifu-mono">${escapeHtml(item.docType)} • ${escapeHtml(item.sourceLabel)} • ${escapeHtml(item.uuid)}</span>
                      </div>
                      <button type="button" class="waifu-btn is-sm is-primary" data-pick-uuid="${escapeHtml(item.uuid)}" data-pick-name="${escapeHtml(item.name)}">${escapeHtml(this.#t("WAIFU.Uuids.BtnApply"))}</button>
                    </div>`
                )
                .join("")
            : `<p class="waifu-empty">${escapeHtml(this.#t("WAIFU.Uuids.NoCandidate"))}</p>`;
        };

        searchInput.addEventListener("input", refresh);
        anyTypeBox?.addEventListener("change", refresh);
        resultsEl.addEventListener("click", (ev) => {
          const btn = ev.target.closest("[data-pick-uuid]");
          if (!btn) return;
          chosen = { uuid: btn.dataset.pickUuid, name: btn.dataset.pickName };
          root.querySelector('button[data-action="cancel"]')?.click();
        });
        refresh();
      },
      buttons: [{ action: "cancel", label: game.i18n.localize("Close") }],
      rejectClose: false
    });

    if (!chosen?.uuid) return;
    await patchDocumentUuidOccurrence(occurrence, {
      mode: "replace",
      newUuid: chosen.uuid,
      newLabel: this._updateUuidLabel ? chosen.name : undefined
    });
    ui.notifications.info(
      this.#t("WAIFU.Notifications.UuidReplaced", { doc: occurrence.targetDocName })
    );
    await this.executeAudit({ silent: true });
  }

  static async #onUnlinkSingleUuid(_event, target) {
    if (!this._report || this._busy) return;
    const occurrence = this._report.uuids.items.find((item) => item.id === target.dataset.occId);
    if (!occurrence) return;

    await patchDocumentUuidOccurrence(occurrence, { mode: "unlink" });
    ui.notifications.info(
      this.#t("WAIFU.Notifications.UuidUnlinked", { doc: occurrence.targetDocName })
    );
    await this.executeAudit({ silent: true });
  }

  static async #onBatchApplyExactUuids() {
    if (!this._report || this._busy) return;
    const minConfidence = Number(this._report.thresholds?.uuidMinAutoConfidence) || 1.0;
    const autoItems = this._report.uuids.items.filter(
      (item) =>
        item.bestCandidate &&
        (item.bestCandidate.confidence === "exact" ||
          (Number(item.bestCandidate.score) || 0) >= minConfidence)
    );
    if (!autoItems.length) {
      ui.notifications.info(this.#t("WAIFU.Notifications.NothingToFix"));
      return;
    }

    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmUuidBatch", { count: autoItems.length }),
      {
        previewLines: autoItems.map(
          (i) => `${i.rootDocName}: ${i.rawUuid} -> ${i.bestCandidate.name} (${Math.round(i.bestCandidate.score * 100)}%)`
        )
      }
    );
    if (!res?.confirmed) return;

    const operations = autoItems.map((occurrence) => ({
      occurrence,
      action: {
        mode: "replace",
        newUuid: occurrence.bestCandidate.uuid,
        newLabel:
          this._updateUuidLabel && occurrence.reason !== "missing-anchor"
            ? occurrence.bestCandidate.name
            : undefined
      }
    }));
    const updated = await batchPatchUuidOccurrences(operations);
    ui.notifications.info(this.#t("WAIFU.Notifications.UuidBatchReplaced", { count: updated }));
    await this.executeAudit({ silent: true });
  }

  static async #onBatchUnlinkNoMatch() {
    if (!this._report || this._busy) return;
    const targets = this._report.uuids.items.filter((item) => !item.bestCandidate);
    if (!targets.length) {
      ui.notifications.info(this.#t("WAIFU.Notifications.NothingToFix"));
      return;
    }

    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmUnlinkBatch", { count: targets.length }),
      { previewLines: targets.map((t) => `${t.rootDocName}: ${t.rawUuid}`) }
    );
    if (!res?.confirmed) return;

    const updated = await batchPatchUuidOccurrences(
      targets.map((occurrence) => ({ occurrence, action: { mode: "unlink" } }))
    );
    ui.notifications.info(this.#t("WAIFU.Notifications.UuidBatchReplaced", { count: updated }));
    await this.executeAudit({ silent: true });
  }

  static async #onInspectSetting(_event, target) {
    const key = target.dataset.settingKey;
    const worldStorage = game.settings?.storage?.get?.("world");
    const items = worldStorage?.contents ?? [...(worldStorage?.values?.() ?? [])];
    const doc = items.find((i) => i.key === key);
    if (!doc) return;

    const fullJson = JSON.stringify(doc.value, null, 2);
    const truncatedNote =
      fullJson.length > 40_000
        ? `<p class="waifu-mono">${escapeHtml(this.#t("WAIFU.Dialogs.TruncatedNote", { total: fullJson.length }))}</p>`
        : "";
    const actionRes = await this.#openDialog({
      window: { title: `${this.#t("WAIFU.Dialogs.InspectTitle")}: ${key}` },
      content: `${truncatedNote}<pre style="max-block-size: 360px; overflow: auto; user-select: text;">${escapeHtml(
        fullJson.slice(0, 40_000)
      )}</pre>`,
      buttons: [
        {
          action: "copy",
          label: this.#t("WAIFU.Dialogs.BtnCopyJson"),
          icon: "fa-solid fa-copy",
          callback: () => "copy"
        },
        { action: "close", label: game.i18n.localize("Close"), default: true }
      ],
      rejectClose: false
    });
    if (actionRes === "copy") {
      await navigator.clipboard.writeText(fullJson);
      ui.notifications.info(this.#t("WAIFU.Notifications.Copied"));
    }
  }

  static async #onDeleteSingleSetting(_event, target) {
    if (!this._report || this._busy) return;
    const key = target.dataset.settingKey;
    const item = this._report.settings.items.find((s) => s.key === key);
    if (!item) return;

    const baseMsg = this.#t("WAIFU.Dialogs.ConfirmDeleteSetting", { key, size: item.formattedSize });
    const msg =
      item.moduleState === "active"
        ? `${baseMsg} ${this.#t("WAIFU.Dialogs.ActiveModuleWarning")}`
        : baseMsg;
    const res = await this.#confirmAction(msg, { withBackupOption: true });
    if (!res?.confirmed) return;
    if (res.backupFirst) downloadStorageBackup(this._report);

    await deleteWorldSettingByKey(key);
    ui.notifications.info(this.#t("WAIFU.Notifications.SettingDeleted", { key }));
    await this.executeAudit({ silent: true });
  }

  static async #onDeleteAllOrphanSettings() {
    if (!this._report || this._busy) return;
    const orphaned = this._report.settings.items.filter((s) => s.isOrphaned);
    if (!orphaned.length) return;

    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmDeleteOrphanSettings", { count: orphaned.length }),
      {
        withBackupOption: true,
        previewLines: orphaned.map((s) => `${s.key} (${s.formattedSize})`)
      }
    );
    if (!res?.confirmed) return;
    if (res.backupFirst) downloadStorageBackup(this._report);

    const count = await deleteWorldSettingsBatch(orphaned.map((s) => s.key));
    ui.notifications.info(this.#t("WAIFU.Notifications.SettingsBatchDeleted", { count }));
    await this.executeAudit({ silent: true });
  }

  static async #onInspectFlagGroup(_event, target) {
    const groupId = target.dataset.groupId;
    const group =
      this._report?.flags?.groups?.find((g) => g.id === groupId) ??
      this._report?.flags?.ignoredGroups?.find((g) => g.id === groupId);
    if (!group) return;

    const rowsHtml = group.targets
      .slice(0, 100)
      .map(
        (t) =>
          `<div class="waifu-modal-row" data-flag-row="${escapeHtml(t.docUuid)}">
            <div class="waifu-cell-stack">
              <strong>${escapeHtml(t.docName)} (${escapeHtml(t.formattedSize)})</strong>
              <span class="waifu-mono">${escapeHtml(t.docUuid)}</span>
            </div>
            <div class="waifu-row-actions">
              <button type="button" class="waifu-btn is-sm" data-flag-open="${escapeHtml(t.docUuid)}">${escapeHtml(this.#t("WAIFU.Uuids.BtnOpen"))}</button>
              <button type="button" class="waifu-btn is-sm" data-flag-view="${escapeHtml(t.docUuid)}">JSON</button>
              <button type="button" class="waifu-btn is-sm is-danger" data-flag-del="${escapeHtml(t.docUuid)}">${escapeHtml(this.#t("WAIFU.Storage.BtnDelete"))}</button>
            </div>
          </div>`
      )
      .join("");

    let mutated = false;
    await this.#openDialog({
      window: { title: `${this.#t("WAIFU.Dialogs.InspectTitle")}: ${group.namespace}` },
      content: `<div class="waifu-modal-list" data-flag-inspector>${rowsHtml}</div>`,
      render: (arg1, arg2) => {
        const root = this.#getDialogRoot(arg1, arg2);
        const list = root?.querySelector("[data-flag-inspector]");
        if (!list) return;
        list.addEventListener("click", async (ev) => {
          const openBtn = ev.target.closest("[data-flag-open]");
          if (openBtn) {
            const doc = await fromUuid(openBtn.dataset.flagOpen);
            doc?.sheet?.render(true);
            return;
          }
          const viewBtn = ev.target.closest("[data-flag-view]");
          if (viewBtn) {
            const doc = await fromUuid(viewBtn.dataset.flagView);
            const payload = doc?.flags?.[group.namespace];
            const json = JSON.stringify(payload ?? {}, null, 2);
            await this.#openDialog({
              window: { title: `${group.namespace} — ${doc?.name ?? viewBtn.dataset.flagView}` },
              content: `<pre style="max-block-size:340px;overflow:auto;user-select:text;">${escapeHtml(json.slice(0, 40_000))}</pre>`,
              buttons: [{ action: "close", label: game.i18n.localize("Close"), default: true }]
            });
            return;
          }
          const delBtn = ev.target.closest("[data-flag-del]");
          if (delBtn) {
            const uuid = delBtn.dataset.flagDel;
            const ok = await deleteSingleDocumentFlag(uuid, group.namespace);
            if (ok) {
              mutated = true;
              delBtn.closest("[data-flag-row]")?.remove();
              ui.notifications.info(this.#t("WAIFU.Notifications.FlagsDeleted", { count: 1 }));
            }
          }
        });
      },
      buttons: [{ action: "close", label: game.i18n.localize("Close"), default: true }],
      rejectClose: false
    });

    if (mutated) {
      await this.executeAudit({ silent: true });
    }
  }

  static async #onDeleteFlagGroup(_event, target) {
    if (!this._report || this._busy) return;
    const group = this._report.flags.groups.find((g) => g.id === target.dataset.groupId);
    if (!group) return;

    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmDeleteOrphanFlags", {
        namespace: group.namespace,
        count: group.docCount,
        size: group.formattedSize
      }),
      { withBackupOption: true }
    );
    if (!res?.confirmed) return;
    if (res.backupFirst) downloadStorageBackup(this._report);

    const count = await deleteFlagGroup(group);
    ui.notifications.info(this.#t("WAIFU.Notifications.FlagsDeleted", { count }));
    await this.executeAudit({ silent: true });
  }

  static async #onDeleteAllOrphanFlags() {
    if (!this._report || this._busy) return;
    const orphanGroups = this._report.flags.groups.filter((g) => g.isOrphaned);
    if (!orphanGroups.length) return;

    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmDeleteAllOrphanFlags", {
        count: this._report.flags.orphanedEntriesCount
      }),
      { withBackupOption: true }
    );
    if (!res?.confirmed) return;
    if (res.backupFirst) downloadStorageBackup(this._report);

    let total = 0;
    for (const grp of orphanGroups) {
      total += await deleteFlagGroup(grp);
    }
    ui.notifications.info(this.#t("WAIFU.Notifications.FlagsDeleted", { count: total }));
    await this.executeAudit({ silent: true });
  }

  static async #onCleanupAllOrphans() {
    if (!this._report || this._busy) return;
    const orphanSettings = this._report.settings.items.filter((s) => s.isOrphaned);
    const orphanGroups = this._report.flags.groups.filter((g) => g.isOrphaned);
    const totalCount = orphanSettings.length + this._report.flags.orphanedEntriesCount;
    if (!totalCount) {
      ui.notifications.info(this.#t("WAIFU.Notifications.NothingToFix"));
      return;
    }

    const res = await this.#confirmAction(
      this.#t("WAIFU.Overview.ApplyOrphanCleanup", { count: totalCount }),
      { withBackupOption: true }
    );
    if (!res?.confirmed) return;
    if (res.backupFirst) downloadStorageBackup(this._report);

    this._busy = true;
    this.render({ force: false });
    try {
      if (orphanSettings.length) {
        const deletedSettings = await deleteWorldSettingsBatch(orphanSettings.map((s) => s.key));
        ui.notifications.info(
          this.#t("WAIFU.Notifications.SettingsBatchDeleted", { count: deletedSettings })
        );
      }
      if (orphanGroups.length) {
        let deletedFlags = 0;
        for (const grp of orphanGroups) {
          deletedFlags += await deleteFlagGroup(grp);
        }
        ui.notifications.info(this.#t("WAIFU.Notifications.FlagsDeleted", { count: deletedFlags }));
      }
    } finally {
      this._busy = false;
    }
    await this.executeAudit({ silent: true });
  }

  static async #onFixAllRecommended() {
    if (!this._report || this._busy) return;
    const summary = this._report.summary;
    if (!summary.totalFixable) {
      ui.notifications.info(this.#t("WAIFU.Notifications.NothingToFix"));
      return;
    }

    const minConfidence = Number(this._report.thresholds?.uuidMinAutoConfidence) || 1.0;
    const autoUuids = this._report.uuids.items.filter(
      (u) =>
        u.bestCandidate &&
        (u.bestCandidate.confidence === "exact" ||
          (Number(u.bestCandidate.score) || 0) >= minConfidence)
    );
    const wallScenes = this._report.scenes.items.filter((s) => s.redundantWallIds.length > 0);
    const orphanSettings = this._report.settings.items.filter((s) => s.isOrphaned);
    const orphanFlagGroups = this._report.flags.groups.filter((g) => g.isOrphaned);

    const previewLines = [
      ...this._report.scenes.convertibleAssets.slice(0, 4).map((a) => `WebP: ${a.sceneName} -> ${a.src}`),
      ...wallScenes.slice(0, 3).map((s) => `Walls: ${s.name} (-${s.redundantWallIds.length})`),
      ...autoUuids.slice(0, 3).map((u) => `@UUID: ${u.rawUuid} -> ${u.bestCandidate.name}`),
      ...orphanSettings.slice(0, 3).map((s) => `Setting: ${s.key}`),
      ...orphanFlagGroups.slice(0, 3).map((g) => `Flags: ${g.namespace} (${g.docCount} docs)`)
    ];

    const res = await this.#confirmAction(
      `${this.#t("WAIFU.Rail.ActionFixAllSafeSub")} (${summary.totalFixable})`,
      { withBackupOption: true, previewLines }
    );
    if (!res?.confirmed) return;
    if (res.backupFirst) {
      const deletedWalls = wallScenes
        .map((sc) => snapshotWallsForBackup(sc.id, sc.redundantWallIds))
        .filter(Boolean);
      const sceneMedia = this._report.scenes.convertibleAssets.map((a) => ({
        sceneId: a.sceneId,
        slotType: a.slotType,
        levelId: a.levelId ?? null,
        tileId: a.tileId ?? null,
        oldSrc: a.src
      }));
      downloadStorageBackup(this._report, { deletedWalls, sceneMedia });
    }

    this._busy = true;
    this._abortController = new AbortController();
    this.render({ force: false });

    try {
      if (this._report.scenes.convertibleAssets.length) {
        await convertSceneAssetsToWebp(
          this._report.scenes.convertibleAssets,
          this._report.thresholds,
          { signal: this._abortController.signal }
        );
      }
      for (const sc of wallScenes) {
        await cleanupRedundantWalls(sc.id, sc.redundantWallIds);
      }
      if (autoUuids.length) {
        await batchPatchUuidOccurrences(
          autoUuids.map((occurrence) => ({
            occurrence,
            action: {
              mode: "replace",
              newUuid: occurrence.bestCandidate.uuid,
              newLabel:
                this._updateUuidLabel && occurrence.reason !== "missing-anchor"
                  ? occurrence.bestCandidate.name
                  : undefined
            }
          }))
        );
      }
      if (orphanSettings.length) {
        await deleteWorldSettingsBatch(orphanSettings.map((s) => s.key));
      }
      for (const grp of orphanFlagGroups) {
        await deleteFlagGroup(grp);
      }
    } finally {
      this._busy = false;
      this._abortController = null;
    }
    await this.executeAudit();
  }

  static #onBackupStorage() {
    if (!this._report) return;
    const filename = downloadStorageBackup(this._report);
    ui.notifications.info(this.#t("WAIFU.Notifications.BackupDownloaded", { filename }));
  }

  static async #onRestoreBackup() {
    if (this._busy) return;
    const picked = await this.#pickJsonFile();
    if (!picked?.text) return;

    let payload;
    try {
      payload = parseBackupPayload(picked.text);
    } catch (error) {
      ui.notifications.error(error?.message || "Invalid backup JSON");
      return;
    }

    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmRestoreBackup", {
        settings: payload.settings.length,
        flags: payload.flagsMeta.length,
        scenes: payload.sceneMedia.length,
        walls: payload.deletedWalls.reduce((sum, e) => sum + (e.walls?.length ?? 0), 0)
      })
    );
    if (!res?.confirmed) return;

    const result = await restoreBackupPayload(payload);
    ui.notifications.info(
      this.#t("WAIFU.Notifications.BackupRestored", {
        settings: result.restoredSettings,
        flags: result.restoredFlags,
        scenes: result.restoredScenes,
        walls: result.restoredWalls
      })
    );
    for (const err of result.errors) {
      ui.notifications.warn(err);
    }
    await this.executeAudit({ silent: true });
  }

  static async #onCompareReportFile() {
    if (!this._report) return;
    const picked = await this.#pickJsonFile();
    if (!picked?.text) return;
    try {
      const prev = JSON.parse(picked.text);
      if (!prev?.summary || !prev?.scenes) {
        throw new Error("Invalid WAIFU JSON report");
      }
      this._customComparison = compareAuditReports(this._report, prev);
      this.render({ parts: ["main"] });
    } catch (error) {
      ui.notifications.error(error?.message || "Invalid report JSON");
    }
  }

  static #onClearComparison() {
    this._customComparison = null;
    this.render({ parts: ["main"] });
  }

  static async #onToggleIgnoreItem(_event, target) {
    const { ignoreCategory, ignoreId } = target.dataset;
    if (!ignoreCategory || !ignoreId) return;
    const added = await toggleIgnoreRule(ignoreCategory, ignoreId);
    ui.notifications.info(
      this.#t(added ? "WAIFU.Notifications.IgnoreAdded" : "WAIFU.Notifications.IgnoreRemoved", {
        id: ignoreId
      })
    );
    await this.executeAudit({ silent: true });
  }

  static async #onManageIgnoreRules() {
    const rules = readIgnoreRules();
    const entries = [
      ...rules.scenes.map((id) => ({ category: "scenes", id, label: `Scene: ${id}` })),
      ...rules.settings.map((id) => ({ category: "settings", id, label: `Setting: ${id}` })),
      ...rules.flags.map((id) => ({ category: "flags", id, label: `Flags: ${id}` })),
      ...rules.uuids.map((id) => ({ category: "uuids", id, label: `@UUID: ${id}` }))
    ];
    if (!entries.length) {
      ui.notifications.info(this.#t("WAIFU.Notifications.NothingToFix"));
      return;
    }

    const rowsHtml = entries
      .map(
        (e) =>
          `<div class="waifu-modal-row" data-ign-row>
            <span class="waifu-mono waifu-ellipsis">${escapeHtml(e.label)}</span>
            <button type="button" class="waifu-btn is-sm" data-unignore-cat="${escapeHtml(e.category)}" data-unignore-id="${escapeHtml(e.id)}">${escapeHtml(this.#t("WAIFU.Ignore.Unignore"))}</button>
          </div>`
      )
      .join("");

    let changed = false;
    await this.#openDialog({
      window: { title: this.#t("WAIFU.Ignore.ManageTitle") },
      content: `<div class="waifu-modal-list" data-ignore-manager>${rowsHtml}</div>`,
      render: (arg1, arg2) => {
        const root = this.#getDialogRoot(arg1, arg2);
        const list = root?.querySelector("[data-ignore-manager]");
        list?.addEventListener("click", async (ev) => {
          const btn = ev.target.closest("[data-unignore-cat]");
          if (!btn) return;
          await toggleIgnoreRule(btn.dataset.unignoreCat, btn.dataset.unignoreId);
          changed = true;
          btn.closest("[data-ign-row]")?.remove();
        });
      },
      buttons: [{ action: "close", label: game.i18n.localize("Close"), default: true }],
      rejectClose: false
    });

    if (changed) await this.executeAudit({ silent: true });
  }

  static async #onArchiveChatMessages() {
    if (!this._report?.extras?.chatMessagesCount || this._busy) return;
    const total = this._report.extras.chatMessagesCount;
    const res = await this.#openDialog({
      window: { title: this.#t("WAIFU.Extras.BtnPruneChat") },
      content: `
        <div style="display:grid;gap:8px;">
          <p>${escapeHtml(this.#t("WAIFU.Dialogs.ConfirmPruneChat", { total }))}</p>
          <label class="waifu-settings-field">
            <span>${escapeHtml(this.#t("WAIFU.Dialogs.KeepMessagesLabel"))}</span>
            <input type="number" name="keepLast" min="0" max="${total}" value="${Math.min(100, total)}">
          </label>
          <label class="waifu-settings-field is-check">
            <input type="checkbox" name="exportFirst" checked>
            <span>${escapeHtml(this.#t("WAIFU.Dialogs.ExportChatArchiveLabel"))}</span>
          </label>
        </div>
      `,
      buttons: [
        {
          action: "confirm",
          label: game.i18n.localize("Confirm"),
          icon: "fa-solid fa-check",
          default: true,
          callback: (_ev, btn) => ({
            confirmed: true,
            keepLast: Math.max(0, Number(btn.form?.elements?.keepLast?.value) || 0),
            exportFirst: Boolean(btn.form?.elements?.exportFirst?.checked)
          })
        },
        { action: "cancel", label: game.i18n.localize("Cancel"), callback: () => ({ confirmed: false }) }
      ],
      rejectClose: false
    });
    if (!res?.confirmed) return;

    const out = await archiveAndPruneChatMessages({
      keepLast: res.keepLast,
      exportFirst: res.exportFirst
    });
    ui.notifications.info(
      this.#t("WAIFU.Notifications.ChatPruned", { count: out.deletedCount })
    );
    await this.executeAudit({ silent: true });
  }

  static async #onCleanStaleCombats() {
    const stale = this._report?.extras?.staleCombats ?? [];
    if (!stale.length || this._busy) return;
    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmCleanCombats", { count: stale.length })
    );
    if (!res?.confirmed) return;

    const deleted = await cleanupStaleCombats(stale.map((c) => c.id));
    ui.notifications.info(this.#t("WAIFU.Notifications.CombatsCleaned", { count: deleted }));
    await this.executeAudit({ silent: true });
  }

  static #onExportHtml() {
    if (!this._report) return;
    const { theme, accent } = this.#getAppearance();
    const html = formatReportHtml(this._report, {
      lang: this.#getLang(),
      theme,
      accent
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `waifu-audit-${this._report.meta.worldId}-${stamp}.html`;
    foundry.utils.saveDataToFile(html, "text/html", filename);
    ui.notifications.info(this.#t("WAIFU.Notifications.Exported", { filename }));
  }

  static #onExportMarkdown() {
    if (!this._report) return;
    const md = formatReportMarkdown(this._report, this.#getLang());
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `waifu-audit-${this._report.meta.worldId}-${stamp}.md`;
    foundry.utils.saveDataToFile(md, "text/markdown", filename);
    ui.notifications.info(this.#t("WAIFU.Notifications.Exported", { filename }));
  }

  static #onExportJson() {
    if (!this._report) return;
    const json = formatReportJson(this._report);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `waifu-audit-${this._report.meta.worldId}-${stamp}.json`;
    foundry.utils.saveDataToFile(json, "application/json", filename);
    ui.notifications.info(this.#t("WAIFU.Notifications.Exported", { filename }));
  }

  static async #onCopyMarkdown() {
    if (!this._report) return;
    const md = formatReportMarkdown(this._report, this.#getLang());
    await navigator.clipboard.writeText(md);
    ui.notifications.info(this.#t("WAIFU.Notifications.Copied"));
  }

  static async #onSaveJournalReport() {
    if (!this._report) return;
    const lang = this.#getLang();
    const title = `WAIFU Audit — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    const html = formatReportJournalHtml(this._report, lang);
    const entry = await JournalEntry.create({
      name: title,
      pages: [
        {
          name: "Audit Report",
          type: "text",
          text: { content: html, format: 1 }
        }
      ]
    });
    ui.notifications.info(this.#t("WAIFU.Notifications.JournalCreated", { name: title }));
    entry?.sheet?.render(true);
  }

  static async #onOpenDocumentSheet(_event, target) {
    const uuid = target.dataset.uuid;
    if (!uuid) return;
    const doc = await fromUuid(uuid);
    doc?.sheet?.render(true);
  }
}
