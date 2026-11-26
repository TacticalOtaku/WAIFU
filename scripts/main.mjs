import { WaifuAuditApp } from "./app/audit-app.mjs";
import {
  ACCENT_OPTIONS,
  AUDIT_HISTORY_SETTING,
  DEFAULT_IGNORE_RULES,
  DEFAULT_THRESHOLDS,
  IGNORE_RULES_SETTING,
  MODULE_ID,
  THEME_OPTIONS
} from "./constants.mjs";
import {
  compareAuditReports,
  formatReportHtml,
  formatReportJson,
  formatReportMarkdown
} from "./core/report.mjs";
import { parseBackupPayload, restoreBackupPayload } from "./foundry/auto-fixer.mjs";
import { buildCandidateCatalog, runWorldAudit } from "./foundry/world-audit-runner.mjs";

function registerModuleSettings() {
  game.settings.registerMenu(MODULE_ID, "openAuditDashboard", {
    name: "WAIFU.Controls.MenuName",
    label: "WAIFU.Controls.MenuLabel",
    hint: "WAIFU.Controls.MenuHint",
    icon: "fa-solid fa-stethoscope",
    type: WaifuAuditApp,
    restricted: true
  });

  game.settings.register(MODULE_ID, "maxTextureResolution", {
    name: "WAIFU.Settings.MaxTextureResolution.Name",
    hint: "WAIFU.Settings.MaxTextureResolution.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULT_THRESHOLDS.maxTextureResolution
  });

  game.settings.register(MODULE_ID, "maxMegapixels", {
    name: "WAIFU.Settings.MaxMegapixels.Name",
    hint: "WAIFU.Settings.MaxMegapixels.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULT_THRESHOLDS.maxMegapixels
  });

  game.settings.register(MODULE_ID, "maxWalls", {
    name: "WAIFU.Settings.MaxWalls.Name",
    hint: "WAIFU.Settings.MaxWalls.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULT_THRESHOLDS.maxWalls
  });

  game.settings.register(MODULE_ID, "maxLights", {
    name: "WAIFU.Settings.MaxLights.Name",
    hint: "WAIFU.Settings.MaxLights.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULT_THRESHOLDS.maxLights
  });

  game.settings.register(MODULE_ID, "maxAnimations", {
    name: "WAIFU.Settings.MaxAnimations.Name",
    hint: "WAIFU.Settings.MaxAnimations.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULT_THRESHOLDS.maxAnimations
  });

  game.settings.register(MODULE_ID, "maxSettingBytes", {
    name: "WAIFU.Settings.MaxSettingBytes.Name",
    hint: "WAIFU.Settings.MaxSettingBytes.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULT_THRESHOLDS.maxSettingBytes
  });

  game.settings.register(MODULE_ID, "maxFlagBytes", {
    name: "WAIFU.Settings.MaxFlagBytes.Name",
    hint: "WAIFU.Settings.MaxFlagBytes.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULT_THRESHOLDS.maxFlagBytes
  });

  game.settings.register(MODULE_ID, "webpQuality", {
    name: "WAIFU.Settings.WebpQuality.Name",
    hint: "WAIFU.Settings.WebpQuality.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0.5, max: 1.0, step: 0.05 },
    default: DEFAULT_THRESHOLDS.webpQuality
  });

  game.settings.register(MODULE_ID, "downscaleOnConvert", {
    name: "WAIFU.Settings.DownscaleOnConvert.Name",
    hint: "WAIFU.Settings.DownscaleOnConvert.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: DEFAULT_THRESHOLDS.downscaleOnConvert
  });

  game.settings.register(MODULE_ID, "includeChatMessages", {
    name: "WAIFU.Settings.IncludeChatMessages.Name",
    hint: "WAIFU.Settings.IncludeChatMessages.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "maxAssetBytes", {
    name: "WAIFU.Settings.MaxAssetBytes.Name",
    hint: "WAIFU.Settings.MaxAssetBytes.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULT_THRESHOLDS.maxAssetBytes
  });

  game.settings.register(MODULE_ID, "nearDuplicateWallTolerance", {
    name: "WAIFU.Settings.NearDuplicateWallTolerance.Name",
    hint: "WAIFU.Settings.NearDuplicateWallTolerance.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 10, step: 1 },
    default: DEFAULT_THRESHOLDS.nearDuplicateWallTolerance
  });

  game.settings.register(MODULE_ID, "skipLargerWebp", {
    name: "WAIFU.Settings.SkipLargerWebp.Name",
    hint: "WAIFU.Settings.SkipLargerWebp.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: DEFAULT_THRESHOLDS.skipLargerWebp
  });

  game.settings.register(MODULE_ID, "uuidMinAutoConfidence", {
    name: "WAIFU.Settings.UuidMinAutoConfidence.Name",
    hint: "WAIFU.Settings.UuidMinAutoConfidence.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0.75, max: 1.0, step: 0.05 },
    default: DEFAULT_THRESHOLDS.uuidMinAutoConfidence
  });

  game.settings.register(MODULE_ID, "maxChatMessages", {
    name: "WAIFU.Settings.MaxChatMessages.Name",
    hint: "WAIFU.Settings.MaxChatMessages.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULT_THRESHOLDS.maxChatMessages
  });

  game.settings.register(MODULE_ID, IGNORE_RULES_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULT_IGNORE_RULES
  });

  game.settings.register(MODULE_ID, AUDIT_HISTORY_SETTING, {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(MODULE_ID, "theme", {
    name: "WAIFU.Settings.Theme.Name",
    hint: "WAIFU.Settings.Theme.Hint",
    scope: "user",
    config: true,
    type: String,
    choices: {
      night: "WAIFU.Settings.Theme.Night",
      parchment: "WAIFU.Settings.Theme.Parchment"
    },
    default: THEME_OPTIONS[0]
  });

  game.settings.register(MODULE_ID, "accent", {
    name: "WAIFU.Settings.Accent.Name",
    hint: "WAIFU.Settings.Accent.Hint",
    scope: "user",
    config: true,
    type: String,
    choices: Object.fromEntries(
      ACCENT_OPTIONS.map((id) => [id, `WAIFU.Theme.${id[0].toUpperCase()}${id.slice(1)}`])
    ),
    default: ACCENT_OPTIONS[0]
  });
}

function createPublicApi() {
  return Object.freeze({
    open: (report = null) => WaifuAuditApp.openWindow(report),
    runAudit: (overrides = {}, runtimeOptions = {}) => runWorldAudit(overrides, runtimeOptions),
    exportReport: (report, format = "markdown", lang = "en") => {
      if (format === "json") return formatReportJson(report);
      if (format === "html") return formatReportHtml(report, { lang });
      return formatReportMarkdown(report, lang);
    },
    compareReports: (currentReport, previousReport) =>
      compareAuditReports(currentReport, previousReport),
    parseBackup: (rawJson) => parseBackupPayload(rawJson),
    restoreBackup: (payload) => restoreBackupPayload(payload),
    buildCandidateCatalog: () => buildCandidateCatalog()
  });
}

Hooks.once("init", () => {
  registerModuleSettings();
  const loadTemplatesFn =
    foundry.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
  loadTemplatesFn?.([
    `modules/${MODULE_ID}/templates/masthead.hbs`,
    `modules/${MODULE_ID}/templates/main.hbs`,
    `modules/${MODULE_ID}/templates/partials/view-hub.hbs`,
    `modules/${MODULE_ID}/templates/partials/view-health.hbs`,
    `modules/${MODULE_ID}/templates/partials/view-autofix.hbs`,
    `modules/${MODULE_ID}/templates/partials/view-scenes.hbs`,
    `modules/${MODULE_ID}/templates/partials/view-uuids.hbs`,
    `modules/${MODULE_ID}/templates/partials/view-storage.hbs`,
    `modules/${MODULE_ID}/templates/partials/view-report.hbs`,
    `modules/${MODULE_ID}/templates/partials/scene-drawer.hbs`
  ]);
});

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  const api = createPublicApi();
  if (mod) mod.api = api;
  globalThis.WAIFU = api;
  Hooks.callAll(`${MODULE_ID}.ready`, api);
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user?.isGM || !controls?.tokens?.tools) return;
  controls.tokens.tools.waifuAudit = {
    name: "waifuAudit",
    title: "WAIFU.Controls.OpenAudit",
    icon: "fa-solid fa-stethoscope",
    order: Object.keys(controls.tokens.tools).length,
    button: true,
    visible: true,
    onChange: () => WaifuAuditApp.openWindow()
  };
});

Hooks.on("renderSettings", (_app, element) => {
  if (!game.user?.isGM || !element) return;
  if (element.querySelector("#waifu-open-audit-btn")) return;

  const targetSection =
    element.querySelector("#settings-game") ??
    element.querySelector(".settings-sidebar") ??
    element.querySelector("#settings") ??
    element;

  const button = document.createElement("button");
  button.id = "waifu-open-audit-btn";
  button.type = "button";
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-stethoscope";
  icon.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = game.i18n.localize("WAIFU.Controls.SettingsButton");
  button.append(icon, " ", label);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    WaifuAuditApp.openWindow();
  });

  targetSection.appendChild(button);
});
