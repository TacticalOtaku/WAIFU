import { ACCENT_OPTIONS, MODULE_ID, THEME_OPTIONS } from "../constants.mjs";
import { escapeHtml, interpolate } from "../core/utils.mjs";

const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } = foundry.applications.api;

const BUSY_RING_CIRCUMFERENCE = 2 * Math.PI * 40; // ~251.33 for r=40

/**
 * Yield to browser repaint loop so live progress overlays update smoothly during batch mutations.
 * @returns {Promise<void>}
 */
export function yieldToUi() {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return new Promise((resolve) => globalThis.requestAnimationFrame(() => resolve()));
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function resetBusyArcToZero(arc) {
  if (!arc) return;
  arc.style.transition = "none";
  arc.style.strokeDashoffset = BUSY_RING_CIRCUMFERENCE.toFixed(2);
  if (typeof arc.getBoundingClientRect === "function") {
    void arc.getBoundingClientRect();
  }
  arc.style.transition = "";
}

/**
 * Shared ApplicationV2 base class providing AIM theming, DialogV2 helpers, and the tinted circular busy overlay.
 */
export class WaifuBaseApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this._busy = false;
    this._progressPercent = 0;
    this._progressLabel = "";
    this._progressDetail = "";
    this._abortController = null;
    this._statusMessage = "";
  }

  static BASE_ACTIONS = {
    cancelOperation: WaifuBaseApp.#onCancelOperation
  };

  _t(key, params = null) {
    const raw = game.i18n.localize(key);
    return params ? interpolate(raw, params) : raw;
  }

  _getLang() {
    return String(game.i18n?.lang ?? "en").toLowerCase().startsWith("ru") ? "ru" : "en";
  }

  _getAppearance() {
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

  _applyRootThemeAttributes() {
    if (!this.element) return;
    const { theme, accent } = this._getAppearance();
    this.element.dataset.theme = theme;
    this.element.dataset.accent = accent;
    const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    this.element.dataset.motion = reduced
      ? "off"
      : document.body?.classList?.contains("performance-low")
        ? "reduced"
        : "full";
  }

  _getBusyContext() {
    const pct = Math.max(0, Math.min(100, Math.round(Number(this._progressPercent) || 0)));
    const dashOffset = (BUSY_RING_CIRCUMFERENCE * (1 - pct / 100)).toFixed(2);
    return {
      busy: this._busy,
      progressPercent: pct,
      progressDashOffset: dashOffset,
      progressLabel: this._progressLabel,
      progressDetail: this._progressDetail,
      canCancel: Boolean(this._abortController),
      statusMessage: this._statusMessage
    };
  }

  _updateProgressDom(percent, label, detail = "") {
    this._progressPercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (label !== undefined && label !== null) this._progressLabel = String(label);
    if (detail !== undefined && detail !== null) this._progressDetail = String(detail);

    if (!this.element) return;
    if (this._busy) this.element.dataset.busy = "true";
    else delete this.element.dataset.busy;

    const overlay = this.element.querySelector("[data-waifu-progress]");
    const arc = this.element.querySelector("[data-waifu-busy-arc]");
    const text = this.element.querySelector("[data-waifu-progress-label]");
    const detailEl = this.element.querySelector("[data-waifu-progress-detail]");
    const pctText = this.element.querySelector("[data-waifu-progress-pct]");
    const cancelBtn = this.element.querySelector("[data-waifu-cancel-btn]");

    if (overlay) overlay.hidden = !this._busy;
    if (arc) {
      const offset = BUSY_RING_CIRCUMFERENCE * (1 - this._progressPercent / 100);
      arc.style.strokeDashoffset = offset.toFixed(2);
    }
    if (text) text.textContent = this._progressLabel;
    if (detailEl) {
      detailEl.textContent = this._progressDetail;
      detailEl.hidden = !this._progressDetail;
    }
    if (pctText) pctText.textContent = `${this._progressPercent}%`;
    if (cancelBtn) cancelBtn.hidden = !this._abortController;
  }

  async _runBusyTask({ label, detail = "", initialPercent = 5, cancellable = true }, fn) {
    if (this._busy) return null;
    this._busy = true;
    this._abortController = cancellable ? new AbortController() : null;
    const startPct = Math.max(0, Math.min(100, Math.round(initialPercent)));
    this._progressPercent = 0;
    this._progressLabel = label;
    this._progressDetail = detail;

    const overlay = this.element?.querySelector?.("[data-waifu-progress]") ?? null;
    const arc = this.element?.querySelector?.("[data-waifu-busy-arc]") ?? null;
    const hasLiveOverlay = Boolean(this.rendered && overlay);
    const hasBrowserRaf = typeof globalThis.requestAnimationFrame === "function";
    const startedAt = Date.now();

    if (hasLiveOverlay) {
      this._updateProgressDom(0, label, detail);
      resetBusyArcToZero(arc);
      if (hasBrowserRaf) {
        await yieldToUi();
      }
      this._updateProgressDom(startPct, label, detail);
    } else if (this.rendered) {
      this._progressPercent = startPct;
      await this.render({ force: false });
    } else {
      this._progressPercent = startPct;
    }

    const update = (percent, nextLabel = this._progressLabel, nextDetail = "") => {
      this._updateProgressDom(percent, nextLabel, nextDetail);
    };

    try {
      const result = await fn({
        signal: this._abortController?.signal ?? null,
        update
      });
      if (hasLiveOverlay && hasBrowserRaf && !this._abortController?.signal?.aborted) {
        if (this._progressPercent < 100) {
          this._updateProgressDom(100, this._progressLabel, this._progressDetail);
        }
        const elapsed = Date.now() - startedAt;
        if (elapsed < 140) {
          await new Promise((resolve) => setTimeout(resolve, 140 - elapsed));
        } else {
          await yieldToUi();
        }
      }
      return result;
    } finally {
      this._busy = false;
      this._abortController = null;
      this._progressPercent = 0;
      this._progressLabel = "";
      this._progressDetail = "";
      if (hasLiveOverlay) {
        resetBusyArcToZero(arc);
        this._updateProgressDom(0, "", "");
      } else if (this.rendered) {
        await this.render({ force: false });
      }
    }
  }

  static #onCancelOperation() {
    this._abortController?.abort();
  }

  _getDialogRoot(arg1, arg2) {
    return arg1?.element ?? arg2?.element ?? (arg1 instanceof HTMLElement ? arg1 : null);
  }

  async _openDialog(config = {}) {
    const { theme, accent } = this._getAppearance();
    const userRender = config.render;
    return DialogV2.wait({
      ...config,
      classes: ["waifu-root", "waifu-dialog", ...(config.classes ?? [])],
      render: (arg1, arg2) => {
        const root = this._getDialogRoot(arg1, arg2);
        if (root) {
          root.classList.add("waifu-root", "waifu-dialog");
          root.dataset.theme = theme;
          root.dataset.accent = accent;
        }
        userRender?.(arg1, arg2);
      }
    });
  }

  async _confirmAction(message, { withBackupOption = false, previewLines = [] } = {}) {
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
        this._t("WAIFU.Dialogs.DownloadBackupLabel")
      )}</label>`;
    }

    return this._openDialog({
      window: { title: this._t("WAIFU.Dialogs.ConfirmTitle") },
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

  _pickJsonFile() {
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

  _announceStatus(message) {
    this._statusMessage = message;
    const region = this.element?.querySelector("[data-waifu-status]");
    if (region) region.textContent = message;
  }
}
