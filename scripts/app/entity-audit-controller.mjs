/**
 * Shared controller powering the Actors & Items drag-and-drop JSON audit view
 * in both the main WaifuAuditApp panel and the standalone WaifuEntityAuditApp window.
 * @module app/entity-audit-controller
 */

import { cleanEntityFindingsBatch } from "../foundry/auto-fixer.mjs";
import { auditEntityDocuments, collectFolderDocuments } from "../foundry/world-audit-runner.mjs";
import { auditEntityBatch, reconcileCleanedEntityFindings } from "../core/entity-audit.mjs";
import { escapeHtml } from "../core/utils.mjs";
import { yieldToUi } from "./base-app.mjs";

const SUPPORTED_DOC_TYPES = new Set(["Actor", "Item"]);

function getDocTypeIcon(docType) {
  if (docType === "Actor") return "fa-user";
  if (docType === "Item") return "fa-suitcase";
  if (docType === "Folder") return "fa-folder-open";
  if (docType === "Compendium") return "fa-book-atlas";
  return "fa-cube";
}

function getKindBadgeLabel(finding, t) {
  switch (finding.kind) {
    case "flag":
      return t("WAIFU.EntityAudit.KindFlag");
    case "prototype-flag":
      return t("WAIFU.EntityAudit.KindPrototypeFlag");
    case "effect-change":
      return t("WAIFU.EntityAudit.KindEffectChange");
    case "uuid-string":
      return t("WAIFU.EntityAudit.KindUuidString");
    case "module-path":
      return t("WAIFU.EntityAudit.KindModulePath");
    default:
      return t("WAIFU.EntityAudit.KindModuleString");
  }
}

function extractDragPayload(event) {
  const TextEditorImpl =
    foundry?.applications?.ux?.TextEditor?.implementation
    ?? globalThis.TextEditor;
  if (typeof TextEditorImpl?.getDragEventData === "function") {
    try {
      const parsed = TextEditorImpl.getDragEventData(event);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        return parsed;
      }
    } catch {
      // Fallback to raw dataTransfer JSON parsing below
    }
  }

  const raw = event?.dataTransfer?.getData?.("text/plain");
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    const trimmed = raw.trim();
    if (trimmed.includes(".")) return { uuid: trimmed };
    return null;
  }
}

function formatInspectPayload(finding) {
  const value = finding.matchedValue !== undefined
    ? finding.matchedValue
    : (finding.fullValue !== undefined ? finding.fullValue : finding.preview);
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

export class EntityAuditController {
  static ACTIONS = {
    rescanEntities: async function () {
      await this._entityAudit?.rescan();
    },
    clearEntityAudit: function () {
      this._entityAudit?.clear();
    },
    removeEntityTarget: async function (_event, target) {
      await this._entityAudit?.removeTarget(target?.dataset?.targetKey);
    },
    setEntityFilter: function (_event, target) {
      this._entityAudit?.setFilterTag(target?.dataset?.entityTag || "all");
    },
    clearEntitySelection: function () {
      this._entityAudit?.clearSelection();
    },
    inspectEntityFinding: async function (_event, target) {
      await this._entityAudit?.inspectFinding(target?.dataset?.findingId);
    },
    cleanSingleEntityFinding: async function (_event, target) {
      await this._entityAudit?.cleanSingleFinding(target?.dataset?.findingId);
    },
    cleanSelectedEntityFindings: async function () {
      await this._entityAudit?.cleanSelectedFindings();
    },
    cleanAllOrphanEntityFindings: async function () {
      await this._entityAudit?.cleanAllOrphaned();
    },
    openEntityDocument: async function (_event, target) {
      await this._entityAudit?.openDocumentSheet(target?.dataset?.uuid);
    }
  };

  /**
   * @param {import('./base-app.mjs').WaifuBaseApp} app
   * @param {Object} [options]
   * @param {() => HTMLElement|null} [options.getContainer]
   * @param {boolean} [options.showPopout=false]
   * @param {() => void} [options.onChange]
   */
  constructor(app, options = {}) {
    this.app = app;
    this.getContainer = options.getContainer || (() => this.app.element ?? null);
    this.showPopout = Boolean(options.showPopout);
    this.onChange = typeof options.onChange === "function" ? options.onChange : null;

    this._targets = new Map();
    this._report = null;
    this._filters = { query: "", tag: "all" };
    this._selection = new Set();
    this._lastCheckedIndex = null;
  }

  get hasTargets() {
    return this._targets.size > 0;
  }

  get report() {
    return this._report;
  }

  _t(key, params) {
    return this.app._t(key, params);
  }

  async _notifyUpdated({ render = true } = {}) {
    if (this.onChange) this.onChange();
    if (render && this.app.rendered) {
      await this.app.render({ parts: ["masthead", "main"] });
    }
  }

  _collectDedupedEntries() {
    const entries = [];
    const seen = new Set();
    let idx = 0;

    for (const target of this._targets.values()) {
      for (const doc of target.docs || []) {
        const docKey = doc?.uuid || doc?._id || doc?.id || `${target.key}#${idx++}`;
        if (seen.has(docKey)) continue;
        seen.add(docKey);
        entries.push({ doc, sourceLabel: target.name });
      }
    }

    return entries;
  }

  _pruneSelection() {
    const valid = new Set(
      (this._report?.findings || [])
        .filter((f) => f.canClean)
        .map((f) => f.id)
    );
    for (const id of Array.from(this._selection)) {
      if (!valid.has(id)) this._selection.delete(id);
    }
  }

  async _resolveTargetDocs(targetMeta) {
    if (targetMeta.kind === "compendium") {
      const pack = game?.packs?.get?.(targetMeta.collection);
      if (!pack) {
        throw new Error(this._t("WAIFU.EntityAudit.TargetMissing", { name: targetMeta.name }));
      }
      targetMeta.isLocked = Boolean(pack.locked);
      const docs = await pack.getDocuments();
      return Array.isArray(docs) ? docs : Array.from(docs || []);
    }

    if (targetMeta.kind === "folder") {
      const folder = await globalThis.fromUuid?.(targetMeta.uuid);
      if (!folder) {
        throw new Error(this._t("WAIFU.EntityAudit.TargetMissing", { name: targetMeta.name }));
      }
      return collectFolderDocuments(folder);
    }

    const doc = await globalThis.fromUuid?.(targetMeta.uuid);
    if (!doc) {
      throw new Error(this._t("WAIFU.EntityAudit.TargetMissing", { name: targetMeta.name }));
    }
    targetMeta.isLocked = Boolean(doc.pack && game?.packs?.get?.(doc.pack)?.locked);
    return [doc];
  }

  async _runAuditOnLoadedEntries(labelKey = "WAIFU.Progress.ScanningEntities", { resolveFromSource = false } = {}) {
    if (this._targets.size === 0) {
      this._report = null;
      this._selection.clear();
      this._lastCheckedIndex = null;
      await this._notifyUpdated();
      return null;
    }

    const report = await this.app._runBusyTask(
      {
        label: this._t(labelKey),
        detail: this._t("WAIFU.Progress.PreparingQueue"),
        initialPercent: 5,
        cancellable: true
      },
      async ({ signal, update }) => {
        if (resolveFromSource) {
          const targets = Array.from(this._targets.values());
          for (let i = 0; i < targets.length; i++) {
            if (signal.aborted) break;
            const target = targets[i];
            const pct = Math.round(((i + 1) / Math.max(targets.length, 1)) * 35);
            update(pct, this._t("WAIFU.Progress.LoadingEntities"), target.name);
            try {
              target.docs = await this._resolveTargetDocs(target);
              target.count = target.docs.length;
            } catch (err) {
              ui.notifications?.warn?.(err?.message || String(err));
            }
            await yieldToUi();
          }
        }

        if (signal.aborted) return null;

        const entries = this._collectDedupedEntries();
        if (entries.length === 0) {
          return auditEntityBatch([], { modules: [], activeModuleIds: [] });
        }

        const startPct = resolveFromSource ? 38 : 10;
        const result = await auditEntityDocuments(entries, {
          signal,
          onProgress: ({ current, total, doc, name, docType }) => {
            const frac = total > 0 ? current / total : 1;
            const pct = Math.round(startPct + frac * (98 - startPct));
            const labelType = doc?.documentName || docType || "";
            const labelName = doc?.name || name || "";
            update(
              pct,
              this._t(labelKey),
              `${labelType} ${labelName} (${current}/${total})`.trim()
            );
          }
        });

        update(100, this._t("WAIFU.Progress.Finalizing"), `${entries.length}`);
        return result;
      }
    );

    if (report) {
      this._report = report;
      this._pruneSelection();
      await this._notifyUpdated();
    }
    return report;
  }

  /**
   * Programmatically add already-resolved documents (useful for macros and unit tests).
   * @param {Array<Object>} docs
   * @param {Object} [options]
   */
  async addDocuments(docs = [], options = {}) {
    const validDocs = (Array.isArray(docs) ? docs : [docs]).filter(
      (doc) => doc && SUPPORTED_DOC_TYPES.has(doc.documentName || doc.docType)
    );
    if (validDocs.length === 0) {
      ui.notifications?.warn?.(this._t("WAIFU.EntityAudit.UnsupportedDrop"));
      return null;
    }

    const label = options.sourceLabel
      || (validDocs.length === 1 ? validDocs[0].name : `${validDocs.length} items`);
    const docType = options.docType
      || (validDocs.length === 1 ? (validDocs[0].documentName || validDocs[0].docType) : "Folder");
    const targetKey = options.targetKey
      || (validDocs.length === 1
        ? `doc:${validDocs[0].uuid || validDocs[0]._id || validDocs[0].id || label}`
        : `batch:${label}`);

    this._targets.set(targetKey, {
      key: targetKey,
      kind: options.kind || (validDocs.length === 1 ? "document" : "folder"),
      name: label,
      docType,
      uuid: options.uuid || (validDocs.length === 1 ? validDocs[0].uuid : null),
      collection: options.collection || null,
      count: validDocs.length,
      isLocked: Boolean(options.isLocked),
      isCompendium: Boolean(options.isCompendium),
      docs: validDocs
    });

    return this._runAuditOnLoadedEntries("WAIFU.Progress.ScanningEntities", { resolveFromSource: false });
  }

  /**
   * Handle Foundry drag-drop JSON payload.
   * @param {Object} dragData
   */
  async handleDropData(dragData) {
    if (!dragData || typeof dragData !== "object") {
      ui.notifications?.warn?.(this._t("WAIFU.EntityAudit.UnsupportedDrop"));
      return null;
    }

    let resolvedTarget = null;
    const busyResult = await this.app._runBusyTask(
      {
        label: this._t("WAIFU.Progress.LoadingEntities"),
        detail: String(dragData.collection || dragData.uuid || dragData.type || ""),
        initialPercent: 10,
        cancellable: true
      },
      async ({ signal, update }) => {
        if (dragData.type === "Compendium" || (dragData.collection && !dragData.uuid)) {
          const collectionId = dragData.collection || dragData.pack || dragData.id;
          const pack = game?.packs?.get?.(collectionId);
          if (!pack || !SUPPORTED_DOC_TYPES.has(pack.documentName)) {
            return { unsupported: true };
          }
          const packTitle = pack.metadata?.label || pack.title || pack.collection;
          update(25, this._t("WAIFU.Progress.LoadingEntities"), packTitle);
          const docsRaw = await pack.getDocuments();
          if (signal.aborted) return { aborted: true };
          const docs = Array.isArray(docsRaw) ? docsRaw : Array.from(docsRaw || []);
          resolvedTarget = {
            key: `compendium:${pack.collection}`,
            kind: "compendium",
            name: packTitle,
            docType: "Compendium",
            uuid: null,
            collection: pack.collection,
            count: docs.length,
            isLocked: Boolean(pack.locked),
            isCompendium: true,
            docs
          };
          return { docs };
        }

        const uuid = dragData.uuid;
        if (!uuid) {
          return { unsupported: true };
        }

        const doc = await globalThis.fromUuid?.(uuid);
        if (signal.aborted) return { aborted: true };
        if (!doc) {
          return { missing: uuid };
        }

        if (doc.documentName === "Folder") {
          if (!SUPPORTED_DOC_TYPES.has(doc.type)) {
            return { unsupported: true };
          }
          update(25, this._t("WAIFU.Progress.LoadingEntities"), doc.name || doc.uuid);
          const docs = collectFolderDocuments(doc);
          if (signal.aborted) return { aborted: true };
          resolvedTarget = {
            key: `folder:${doc.uuid || doc.id}`,
            kind: "folder",
            name: doc.name || "Folder",
            docType: "Folder",
            folderType: doc.type,
            uuid: doc.uuid || null,
            collection: null,
            count: docs.length,
            isLocked: false,
            isCompendium: false,
            docs
          };
          return { docs };
        }

        if (SUPPORTED_DOC_TYPES.has(doc.documentName)) {
          const isLocked = Boolean(doc.pack && game?.packs?.get?.(doc.pack)?.locked);
          resolvedTarget = {
            key: `doc:${doc.uuid || doc.id}`,
            kind: "document",
            name: doc.name || doc.uuid || doc.id,
            docType: doc.documentName,
            uuid: doc.uuid || null,
            collection: doc.pack || null,
            count: 1,
            isLocked,
            isCompendium: Boolean(doc.pack),
            docs: [doc]
          };
          return { docs: [doc] };
        }

        return { unsupported: true };
      }
    );

    if (!busyResult || busyResult.aborted) return null;
    if (busyResult.unsupported) {
      ui.notifications?.warn?.(this._t("WAIFU.EntityAudit.UnsupportedDrop"));
      return null;
    }
    if (busyResult.missing) {
      ui.notifications?.warn?.(this._t("WAIFU.EntityAudit.TargetMissing", { name: busyResult.missing }));
      return null;
    }

    if (!resolvedTarget) return null;
    if (resolvedTarget.docs.length === 0) {
      ui.notifications?.warn?.(this._t("WAIFU.EntityAudit.EmptyDrop", { name: resolvedTarget.name }));
      return null;
    }

    this._targets.set(resolvedTarget.key, resolvedTarget);
    const report = await this._runAuditOnLoadedEntries("WAIFU.Progress.ScanningEntities", { resolveFromSource: false });
    this.app._announceStatus(
      this._t("WAIFU.EntityAudit.ScannedNotice", {
        targets: resolvedTarget.docs.length,
        findings: report?.findingsCount ?? 0
      })
    );
    return report;
  }

  async rescan() {
    if (this._targets.size === 0) return null;
    return this._runAuditOnLoadedEntries("WAIFU.Progress.ScanningEntities", { resolveFromSource: true });
  }

  clear() {
    this._targets.clear();
    this._report = null;
    this._selection.clear();
    this._lastCheckedIndex = null;
    this._filters = { query: "", tag: "all" };
    return this._notifyUpdated();
  }

  async removeTarget(targetKey) {
    if (!targetKey || !this._targets.has(targetKey)) return;
    this._targets.delete(targetKey);
    await this._runAuditOnLoadedEntries("WAIFU.Progress.ScanningEntities", { resolveFromSource: false });
  }

  setFilterTag(tag) {
    this._filters.tag = tag || "all";
    this._lastCheckedIndex = null;
    this._applyClientFilterAndRenderRows();
  }

  clearSelection() {
    this._selection.clear();
    this._lastCheckedIndex = null;
    this._syncSelectionUi();
  }

  _getFilteredFindings() {
    const all = this._report?.findings || [];
    const q = (this._filters.query || "").trim().toLowerCase();
    const tag = this._filters.tag || "all";

    return all.filter((f) => {
      if (tag === "orphaned" && !f.isOrphaned) return false;
      if (tag === "inactive" && !f.isInactive) return false;
      if (tag === "flag" && f.category !== "flag") return false;
      if (tag === "string" && f.category !== "string") return false;
      if (tag === "cleanable" && !f.canClean) return false;

      if (q) {
        const hay = `${f.rootName} ${f.targetName} ${f.namespace} ${f.fieldPath} ${f.preview} ${f.sourceLabel}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  _applyClientFilterAndRenderRows() {
    const container = this.getContainer();
    if (!container) return;

    const tagButtons = container.querySelectorAll("[data-action='setEntityFilter']");
    tagButtons.forEach((btn) => {
      const active = (btn.dataset.entityTag || "all") === this._filters.tag;
      btn.classList.toggle("is-active", active);
    });

    const filteredIds = new Set(this._getFilteredFindings().map((f) => f.id));
    const rows = container.querySelectorAll("tbody tr[data-finding-id]");
    let visibleCount = 0;

    rows.forEach((row) => {
      const match = filteredIds.has(row.dataset.findingId);
      row.hidden = !match;
      if (match) visibleCount++;
    });

    const emptyFilteredEl = container.querySelector("[data-entity-empty-filtered]");
    if (emptyFilteredEl) {
      emptyFilteredEl.hidden = !(this._report?.findings?.length > 0 && visibleCount === 0);
    }

    this._syncSelectionUi();
  }

  _syncSelectionUi() {
    const container = this.getContainer();
    if (!container) return;

    const visibleRows = Array.from(container.querySelectorAll("tbody tr[data-finding-id]"))
      .filter((row) => !row.hidden);

    let visibleCheckable = 0;
    let visibleChecked = 0;

    for (const row of visibleRows) {
      const cb = row.querySelector("input[data-entity-check]");
      if (!cb || cb.disabled) continue;
      visibleCheckable++;
      const checked = this._selection.has(cb.dataset.findingId);
      cb.checked = checked;
      row.classList.toggle("is-selected", checked);
      if (checked) visibleChecked++;
    }

    const selectAll = container.querySelector("input[data-entity-check-all]");
    if (selectAll) {
      selectAll.disabled = visibleCheckable === 0;
      selectAll.checked = visibleCheckable > 0 && visibleChecked === visibleCheckable;
      selectAll.indeterminate = visibleChecked > 0 && visibleChecked < visibleCheckable;
    }

    const count = this._selection.size;
    const bar = container.querySelector("[data-entity-selection-bar]");
    if (bar) {
      bar.hidden = count === 0;
      const countEl = bar.querySelector("[data-entity-selection-count]");
      if (countEl) {
        countEl.textContent = this._t("WAIFU.Selection.Count", { count });
      }
    }
  }

  async inspectFinding(findingId) {
    const finding = (this._report?.findings || []).find((f) => f.id === findingId);
    if (!finding) return;

    const payload = formatInspectPayload(finding);
    const stateLabel = finding.isOrphaned
      ? this._t("WAIFU.Storage.Status.orphaned")
      : this._t("WAIFU.Storage.Status.inactive");

    await this.app._openDialog({
      window: { title: this._t("WAIFU.EntityAudit.InspectTitle") },
      content: `
        <div class="waifu-inspect-modal">
          <div class="waifu-inspect-meta">
            <div><strong>${escapeHtml(this._t("WAIFU.EntityAudit.ColTarget"))}:</strong> ${escapeHtml(finding.rootName)} (${escapeHtml(finding.targetName)})</div>
            <div><strong>${escapeHtml(this._t("WAIFU.EntityAudit.ColNamespace"))}:</strong> <code>${escapeHtml(finding.namespace)}</code> · ${escapeHtml(stateLabel)}</div>
            <div><strong>${escapeHtml(this._t("WAIFU.EntityAudit.ColPath"))}:</strong> <code>${escapeHtml(finding.fieldPath)}</code> (${escapeHtml(finding.formattedSize)})</div>
          </div>
          <pre class="waifu-code-preview">${escapeHtml(payload)}</pre>
        </div>
      `,
      buttons: [
        {
          action: "close",
          label: this._t("Close") === "Close" ? "OK" : this._t("Close"),
          default: true
        }
      ]
    });
  }

  async _executeCleanup(findings, confirmMessage) {
    const cleanable = (findings || []).filter((f) => f?.canClean);
    if (cleanable.length === 0) return;

    const previewLines = cleanable.slice(0, 6).map(
      (f) => `${f.targetName || f.rootName} · ${f.fieldPath}`
    );

    const res = await this.app._confirmAction(confirmMessage, { previewLines });
    if (!res?.confirmed) return;

    const result = await this.app._runBusyTask(
      {
        label: this._t("WAIFU.Progress.CleaningEntities"),
        detail: `${cleanable[0].targetName || cleanable[0].rootName} · ${cleanable[0].fieldPath}`,
        initialPercent: 5,
        cancellable: true
      },
      async ({ signal, update }) => {
        const res = await cleanEntityFindingsBatch(cleanable, {
          signal,
          onProgress: ({ current, total, finding }) => {
            const pct = total > 0 ? Math.round((current / total) * 100) : 100;
            const detail = finding
              ? `${finding.targetName || finding.rootName} · ${finding.fieldPath} (${current}/${total})`
              : `${current}/${total}`;
            update(pct, this._t("WAIFU.Progress.CleaningEntities"), detail);
          }
        });
        update(100, this._t("WAIFU.Progress.Finalizing"), `${res.cleanedIds.length}/${cleanable.length}`);
        return res;
      }
    );

    const cleanedIds = result?.cleanedIds || [];
    if (cleanedIds.length > 0 && this._report) {
      this._report = reconcileCleanedEntityFindings(this._report, cleanedIds);
      for (const id of cleanedIds) this._selection.delete(id);
      this._pruneSelection();
      await this._notifyUpdated();

      ui.notifications?.info?.(
        this._t("WAIFU.EntityAudit.CleanDone", { count: cleanedIds.length })
      );
      this.app._announceStatus(
        this._t("WAIFU.EntityAudit.CleanDone", { count: cleanedIds.length })
      );
    }

    if (result?.errors?.length) {
      ui.notifications?.warn?.(result.errors[0]);
    }
  }

  async cleanSingleFinding(findingId) {
    const finding = (this._report?.findings || []).find((f) => f.id === findingId);
    if (!finding) return;
    if (!finding.canClean) {
      ui.notifications?.warn?.(this._t("WAIFU.EntityAudit.LockedWarning"));
      return;
    }

    await this._executeCleanup(
      [finding],
      this._t("WAIFU.EntityAudit.ConfirmCleanOne", {
        target: finding.targetName || finding.rootName,
        path: finding.fieldPath
      })
    );
  }

  async cleanSelectedFindings() {
    const findings = (this._report?.findings || []).filter(
      (f) => this._selection.has(f.id) && f.canClean
    );
    if (findings.length === 0) return;

    await this._executeCleanup(
      findings,
      this._t("WAIFU.EntityAudit.ConfirmCleanMany", { count: findings.length })
    );
  }

  async cleanAllOrphaned() {
    const findings = (this._report?.findings || []).filter(
      (f) => f.isOrphaned && f.canClean
    );
    if (findings.length === 0) {
      ui.notifications?.info?.(this._t("WAIFU.EntityAudit.NoOrphansToClean"));
      return;
    }

    await this._executeCleanup(
      findings,
      this._t("WAIFU.EntityAudit.ConfirmCleanOrphans", { count: findings.length })
    );
  }

  async openDocumentSheet(uuid) {
    if (!uuid) return;
    const doc = await globalThis.fromUuid?.(uuid);
    doc?.sheet?.render?.(true);
  }

  prepareContext() {
    const targets = Array.from(this._targets.values()).map((t) => ({
      key: t.key,
      name: t.name,
      docType: t.docType,
      icon: getDocTypeIcon(t.docType),
      count: t.count,
      isLocked: t.isLocked,
      isCompendium: t.isCompendium
    }));

    const report = this._report;
    const tag = this._filters.tag || "all";
    const q = this._filters.query || "";
    const filteredFindings = this._getFilteredFindings();
    const filteredSet = new Set(filteredFindings.map((f) => f.id));

    const findings = (report?.findings || []).map((f) => ({
      ...f,
      kindLabel: getKindBadgeLabel(f, (k, p) => this._t(k, p)),
      isEmbedded: f.targetUuid !== f.rootUuid,
      isSelected: this._selection.has(f.id),
      isHiddenByFilter: !filteredSet.has(f.id),
      statusLabel: f.isOrphaned
        ? this._t("WAIFU.Storage.Status.orphaned")
        : this._t("WAIFU.Storage.Status.inactive")
    }));

    const hasLockedTargets = targets.some((t) => t.isLocked);
    const cleanableOrphanCount = (report?.findings || []).filter(
      (f) => f.isOrphaned && f.canClean
    ).length;

    return {
      showPopout: this.showPopout,
      hasTargets: targets.length > 0,
      hasFindings: (report?.findingsCount ?? 0) > 0,
      hasLockedTargets,
      targets,
      targetsCount: report?.targetsCount ?? targets.reduce((sum, t) => sum + (t.count || 0), 0),
      actorsCount: report?.actorsCount ?? 0,
      itemsCount: report?.itemsCount ?? 0,
      embeddedScannedCount: report?.embeddedScannedCount ?? 0,
      findingsCount: report?.findingsCount ?? 0,
      orphanedCount: report?.orphanedCount ?? 0,
      inactiveCount: report?.inactiveCount ?? 0,
      flagsCount: report?.flagsCount ?? 0,
      stringsCount: report?.stringsCount ?? 0,
      cleanableCount: report?.cleanableCount ?? 0,
      cleanableOrphanCount,
      formattedTotalSize: report?.formattedTotalSize ?? "0 B",
      byNamespace: report?.byNamespace ?? [],
      findings,
      selectedCount: this._selection.size,
      searchQuery: q,
      filterTag: tag,
      isFilterAll: tag === "all",
      isFilterOrphaned: tag === "orphaned",
      isFilterInactive: tag === "inactive",
      isFilterFlag: tag === "flag",
      isFilterString: tag === "string",
      isFilterCleanable: tag === "cleanable",
      isFilteredEmpty: (report?.findingsCount ?? 0) > 0 && filteredFindings.length === 0
    };
  }

  bindDom() {
    const container = this.getContainer();
    if (!container) return;

    const dropzones = container.querySelectorAll("[data-entity-dropzone]");
    dropzones.forEach((zone) => {
      if (zone.dataset.waifuBound === "1") return;
      zone.dataset.waifuBound = "1";

      zone.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        zone.classList.add("is-dragover");
      });

      zone.addEventListener("dragleave", (event) => {
        if (event.relatedTarget && zone.contains(event.relatedTarget)) return;
        zone.classList.remove("is-dragover");
      });

      zone.addEventListener("drop", async (event) => {
        event.preventDefault();
        zone.classList.remove("is-dragover");
        const payload = extractDragPayload(event);
        await this.handleDropData(payload);
      });
    });

    const searchInput = container.querySelector("[data-entity-search]");
    if (searchInput && searchInput.dataset.waifuBound !== "1") {
      searchInput.dataset.waifuBound = "1";
      searchInput.addEventListener("input", () => {
        this._filters.query = searchInput.value || "";
        this._lastCheckedIndex = null;
        this._applyClientFilterAndRenderRows();
      });
    }

    const selectAll = container.querySelector("input[data-entity-check-all]");
    if (selectAll && selectAll.dataset.waifuBound !== "1") {
      selectAll.dataset.waifuBound = "1";
      selectAll.addEventListener("change", () => {
        const visibleCheckboxes = Array.from(
          container.querySelectorAll("tbody tr[data-finding-id]")
        )
          .filter((row) => !row.hidden)
          .map((row) => row.querySelector("input[data-entity-check]"))
          .filter((cb) => cb && !cb.disabled);

        if (selectAll.checked) {
          for (const cb of visibleCheckboxes) this._selection.add(cb.dataset.findingId);
        } else {
          for (const cb of visibleCheckboxes) this._selection.delete(cb.dataset.findingId);
        }
        this._syncSelectionUi();
      });
    }

    const checkboxes = Array.from(container.querySelectorAll("input[data-entity-check]"));
    checkboxes.forEach((cb, index) => {
      if (cb.dataset.waifuBound === "1") return;
      cb.dataset.waifuBound = "1";

      cb.addEventListener("click", (event) => {
        if (cb.disabled) return;
        const id = cb.dataset.findingId;
        if (!id) return;

        if (event.shiftKey && this._lastCheckedIndex !== null && this._lastCheckedIndex !== index) {
          const [start, end] = index > this._lastCheckedIndex
            ? [this._lastCheckedIndex, index]
            : [index, this._lastCheckedIndex];
          const shouldSelect = cb.checked;
          for (let i = start; i <= end; i++) {
            const targetCb = checkboxes[i];
            if (!targetCb || targetCb.disabled) continue;
            const row = targetCb.closest("tr");
            if (row?.hidden) continue;
            if (shouldSelect) this._selection.add(targetCb.dataset.findingId);
            else this._selection.delete(targetCb.dataset.findingId);
          }
        } else {
          if (cb.checked) this._selection.add(id);
          else this._selection.delete(id);
        }

        this._lastCheckedIndex = index;
        this._syncSelectionUi();
      });
    });

    this._syncSelectionUi();
  }
}
