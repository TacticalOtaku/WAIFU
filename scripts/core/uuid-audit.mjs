import { SEVERITY_ORDER } from "../constants.mjs";
import { diceSimilarity, normalizeForMatch } from "./utils.mjs";

const ENRICHER_REGEX = /@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g;
const HTML_DATA_UUID_REGEX = /<a\b[^>]*\bdata-uuid=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi;
const KNOWN_DOC_TYPES = new Set([
  "Actor",
  "ActiveEffect",
  "Adventure",
  "AmbientLight",
  "AmbientSound",
  "Card",
  "Cards",
  "ChatMessage",
  "Combat",
  "Combatant",
  "Drawing",
  "Folder",
  "Item",
  "JournalEntry",
  "JournalEntryPage",
  "Level",
  "Macro",
  "Note",
  "Playlist",
  "PlaylistSound",
  "Region",
  "RollTable",
  "Scene",
  "Setting",
  "TableResult",
  "Tile",
  "Token",
  "User",
  "Wall"
]);

const BARE_UUID_REGEX =
  /^(?:Compendium\.[^.\s]+\.[^.\s]+\.[A-Za-z]+(?:\.[^.\s]+)+|(?:Actor|ActiveEffect|Cards|Item|JournalEntry|JournalEntryPage|Macro|Playlist|RollTable|Scene)\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_.-]+)*)$/;

const UUID_KEY_HINT_REGEX = /(uuid|link|target|entry|page|actor|journal|loreframe|relat|connect|ref)/i;

/**
 * Parse a Foundry UUID string structurally without requiring runtime globals.
 * @param {string} rawUuid
 * @param {string | null} relativeParentUuid
 * @returns {{
 *   validSyntax: boolean,
 *   rawUuid: string,
 *   baseUuid: string,
 *   anchor: string,
 *   resolvedUuid: string,
 *   isRelative: boolean,
 *   isCompendium: boolean,
 *   packId: string | null,
 *   targetDocType: string | null,
 *   parentUuid: string | null
 * }}
 */
export function parseFoundryUuid(rawUuid, relativeParentUuid = null) {
  const trimmed = String(rawUuid ?? "").trim();
  const hashIdx = trimmed.indexOf("#");
  const baseUuid = (hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed).trim();
  const anchor = hashIdx >= 0 ? trimmed.slice(hashIdx + 1).trim() : "";

  if (!baseUuid || /\s/.test(baseUuid)) {
    return {
      validSyntax: false,
      rawUuid: trimmed,
      baseUuid,
      anchor,
      resolvedUuid: baseUuid,
      isRelative: false,
      isCompendium: false,
      packId: null,
      targetDocType: null,
      parentUuid: null
    };
  }

  const isRelative = baseUuid.startsWith(".");
  let resolvedUuid = baseUuid;
  if (isRelative) {
    if (!relativeParentUuid) {
      return {
        validSyntax: false,
        rawUuid: trimmed,
        baseUuid,
        anchor,
        resolvedUuid: baseUuid,
        isRelative: true,
        isCompendium: false,
        packId: null,
        targetDocType: null,
        parentUuid: null
      };
    }
    resolvedUuid = `${relativeParentUuid}${baseUuid}`;
  }

  const parts = resolvedUuid.split(".");
  if (parts.some((part) => !part)) {
    return {
      validSyntax: false,
      rawUuid: trimmed,
      baseUuid,
      anchor,
      resolvedUuid,
      isRelative,
      isCompendium: resolvedUuid.startsWith("Compendium."),
      packId: null,
      targetDocType: null,
      parentUuid: null
    };
  }

  if (parts[0] === "Compendium") {
    // Compendium.<scope>.<pack>.<DocType>.<id>[.<SubType>.<subId>...]
    // Legacy v10-style Compendium.<scope>.<pack>.<id> also has >= 4 parts
    if (parts.length < 4) {
      return {
        validSyntax: false,
        rawUuid: trimmed,
        baseUuid,
        anchor,
        resolvedUuid,
        isRelative,
        isCompendium: true,
        packId: parts.length >= 3 ? `${parts[1]}.${parts[2]}` : null,
        targetDocType: null,
        parentUuid: null
      };
    }
    const packId = `${parts[1]}.${parts[2]}`;
    const rest = parts.slice(3);
    const hasDocType = KNOWN_DOC_TYPES.has(rest[0]);
    let targetDocType = null;
    if (hasDocType && rest.length >= 2) {
      targetDocType = rest.length >= 4 && KNOWN_DOC_TYPES.has(rest[rest.length - 2])
        ? rest[rest.length - 2]
        : rest[0];
    }
    const parentUuid =
      rest.length >= 4 && hasDocType ? `Compendium.${packId}.${rest[0]}.${rest[1]}` : null;

    return {
      validSyntax: true,
      rawUuid: trimmed,
      baseUuid,
      anchor,
      resolvedUuid,
      isRelative,
      isCompendium: true,
      packId,
      targetDocType,
      parentUuid
    };
  }

  // World document UUID: <DocType>.<id>[.<SubType>.<subId>...]
  if (parts.length < 2 || parts.length % 2 !== 0 || !KNOWN_DOC_TYPES.has(parts[0])) {
    return {
      validSyntax: false,
      rawUuid: trimmed,
      baseUuid,
      anchor,
      resolvedUuid,
      isRelative,
      isCompendium: false,
      packId: null,
      targetDocType: KNOWN_DOC_TYPES.has(parts[0]) ? parts[0] : null,
      parentUuid: null
    };
  }

  for (let i = 0; i < parts.length; i += 2) {
    if (!KNOWN_DOC_TYPES.has(parts[i])) {
      return {
        validSyntax: false,
        rawUuid: trimmed,
        baseUuid,
        anchor,
        resolvedUuid,
        isRelative,
        isCompendium: false,
        packId: null,
        targetDocType: null,
        parentUuid: null
      };
    }
  }

  const targetDocType = parts[parts.length - 2];
  const parentUuid = parts.length >= 4 ? parts.slice(0, -2).join(".") : null;

  return {
    validSyntax: true,
    rawUuid: trimmed,
    baseUuid,
    anchor,
    resolvedUuid,
    isRelative,
    isCompendium: false,
    packId: null,
    targetDocType,
    parentUuid
  };
}

function stripTags(html) {
  return String(html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LOREFRAME_OPEN_REGEX = /<([a-z][a-z0-9-]*)\b[^>]*\bdata-loreframe-template=(["'])([^"']+)\2[^>]*>/gi;

/**
 * Find character spans `[start, end, templateId]` for all Loreframe blocks in an HTML string.
 * @param {string} html
 * @returns {Array<{ start: number, end: number, templateId: string }>}
 */
export function findLoreframeBlockSpans(html) {
  if (typeof html !== "string" || !html.includes("data-loreframe-template")) return [];
  const spans = [];
  LOREFRAME_OPEN_REGEX.lastIndex = 0;
  let match;

  while ((match = LOREFRAME_OPEN_REGEX.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    const templateId = match[3];
    const start = match.index;
    const tagMatcher = new RegExp(`<(\\/)?${tagName}\\b[^>]*>`, "gi");
    tagMatcher.lastIndex = LOREFRAME_OPEN_REGEX.lastIndex;

    let depth = 1;
    let end = html.length;
    let inner;
    while ((inner = tagMatcher.exec(html)) !== null) {
      if (inner[1]) {
        depth -= 1;
        if (depth === 0) {
          end = tagMatcher.lastIndex;
          break;
        }
      } else if (!inner[0].endsWith("/>")) {
        depth += 1;
      }
    }
    spans.push({ start, end, templateId });
  }

  return spans;
}

/**
 * Extract all @UUID, HTML data-uuid, and optional bare Foundry UUID references from a string value.
 * @param {string} text
 * @param {{ allowBareUuid?: boolean }} options
 * @returns {Array<{ syntax: string, rawMatch: string, rawUuid: string, label: string, index: number }>}
 */
export function extractUuidReferencesFromText(text, options = {}) {
  if (typeof text !== "string" || !text) return [];

  const refs = [];
  if (text.includes("@UUID[")) {
    ENRICHER_REGEX.lastIndex = 0;
    let match;
    while ((match = ENRICHER_REGEX.exec(text)) !== null) {
      refs.push({
        syntax: "enricher",
        rawMatch: match[0],
        rawUuid: match[1].trim(),
        label: (match[2] ?? "").trim(),
        index: match.index
      });
    }
  }

  if (text.includes("data-uuid")) {
    HTML_DATA_UUID_REGEX.lastIndex = 0;
    let match;
    while ((match = HTML_DATA_UUID_REGEX.exec(text)) !== null) {
      refs.push({
        syntax: "html-link",
        rawMatch: match[0],
        rawUuid: match[2].trim(),
        label: stripTags(match[3]),
        index: match.index
      });
    }
  }

  if (options.allowBareUuid && refs.length === 0) {
    const trimmed = text.trim();
    if (BARE_UUID_REGEX.test(trimmed)) {
      refs.push({
        syntax: "bare-uuid",
        rawMatch: text,
        rawUuid: trimmed,
        label: "",
        index: 0
      });
    }
  }

  return refs;
}

/**
 * Format path segments into a readable dot/bracket string for reports and UI.
 * @param {Array<string|number>} segments
 * @returns {string}
 */
export function formatFieldPath(segments) {
  let out = "";
  for (const seg of segments) {
    if (typeof seg === "number") {
      out += `[${seg}]`;
    } else if (!out) {
      out = seg;
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(seg)) {
      out += `.${seg}`;
    } else {
      out += `["${seg}"]`;
    }
  }
  return out;
}

/**
 * Recursively walk an arbitrary JSON-like value and invoke callback for every string leaf.
 * @param {unknown} value
 * @param {Array<string|number>} basePath
 * @param {(str: string, path: Array<string|number>, keyHint: boolean) => void} onString
 * @param {boolean} keyHint
 * @param {WeakSet<object>} seen
 */
function walkValueStrings(value, basePath, onString, keyHint = false, seen = new WeakSet()) {
  if (typeof value === "string") {
    onString(value, basePath, keyHint);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      walkValueStrings(value[i], [...basePath, i], onString, keyHint, seen);
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (basePath.length === 1 && basePath[0] === "flags" && key === "waifu") continue;
    const childHint = keyHint || UUID_KEY_HINT_REGEX.test(key);
    walkValueStrings(child, [...basePath, key], onString, childHint, seen);
  }
}

/**
 * Collect all UUID references across normalized JournalEntry and Actor trees.
 * @param {{ journals?: Array<Object>, actors?: Array<Object> }} worldDocs
 * @returns {Array<Object>}
 */
export function collectUuidOccurrences(worldDocs) {
  const occurrences = [];

  const scanTarget = ({
    rootDocType,
    rootDocId,
    rootDocName,
    rootUuid,
    targetDocType,
    targetDocId,
    targetDocName,
    targetUuid,
    relativeParentUuid,
    baseCategory,
    branches
  }) => {
    for (const [branchKey, branchValue] of branches) {
      if (branchValue === undefined || branchValue === null) continue;
      walkValueStrings(branchValue, [branchKey], (str, pathSegments, keyHint) => {
        const pathText = formatFieldPath(pathSegments);
        const isPathLoreframe = /loreframe/i.test(pathText);
        const isFlags = pathSegments[0] === "flags";
        const allowBareUuid =
          (isFlags || pathSegments[0] === "system") && (keyHint || isPathLoreframe);
        const refs = extractUuidReferencesFromText(str, { allowBareUuid });
        if (!refs.length) return;

        const loreframeSpans =
          pathText === "text.content" ? findLoreframeBlockSpans(str) : [];

        for (const ref of refs) {
          const blockSpan = loreframeSpans.find(
            (span) => ref.index >= span.start && ref.index < span.end
          );
          const isLoreframe = isPathLoreframe || Boolean(blockSpan);
          const sourceCategory =
            isLoreframe || (baseCategory === "journal" && isFlags)
              ? "loreframe"
              : baseCategory;
          const parsed = parseFoundryUuid(ref.rawUuid, relativeParentUuid);
          occurrences.push({
            id: `${targetUuid}::${pathText}::${ref.index}::${ref.rawUuid}`,
            rootDocType,
            rootDocId,
            rootDocName,
            rootUuid,
            targetDocType,
            targetDocId,
            targetDocName,
            targetUuid,
            fieldPath: pathText,
            pathSegments,
            sourceCategory,
            isLoreframe,
            loreframeTemplate: blockSpan?.templateId ?? null,
            syntax: ref.syntax,
            rawMatch: ref.rawMatch,
            rawUuid: ref.rawUuid,
            label: ref.label,
            ...parsed
          });
        }
      });
    }
  };

  for (const journal of worldDocs?.journals ?? []) {
    const jUuid = journal.uuid ?? `JournalEntry.${journal.id}`;
    scanTarget({
      rootDocType: "JournalEntry",
      rootDocId: journal.id,
      rootDocName: journal.name || journal.id,
      rootUuid: jUuid,
      targetDocType: "JournalEntry",
      targetDocId: journal.id,
      targetDocName: journal.name || journal.id,
      targetUuid: jUuid,
      relativeParentUuid: jUuid,
      baseCategory: "journal",
      branches: [["flags", journal.flags]]
    });

    for (const page of journal.pages ?? []) {
      const pUuid = page.uuid ?? `${jUuid}.JournalEntryPage.${page.id}`;
      scanTarget({
        rootDocType: "JournalEntry",
        rootDocId: journal.id,
        rootDocName: journal.name || journal.id,
        rootUuid: jUuid,
        targetDocType: "JournalEntryPage",
        targetDocId: page.id,
        targetDocName: page.name || page.id,
        targetUuid: pUuid,
        relativeParentUuid: jUuid,
        baseCategory: "journal",
        branches: [
          ["text", page.text],
          ["system", page.system],
          ["flags", page.flags]
        ]
      });
    }
  }

  for (const actor of worldDocs?.actors ?? []) {
    const aUuid = actor.uuid ?? `Actor.${actor.id}`;
    scanTarget({
      rootDocType: "Actor",
      rootDocId: actor.id,
      rootDocName: actor.name || actor.id,
      rootUuid: aUuid,
      targetDocType: "Actor",
      targetDocId: actor.id,
      targetDocName: actor.name || actor.id,
      targetUuid: aUuid,
      relativeParentUuid: aUuid,
      baseCategory: "actor",
      branches: [
        ["system", actor.system],
        ["flags", actor.flags]
      ]
    });

    for (const item of actor.items ?? []) {
      const iUuid = item.uuid ?? `${aUuid}.Item.${item.id}`;
      scanTarget({
        rootDocType: "Actor",
        rootDocId: actor.id,
        rootDocName: actor.name || actor.id,
        rootUuid: aUuid,
        targetDocType: "Item",
        targetDocId: item.id,
        targetDocName: item.name || item.id,
        targetUuid: iUuid,
        relativeParentUuid: aUuid,
        baseCategory: "actor",
        branches: [
          ["system", item.system],
          ["flags", item.flags]
        ]
      });
    }

    for (const effect of actor.effects ?? []) {
      const eUuid = effect.uuid ?? `${aUuid}.ActiveEffect.${effect.id}`;
      scanTarget({
        rootDocType: "Actor",
        rootDocId: actor.id,
        rootDocName: actor.name || actor.id,
        rootUuid: aUuid,
        targetDocType: "ActiveEffect",
        targetDocId: effect.id,
        targetDocName: effect.name || effect.id,
        targetUuid: eUuid,
        relativeParentUuid: aUuid,
        baseCategory: "actor",
        branches: [
          ["description", effect.description],
          ["flags", effect.flags]
        ]
      });
    }
  }

  return occurrences;
}

/**
 * Rank replacement candidates from a catalog of existing world & compendium documents.
 * @param {Object} brokenRef
 * @param {Array<{ uuid: string, name: string, docType: string, sourceLabel: string, isCompendium?: boolean }>} catalog
 * @param {number} limit
 * @returns {Array<{ uuid: string, name: string, docType: string, sourceLabel: string, score: number, confidence: string }>}
 */
export function findUuidCandidates(brokenRef, catalog = [], limit = 3) {
  const query = (brokenRef.label || brokenRef.anchor || "").trim();
  if (!query || !catalog.length) return [];

  const normQuery = normalizeForMatch(query);
  if (!normQuery) return [];

  const scored = [];
  for (const entry of catalog) {
    if (!entry?.uuid || !entry?.name) continue;
    if (
      brokenRef.targetDocType &&
      entry.docType &&
      entry.docType !== brokenRef.targetDocType
    ) {
      continue;
    }

    const normName = normalizeForMatch(entry.name);
    if (!normName) continue;

    let score = 0;
    if (normName === normQuery) {
      score = 1;
    } else if (normName.includes(normQuery) || normQuery.includes(normName)) {
      const ratio = Math.min(normName.length, normQuery.length) / Math.max(normName.length, normQuery.length);
      score = 0.72 + ratio * 0.22;
    } else {
      score = diceSimilarity(normQuery, normName);
    }

    if (score < 0.52) continue;

    // Slight preference for world docs over compendium entries on ties
    const tieAdjust = entry.isCompendium ? 0 : 0.01;
    const finalScore = Math.min(1, Number((score + (score < 1 ? tieAdjust : 0)).toFixed(3)));
    const confidence =
      normName === normQuery ? "exact" : finalScore >= 0.78 ? "high" : "medium";

    scored.push({
      uuid: entry.uuid,
      name: entry.name,
      docType: entry.docType,
      sourceLabel: entry.sourceLabel || (entry.isCompendium ? "Compendium" : "World"),
      score: finalScore,
      confidence
    });
  }

  return scored
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        Number(a.sourceLabel !== "World") - Number(b.sourceLabel !== "World") ||
        a.name.localeCompare(b.name)
    )
    .slice(0, limit);
}

/**
 * Audit collected UUID occurrences using an async document resolver and a candidate catalog.
 * @param {{ journals?: Array<Object>, actors?: Array<Object> }} worldDocs
 * @param {{
 *   resolveUuid: (uuid: string) => Promise<boolean>,
 *   hasPack?: (packId: string) => boolean,
 *   catalog?: Array<Object>
 * }} hooks
 * @returns {Promise<Object>}
 */
export async function auditUuidReferences(worldDocs, hooks) {
  const occurrences = collectUuidOccurrences(worldDocs);
  const resolveCache = new Map();
  const broken = [];

  for (const occ of occurrences) {
    if (!occ.validSyntax) {
      const candidates = findUuidCandidates(occ, hooks?.catalog);
      broken.push({
        ...occ,
        reason: "malformed",
        severity: "warning",
        candidates,
        bestCandidate: candidates[0] ?? null
      });
      continue;
    }

    if (occ.isCompendium && occ.packId && hooks?.hasPack && !hooks.hasPack(occ.packId)) {
      const candidates = findUuidCandidates(occ, hooks?.catalog);
      broken.push({
        ...occ,
        reason: "missing-pack",
        severity: "critical",
        candidates,
        bestCandidate: candidates[0] ?? null
      });
      continue;
    }

    let exists = resolveCache.get(occ.resolvedUuid);
    if (exists === undefined) {
      exists = Boolean(await hooks.resolveUuid(occ.resolvedUuid));
      resolveCache.set(occ.resolvedUuid, exists);
    }
    if (exists) continue;

    let reason = "missing-document";
    if (occ.parentUuid) {
      let parentExists = resolveCache.get(occ.parentUuid);
      if (parentExists === undefined) {
        parentExists = Boolean(await hooks.resolveUuid(occ.parentUuid));
        resolveCache.set(occ.parentUuid, parentExists);
      }
      if (parentExists) reason = "missing-embedded";
    }

    const candidates = findUuidCandidates(occ, hooks?.catalog);
    broken.push({
      ...occ,
      reason,
      severity: occ.sourceCategory === "loreframe" || occ.rootDocType === "JournalEntry" ? "critical" : "warning",
      candidates,
      bestCandidate: candidates[0] ?? null
    });
  }

  const sortedBroken = broken.toSorted(
    (a, b) =>
      SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
      a.rootDocName.localeCompare(b.rootDocName) ||
      a.rawUuid.localeCompare(b.rawUuid)
  );

  const exactMatchCount = sortedBroken.filter(
    (item) => item.bestCandidate?.confidence === "exact"
  ).length;

  return {
    totalScanned: occurrences.length,
    brokenCount: sortedBroken.length,
    journalCount: sortedBroken.filter((i) => i.sourceCategory === "journal").length,
    loreframeCount: sortedBroken.filter((i) => i.sourceCategory === "loreframe").length,
    actorCount: sortedBroken.filter((i) => i.sourceCategory === "actor").length,
    exactMatchCount,
    withCandidateCount: sortedBroken.filter((i) => Boolean(i.bestCandidate)).length,
    items: sortedBroken
  };
}

/**
 * Rewrite or unlink a specific broken reference inside a text string.
 * @param {string} text
 * @param {{ syntax: string, rawUuid: string, label?: string, rawMatch?: string }} ref
 * @param {{ mode: "replace" | "unlink", newUuid?: string }} action
 * @returns {string}
 */
export function patchStringUuidReference(text, ref, action) {
  if (typeof text !== "string") return text;

  if (ref.syntax === "bare-uuid") {
    if (text.trim() !== ref.rawUuid) return text;
    if (action.mode === "replace" && action.newUuid) return action.newUuid;
    return "";
  }

  if (ref.syntax === "enricher") {
    ENRICHER_REGEX.lastIndex = 0;
    return text.replace(ENRICHER_REGEX, (full, uuidInside, labelInside) => {
      if (uuidInside.trim() !== ref.rawUuid) return full;
      if (action.mode === "replace" && action.newUuid) {
        return labelInside !== undefined
          ? `@UUID[${action.newUuid}]{${labelInside}}`
          : `@UUID[${action.newUuid}]`;
      }
      if (action.mode === "unlink") {
        const cleanLabel = (labelInside ?? "").trim();
        return cleanLabel || uuidInside.trim();
      }
      return full;
    });
  }

  if (ref.syntax === "html-link") {
    HTML_DATA_UUID_REGEX.lastIndex = 0;
    return text.replace(HTML_DATA_UUID_REGEX, (full, quote, uuidAttr, innerHtml) => {
      if (uuidAttr.trim() !== ref.rawUuid) return full;
      if (action.mode === "replace" && action.newUuid) {
        return full.replace(
          `data-uuid=${quote}${uuidAttr}${quote}`,
          `data-uuid=${quote}${action.newUuid}${quote}`
        );
      }
      if (action.mode === "unlink") {
        const plain = stripTags(innerHtml);
        return plain || uuidAttr.trim();
      }
      return full;
    });
  }

  return text;
}

/**
 * Apply a reference patch to a cloned nested structure using exact path segments.
 * Handles dot-containing keys safely and removes empty bare-UUID array elements on unlink.
 * @param {unknown} rootValue
 * @param {Array<string|number>} pathSegments
 * @param {Object} ref
 * @param {{ mode: "replace" | "unlink", newUuid?: string }} action
 * @returns {unknown}
 */
export function applyPatchAtPath(rootValue, pathSegments, ref, action) {
  const cloned = structuredClone(rootValue);
  if (!pathSegments.length) return cloned;

  let cursor = cloned;
  for (let i = 0; i < pathSegments.length - 1; i += 1) {
    if (cursor == null || typeof cursor !== "object") return cloned;
    cursor = cursor[pathSegments[i]];
  }

  const leafKey = pathSegments[pathSegments.length - 1];
  if (cursor == null || typeof cursor !== "object") return cloned;

  const current = cursor[leafKey];
  if (typeof current !== "string") return cloned;

  if (ref.syntax === "bare-uuid" && action.mode === "unlink") {
    if (Array.isArray(cursor) && typeof leafKey === "number") {
      cursor.splice(leafKey, 1);
    } else {
      cursor[leafKey] = null;
    }
    return cloned;
  }

  cursor[leafKey] = patchStringUuidReference(current, ref, action);
  return cloned;
}
