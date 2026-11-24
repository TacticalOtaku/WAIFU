import { ACCENT_OPTIONS, MODULE_ID, SEVERITY_ORDER, THEME_OPTIONS } from "../constants.mjs";
import { buildReportCharts } from "../core/charts.mjs";
import {
  formatReportHtml,
  formatReportHtmlBody,
  formatReportJournalHtml,
  formatReportJson,
  formatReportMarkdown
} from "../core/report.mjs";
import { buildReportStatistics } from "../core/statistics.mjs";
import { escapeHtml, formatBytes, interpolate } from "../core/utils.mjs";
import {
  batchPatchUuidOccurrences,
  cleanupRedundantWalls,
  convertSceneAssetsToWebp,
  deleteFlagGroup,
  deleteWorldSettingByKey,
  deleteWorldSettingsBatch,
  disableLightAnimations,
  downloadStorageBackup,
  patchDocumentUuidOccurrence
} from "../foundry/auto-fixer.mjs";
import { readThresholdSettings, runWorldAudit } from "../foundry/world-audit-runner.mjs";

const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEXT_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Foundry v14 ApplicationV2 diagnostic report workspace for world auditing and safe auto-fixes.
 */
export class WaifuAuditApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this._report = options.report ?? null;
    this._activeTab = "overview";
    this._reportMode = "visual";
    this._busy = false;
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
      height: 780
    },
    actions: {
      runAudit: WaifuAuditApp.#onRunAudit,
      selectTab: WaifuAuditApp.#onSelectTab,
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
      disableSceneLightAnims: WaifuAuditApp.#onDisableSceneLightAnims,
      applySingleUuid: WaifuAuditApp.#onApplySingleUuid,
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
    sidebar: {
      template: `modules/${MODULE_ID}/templates/sidebar.hbs`,
      scrollable: [".waifu-sidebar"]
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
      flags
    };
    const stats = report?.statistics ?? buildReportStatistics(effectiveReport);
    const charts = buildReportCharts(effectiveReport, stats, lang);

    const activeModules = [...(game.modules ?? [])].filter((m) => m.active).length;
    const installedModules = game.modules?.size ?? 0;

    const storageIssuesTotal = settings.flaggedCount + flags.groupsCount;
    const navTabs = [
      {
        id: "overview",
        icon: "fa-solid fa-chart-line",
        label: this.#t("WAIFU.Tabs.Overview"),
        subline: this.#t("WAIFU.Sidebar.TabSubOverview"),
        badge: 0,
        hasBadge: false,
        badgeTone: ""
      },
      {
        id: "scenes",
        icon: "fa-solid fa-layer-group",
        label: this.#t("WAIFU.Tabs.Scenes"),
        subline: this.#t("WAIFU.Sidebar.TabSubScenes", {
          heavy: scenes.heavyScenesCount,
          total: scenes.totalScenes,
          png: scenes.pngAssetsCount
        }),
        badge: scenes.heavyScenesCount,
        hasBadge: scenes.heavyScenesCount > 0,
        badgeTone: scenes.criticalCount > 0 ? "critical" : "warning"
      },
      {
        id: "uuids",
        icon: "fa-solid fa-link-slash",
        label: this.#t("WAIFU.Tabs.Uuids"),
        subline: this.#t("WAIFU.Sidebar.TabSubUuids", {
          broken: uuids.brokenCount,
          scanned: uuids.totalScanned
        }),
        badge: uuids.brokenCount,
        hasBadge: uuids.brokenCount > 0,
        badgeTone: "critical"
      },
      {
        id: "storage",
        icon: "fa-solid fa-database",
        label: this.#t("WAIFU.Tabs.Storage"),
        subline: this.#t("WAIFU.Sidebar.TabSubStorage", {
          size: settings.formattedTotalSize,
          orphans: settings.orphanedCount + flags.orphanedNamespacesCount
        }),
        badge: storageIssuesTotal,
        hasBadge: storageIssuesTotal > 0,
        badgeTone:
          settings.orphanedCount + flags.orphanedNamespacesCount > 0 ? "warning" : ""
      },
      {
        id: "report",
        icon: "fa-solid fa-file-waveform",
        label: this.#t("WAIFU.Tabs.Report"),
        subline: this.#t("WAIFU.Sidebar.TabSubReport"),
        badge: 0,
        hasBadge: false,
        badgeTone: ""
      }
    ].map((tab) => ({ ...tab, active: tab.id === this._activeTab }));

    const sceneRows = scenes.items.map((scene) => {
      const tags = ["all"];
      if (scene.hasIssues) tags.push("heavy");
      if (scene.flags.hasUnoptimizedRaster) tags.push("png");
      if (scene.flags.excessiveWalls || scene.flags.excessiveLights || scene.flags.excessiveAnimations) {
        tags.push("geometry");
      }

      const issueAssets = scene.assets
        .filter((asset) => asset.isUnoptimizedRaster || asset.isOversized)
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

      const assetPaths = scene.assets.map((a) => a.src).join(" ");
      return {
        ...scene,
        severityRank: SEVERITY_ORDER[scene.severity] ?? 0,
        severityLabel: this.#t(`WAIFU.Severity.${scene.severity}`),
        issueAssets,
        hasExcessiveAnimsWithLights:
          scene.flags.excessiveAnimations && scene.animatedLightIds.length > 0,
        filterTags: tags.join(" "),
        searchText: `${scene.name} ${assetPaths}`.toLowerCase()
      };
    });

    const uuidRows = uuids.items.map((item) => {
      const tags = ["all", item.sourceCategory];
      if (item.bestCandidate) tags.push("matched");
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
    });

    const settingRows = settings.items.map((item) => ({
      ...item,
      statusLabel: this.#t(`WAIFU.Storage.Status.${item.status}`),
      searchText: `${item.namespace} ${item.settingKey} ${item.status}`.toLowerCase()
    }));

    const flagGroupRows = flags.groups.map((group) => ({
      ...group,
      docTypesLabel: group.docTypes.join(", "),
      statusLabel: this.#t(`WAIFU.Storage.Status.${group.status}`),
      searchText: `${group.namespace} ${group.docTypes.join(" ")} ${group.status}`.toLowerCase()
    }));

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
      if (rec.id === "apply-exact-uuids") {
        return {
          ...rec,
          label: this.#t("WAIFU.Overview.ApplyUuidExact", { count: rec.count }),
          detail: "100% normalized name + Document type matches"
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

    return {
      ...context,
      hasReport: Boolean(report),
      busy: this._busy,
      appearanceOpen: this._appearanceOpen,
      isNightTheme: theme === "night",
      isParchmentTheme: theme === "parchment",
      accents: ACCENT_OPTIONS.map((id) => ({
        id,
        label: this.#t(`WAIFU.Theme.${id[0].toUpperCase()}${id.slice(1)}`),
        active: id === accent
      })),
      summary,
      stats,
      charts,
      uuidMissingPackCount: stats.uuidStats.byReason["missing-pack"] ?? 0,
      scenes,
      uuids,
      settings,
      flags,
      thresholds,
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
      execSub: {
        health: this.#t("WAIFU.Overview.ExecHealthSub", {
          critical: summary.criticalCount,
          warning: summary.warningCount,
          deduction: stats.scoreBreakdown.totalDeduction
        }),
        scenes: this.#t("WAIFU.Overview.ExecScenesSub", {
          healthy: stats.sceneStats.healthyScenes,
          total: stats.sceneStats.totalScenes,
          webp: stats.sceneStats.assetFormats.webpRasterPercent
        }),
        uuids: this.#t("WAIFU.Overview.ExecUuidsSub", {
          broken: stats.uuidStats.brokenCount,
          exact: stats.uuidStats.byFixability.exact
        }),
        storage: this.#t("WAIFU.Overview.ExecStorageSub", {
          percent: stats.storageStats.reclaimablePercent,
          total: stats.storageStats.formattedTrackedSize
        })
      },
      hasAnyFixable: summary.totalFixable > 0,
      navTabs,
      isOverviewActive: this._activeTab === "overview",
      isScenesActive: this._activeTab === "scenes",
      isUuidsActive: this._activeTab === "uuids",
      isStorageActive: this._activeTab === "storage",
      isReportActive: this._activeTab === "report",
      isReportVisual: this._reportMode === "visual",
      isReportMarkdown: this._reportMode === "markdown",
      isReportJournal: this._reportMode === "journal",
      filters: this._filters,
      sceneFilterChips: [
        { id: "all", label: this.#t("WAIFU.Scenes.FilterAll") },
        { id: "heavy", label: this.#t("WAIFU.Scenes.FilterHeavy") },
        { id: "png", label: this.#t("WAIFU.Scenes.FilterPng") },
        { id: "geometry", label: this.#t("WAIFU.Scenes.FilterGeometry") }
      ].map((c) => ({ ...c, active: c.id === this._filters.scenesTag })),
      uuidFilterChips: [
        { id: "all", label: this.#t("WAIFU.Uuids.FilterAll") },
        { id: "journal", label: this.#t("WAIFU.Uuids.FilterJournals") },
        { id: "loreframe", label: this.#t("WAIFU.Uuids.FilterLoreframe") },
        { id: "actor", label: this.#t("WAIFU.Uuids.FilterActors") },
        { id: "matched", label: this.#t("WAIFU.Uuids.FilterWithMatch") }
      ].map((c) => ({ ...c, active: c.id === this._filters.uuidsTag })),
      storageFilterChips: [
        { id: "all", label: this.#t("WAIFU.Storage.FilterAll") },
        { id: "orphaned", label: this.#t("WAIFU.Storage.FilterOrphaned") },
        { id: "inactive", label: this.#t("WAIFU.Storage.FilterInactive") },
        { id: "bloated", label: this.#t("WAIFU.Storage.FilterBloated") }
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

    this.#bindLayoutObserver();
    this.#bindFilterInputs();
    this.#bindTabKeyboard();
    this.#bindMenuDismiss();
    this.#applyDomFilters();
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
    if (!tabId || this._activeTab === tabId) return;
    this._activeTab = tabId;

    for (const tabBtn of this.element.querySelectorAll('[role="tab"]')) {
      const selected = tabBtn.dataset.tab === tabId;
      tabBtn.setAttribute("aria-selected", selected ? "true" : "false");
      tabBtn.tabIndex = selected ? 0 : -1;
      if (selected) {
        tabBtn.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }
    for (const panel of this.element.querySelectorAll('[role="tabpanel"]')) {
      panel.hidden = panel.dataset.panel !== tabId;
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

  #announceStatus(message) {
    this._statusMessage = message;
    const region = this.element?.querySelector("[data-waifu-status]");
    if (region) region.textContent = message;
  }

  async executeAudit({ silent = false } = {}) {
    if (this._busy) return this._report;
    this._busy = true;
    if (this.rendered) this.render({ force: false });

    try {
      this._report = await runWorldAudit();
      const msg = this.#t("WAIFU.Notifications.AuditComplete", {
        duration: this._report.meta.durationMs,
        issues: this._report.summary.totalIssues
      });
      this._statusMessage = msg;
      if (!silent) ui.notifications.info(msg);
    } catch (error) {
      console.error("WAIFU | Audit failed", error);
      ui.notifications.error(error?.message || "WAIFU audit failed");
    } finally {
      this._busy = false;
      if (this.rendered) this.render({ force: false });
    }
    return this._report;
  }

  async #confirmAction(message, { withBackupOption = false } = {}) {
    let content = `<p>${escapeHtml(message)}</p>`;
    if (withBackupOption) {
      content += `<label style="display:flex;align-items:center;gap:8px;margin-top:8px;"><input type="checkbox" name="backupFirst" checked> ${escapeHtml(
        this.#t("WAIFU.Dialogs.DownloadBackupLabel")
      )}</label>`;
    }

    return DialogV2.wait({
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

  static #onSelectTab(_event, target) {
    this.#switchTab(target.dataset.tab);
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

  static #onOpenModuleSettings() {
    game.settings.sheet.render(true);
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
    const tbody = table?.tBodies?.[0];
    if (!th || !table || !tbody) return;

    const direction = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
    for (const header of table.tHead.rows[0].cells) {
      header.removeAttribute("aria-sort");
    }
    th.setAttribute("aria-sort", direction);

    const colIndex = th.cellIndex;
    const type = th.dataset.type || "string";
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
      if (typeof tbody.moveBefore === "function") {
        tbody.moveBefore(row, null);
      } else {
        tbody.appendChild(row);
      }
    }

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

    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmWebpBatch", { count: assets.length })
    );
    if (!res?.confirmed) return;

    await this.#runWebpConversion(assets);
  }

  async #runWebpConversion(assets) {
    this._busy = true;
    this.render({ force: false });
    try {
      const result = await convertSceneAssetsToWebp(assets, this._report.thresholds);
      if (result.convertedCount > 0) {
        ui.notifications.info(
          this.#t("WAIFU.Notifications.WebpConverted", {
            count: result.convertedCount,
            saved: result.formattedSaved
          })
        );
      }
      for (const fail of result.failures) {
        ui.notifications.warn(
          this.#t("WAIFU.Notifications.WebpFailed", { src: fail.src, error: fail.error })
        );
      }
    } finally {
      this._busy = false;
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
      this.#t("WAIFU.Dialogs.ConfirmDedupeWalls", { count: total, scene: `${targets.length} scenes` })
    );
    if (!res?.confirmed) return;

    for (const sc of targets) {
      await cleanupRedundantWalls(sc.id, sc.redundantWallIds);
    }
    await this.executeAudit({ silent: true });
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

    await patchDocumentUuidOccurrence(occurrence, { mode: "replace", newUuid: chosenUuid });
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
    const exactItems = this._report.uuids.items.filter(
      (item) => item.bestCandidate?.confidence === "exact"
    );
    if (!exactItems.length) {
      ui.notifications.info(this.#t("WAIFU.Notifications.NothingToFix"));
      return;
    }

    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmUuidBatch", { count: exactItems.length })
    );
    if (!res?.confirmed) return;

    const operations = exactItems.map((occurrence) => ({
      occurrence,
      action: { mode: "replace", newUuid: occurrence.bestCandidate.uuid }
    }));
    const updated = await batchPatchUuidOccurrences(operations);
    ui.notifications.info(this.#t("WAIFU.Notifications.UuidBatchReplaced", { count: updated }));
    await this.executeAudit({ silent: true });
  }

  static async #onBatchUnlinkNoMatch() {
    if (!this._report || this._busy) return;
    const unmatched = this._report.uuids.items.filter((item) => !item.bestCandidate);
    const targets = unmatched.length ? unmatched : this._report.uuids.items;
    if (!targets.length) return;

    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmUnlinkBatch", { count: targets.length })
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

    const json = JSON.stringify(doc.value, null, 2);
    await DialogV2.wait({
      window: { title: `${this.#t("WAIFU.Dialogs.InspectTitle")}: ${key}` },
      content: `<pre style="max-block-size: 360px; overflow: auto; user-select: text;">${escapeHtml(
        json.slice(0, 40_000)
      )}</pre>`,
      buttons: [{ action: "close", label: game.i18n.localize("Close"), default: true }]
    });
  }

  static async #onDeleteSingleSetting(_event, target) {
    if (!this._report || this._busy) return;
    const key = target.dataset.settingKey;
    const item = this._report.settings.items.find((s) => s.key === key);
    if (!item) return;

    const res = await this.#confirmAction(
      this.#t("WAIFU.Dialogs.ConfirmDeleteSetting", { key, size: item.formattedSize }),
      { withBackupOption: true }
    );
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
      { withBackupOption: true }
    );
    if (!res?.confirmed) return;
    if (res.backupFirst) downloadStorageBackup(this._report);

    const count = await deleteWorldSettingsBatch(orphaned.map((s) => s.key));
    ui.notifications.info(this.#t("WAIFU.Notifications.SettingsBatchDeleted", { count }));
    await this.executeAudit({ silent: true });
  }

  static async #onInspectFlagGroup(_event, target) {
    const group = this._report?.flags?.groups?.find((g) => g.id === target.dataset.groupId);
    if (!group) return;

    const lines = group.targets
      .slice(0, 100)
      .map(
        (t) =>
          `<li><code>${escapeHtml(t.docUuid)}</code> — ${escapeHtml(t.docName)} (${escapeHtml(
            t.formattedSize
          )})</li>`
      )
      .join("");
    await DialogV2.wait({
      window: { title: `${this.#t("WAIFU.Dialogs.InspectTitle")}: ${group.namespace}` },
      content: `<ul style="max-block-size: 360px; overflow: auto;">${lines}</ul>`,
      buttons: [{ action: "close", label: game.i18n.localize("Close"), default: true }]
    });
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

    const res = await this.#confirmAction(
      `${this.#t("WAIFU.Rail.ActionFixAllSafeSub")} (${summary.totalFixable})`,
      { withBackupOption: true }
    );
    if (!res?.confirmed) return;
    if (res.backupFirst) downloadStorageBackup(this._report);

    this._busy = true;
    this.render({ force: false });

    try {
      if (this._report.scenes.convertibleAssets.length) {
        await convertSceneAssetsToWebp(
          this._report.scenes.convertibleAssets,
          this._report.thresholds
        );
      }
      for (const sc of this._report.scenes.items.filter((s) => s.redundantWallIds.length > 0)) {
        await cleanupRedundantWalls(sc.id, sc.redundantWallIds);
      }
      const exactUuids = this._report.uuids.items.filter(
        (u) => u.bestCandidate?.confidence === "exact"
      );
      if (exactUuids.length) {
        await batchPatchUuidOccurrences(
          exactUuids.map((occurrence) => ({
            occurrence,
            action: { mode: "replace", newUuid: occurrence.bestCandidate.uuid }
          }))
        );
      }
      const orphanSettings = this._report.settings.items.filter((s) => s.isOrphaned);
      if (orphanSettings.length) {
        await deleteWorldSettingsBatch(orphanSettings.map((s) => s.key));
      }
      for (const grp of this._report.flags.groups.filter((g) => g.isOrphaned)) {
        await deleteFlagGroup(grp);
      }
    } finally {
      this._busy = false;
    }
    await this.executeAudit();
  }

  static #onBackupStorage() {
    if (!this._report) return;
    const filename = downloadStorageBackup(this._report);
    ui.notifications.info(this.#t("WAIFU.Notifications.BackupDownloaded", { filename }));
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
