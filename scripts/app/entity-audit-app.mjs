/**
 * Standalone Drag-and-Drop Actors & Items JSON Audit Window.
 * Starts empty by default and inspects dropped Actors, Items, Folders, and Compendiums
 * for orphaned or inactive module flags and residual JSON strings.
 * @module app/entity-audit-app
 */

import { MODULE_ID } from "../constants.mjs";
import { WaifuBaseApp } from "./base-app.mjs";
import { EntityAuditController } from "./entity-audit-controller.mjs";

export class WaifuEntityAuditApp extends WaifuBaseApp {
  static DEFAULT_OPTIONS = {
    id: "waifu-entity-audit-window",
    classes: ["waifu-window", "waifu-root", "waifu-app", "waifu-entity-app"],
    tag: "div",
    window: {
      title: "WAIFU.EntityAudit.WindowTitle",
      icon: "fa-solid fa-boxes-stacked",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 820,
      height: 680
    },
    actions: {
      ...WaifuBaseApp.BASE_ACTIONS,
      ...EntityAuditController.ACTIONS,
      openWorldAudit: async function () {
        await game.modules?.get?.(MODULE_ID)?.api?.open?.();
      }
    }
  };

  static PARTS = {
    masthead: {
      template: `modules/${MODULE_ID}/templates/entity-masthead.hbs`
    },
    main: {
      template: `modules/${MODULE_ID}/templates/entity-main.hbs`
    }
  };

  /** @type {WaifuEntityAuditApp|null} */
  static #instance = null;

  static openWindow() {
    const existing =
      WaifuEntityAuditApp.#instance
      ?? foundry.applications?.instances?.get?.("waifu-entity-audit-window")
      ?? null;

    const app = existing ?? new WaifuEntityAuditApp();
    WaifuEntityAuditApp.#instance = app;
    app.render(true);
    return app;
  }

  constructor(options = {}) {
    super(options);
    this._entityAudit = new EntityAuditController(this, { showPopout: false });
  }

  async addDropData(dragData) {
    return this._entityAudit.handleDropData(dragData);
  }

  async addDocuments(docs, options = {}) {
    return this._entityAudit.addDocuments(docs, options);
  }

  clear() {
    return this._entityAudit.clear();
  }

  async _prepareContext(_options) {
    const appearance = this._getAppearance();
    return {
      ...this._getBusyContext(),
      theme: appearance.theme,
      accent: appearance.accent,
      statusMessage: "",
      entityAudit: this._entityAudit.prepareContext()
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._applyRootThemeAttributes();
    this._entityAudit.bindDom();
  }

  async close(options = {}) {
    if (WaifuEntityAuditApp.#instance === this) {
      WaifuEntityAuditApp.#instance = null;
    }
    return super.close(options);
  }
}
