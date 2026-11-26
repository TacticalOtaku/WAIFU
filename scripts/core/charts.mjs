import { escapeHtml, formatBytes } from "./utils.mjs";

const TONE_COLOR = Object.freeze({
  critical: "var(--hp)",
  warning: "var(--warn)",
  info: "var(--temp)",
  arcane: "var(--arcane)",
  ok: "var(--heal)",
  accent: "var(--accent)",
  muted: "var(--text-3)"
});

function resolveToneColor(tone) {
  return TONE_COLOR[tone] ?? TONE_COLOR.accent;
}

function truncateLabel(text, maxLen = 22) {
  const str = String(text ?? "").trim();
  if (str.length <= maxLen) return str;
  return `${str.slice(0, Math.max(1, maxLen - 1))}…`;
}

function clamp01(val) {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

/**
 * Render a 270-degree SVG radial health ring gauge with a non-overlapping status pill below the arc.
 * @param {number} score
 * @param {"healthy" | "warning" | "critical"} state
 * @param {{ ariaLabel?: string, stateLabel?: string, width?: number, height?: number }} options
 * @returns {string}
 */
export function renderHealthGaugeSvg(score, state = "healthy", options = {}) {
  const isIdle = score === null || score === undefined || state === "idle";
  const safeScore = isIdle ? 0 : Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  const width = Number(options.width) || 136;
  const height = Number(options.height) || 124;
  const cx = 70;
  const cy = 53;
  const r = 41;
  const circumference = 2 * Math.PI * r;
  const arcSpan = circumference * 0.75; // 270 degrees; bottom ends sit at y ≈ 86.5
  const filledSpan = (safeScore / 100) * arcSpan;

  const tone = isIdle
    ? "muted"
    : state === "critical"
      ? "critical"
      : state === "warning"
        ? "warning"
        : "ok";
  const color = resolveToneColor(tone);
  const ariaLabel = escapeHtml(
    options.ariaLabel || (isIdle ? "Audit pending" : `World Health ${safeScore}%`)
  );
  const stateLabel = escapeHtml(options.stateLabel || "");

  const statusPill = stateLabel
    ? [
        `<g class="waifu-gauge-pill">`,
        `<rect x="16" y="99" width="108" height="21" rx="10.5" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-opacity="0.45" stroke-width="1" />`,
        `<text x="70" y="113" text-anchor="middle" class="waifu-gauge-sub" fill="${color}">${stateLabel}</text>`,
        `</g>`
      ].join("")
    : "";

  const centerText = isIdle
    ? `<text x="${cx}" y="61" text-anchor="middle" class="waifu-gauge-num">—</text>`
    : `<text x="${cx}" y="61" text-anchor="middle" class="waifu-gauge-num">${safeScore}<tspan class="waifu-gauge-pct" dx="1.5">%</tspan></text>`;

  return [
    `<svg class="waifu-gauge-svg" viewBox="0 0 140 126" width="${width}" height="${height}" role="img" aria-label="${ariaLabel}">`,
    `<title>${ariaLabel}</title>`,
    `<g transform="rotate(135 ${cx} ${cy})">`,
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="9" stroke-dasharray="${arcSpan.toFixed(2)} ${circumference.toFixed(2)}" stroke-linecap="round" />`,
    !isIdle && safeScore > 0
      ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-dasharray="${filledSpan.toFixed(2)} ${circumference.toFixed(2)}" stroke-linecap="round" />`
      : "",
    `</g>`,
    centerText,
    statusPill,
    `</svg>`
  ].join("");
}

/**
 * Render an SVG donut chart paired with an accessible tabular legend.
 * @param {Array<{ label: string, value: number, displayValue?: string, tone: string }>} segments
 * @param {string | number} centerValue
 * @param {string} centerLabel
 * @param {{ ariaLabel?: string, emptyLabel?: string, size?: number }} options
 * @returns {string}
 */
export function renderDonutChartHtml(segments, centerValue, centerLabel, options = {}) {
  const clean = (segments ?? []).map((seg) => ({
    label: String(seg.label ?? ""),
    value: Math.max(0, Number(seg.value) || 0),
    displayValue: seg.displayValue ?? String(Math.max(0, Number(seg.value) || 0)),
    tone: seg.tone || "accent"
  }));
  const total = clean.reduce((sum, s) => sum + s.value, 0);
  const size = Number(options.size) || 124;
  const r = 44;
  const circumference = 2 * Math.PI * r;
  const activeSegments = clean.filter((s) => s.value > 0);
  const gap = activeSegments.length > 1 ? 2.4 : 0;

  let offset = 0;
  const arcs = [];
  if (total > 0) {
    for (const seg of activeSegments) {
      const share = seg.value / total;
      const rawLen = share * circumference;
      const drawLen = Math.max(1.5, rawLen - gap);
      const color = resolveToneColor(seg.tone);
      const pctStr = ((seg.value / total) * 100).toFixed(1);
      arcs.push(
        `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="12" stroke-dasharray="${drawLen.toFixed(2)} ${(circumference - drawLen).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"><title>${escapeHtml(seg.label)}: ${escapeHtml(seg.displayValue)} (${pctStr}%)</title></circle>`
      );
      offset += rawLen;
    }
  }

  const centerText = String(centerValue ?? "");
  const valClass =
    centerText.length > 5 ? "waifu-donut-val is-compact" : "waifu-donut-val";
  const ariaLabel = escapeHtml(
    options.ariaLabel || `${centerLabel}: ${centerText}`
  );

  const svg = [
    `<svg class="waifu-donut-svg" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="${ariaLabel}">`,
    `<title>${ariaLabel}</title>`,
    `<circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="12" />`,
    `<g transform="rotate(-90 60 60)">`,
    ...arcs,
    `</g>`,
    `<text x="60" y="57" text-anchor="middle" class="${valClass}">${escapeHtml(centerText)}</text>`,
    `<text x="60" y="74" text-anchor="middle" class="waifu-donut-sub">${escapeHtml(truncateLabel(centerLabel, 14))}</text>`,
    `</svg>`
  ].join("");

  const legendItems = clean
    .map((seg) => {
      const pct = total > 0 ? ((seg.value / total) * 100).toFixed(1) : "0.0";
      const color = resolveToneColor(seg.tone);
      return [
        `<li class="waifu-legend-row">`,
        `<span class="waifu-legend-swatch" style="background:${color}" aria-hidden="true"></span>`,
        `<span class="waifu-legend-label">${escapeHtml(seg.label)}</span>`,
        `<span class="waifu-legend-val">${escapeHtml(seg.displayValue)}</span>`,
        `<span class="waifu-legend-pct">${pct}%</span>`,
        `</li>`
      ].join("");
    })
    .join("");

  return `<div class="waifu-donut-wrap">${svg}<ul class="waifu-legend">${legendItems}</ul></div>`;
}

/**
 * Render an inline SVG horizontal ranked bar chart with optional threshold marker.
 * @param {Array<{ label: string, value: number, displayValue?: string, tone?: string, tooltip?: string }>} items
 * @param {{ maxValue?: number, threshold?: number, thresholdLabel?: string, ariaLabel?: string, emptyLabel?: string }} options
 * @returns {string}
 */
export function renderHorizontalBarChartSvg(items, options = {}) {
  const rows = (items ?? []).filter((item) => item && item.label != null);
  if (!rows.length) {
    return `<p class="waifu-chart-empty">${escapeHtml(options.emptyLabel || "—")}</p>`;
  }

  const width = 560;
  const rowH = 27;
  const topPad = options.thresholdLabel ? 20 : 6;
  const bottomPad = 6;
  const height = topPad + rows.length * rowH + bottomPad;

  const labelW = 156;
  const barX = labelW + 10;
  const barW = 228;
  const valX = barX + barW + 10;

  const dataMax = rows.reduce((m, r) => Math.max(m, Number(r.value) || 0), 0);
  const threshold = Number(options.threshold);
  const hasThreshold = Number.isFinite(threshold) && threshold > 0;
  const maxVal = Math.max(
    Number(options.maxValue) || 0,
    dataMax,
    hasThreshold ? threshold * 1.12 : 0,
    1
  );

  const ariaLabel = escapeHtml(options.ariaLabel || "Distribution chart");
  const svgRows = rows.map((row, idx) => {
    const y = topPad + idx * rowH;
    const val = Math.max(0, Number(row.value) || 0);
    const fillW = val > 0 ? Math.max(3, clamp01(val / maxVal) * barW) : 0;
    const color = resolveToneColor(row.tone || "accent");
    const display = truncateLabel(row.displayValue ?? String(val), 24);
    const tip = row.tooltip ? `${row.label} — ${row.tooltip}` : `${row.label}: ${row.displayValue ?? val}`;

    return [
      `<g class="waifu-hbar-row">`,
      `<title>${escapeHtml(tip)}</title>`,
      `<text x="${labelW}" y="${y + 14}" text-anchor="end" class="waifu-hbar-label">${escapeHtml(truncateLabel(row.label, 21))}</text>`,
      `<rect x="${barX}" y="${y + 4}" width="${barW}" height="12" rx="4" fill="var(--surface-3)" />`,
      fillW > 0
        ? `<rect x="${barX}" y="${y + 4}" width="${fillW.toFixed(1)}" height="12" rx="4" fill="${color}" />`
        : "",
      `<text x="${valX}" y="${y + 14}" text-anchor="start" class="waifu-hbar-val">${escapeHtml(display)}</text>`,
      `</g>`
    ].join("");
  });

  let thresholdSvg = "";
  if (hasThreshold) {
    const ratio = clamp01(threshold / maxVal);
    const tx = barX + ratio * barW;
    const anchor = ratio < 0.18 ? "start" : ratio > 0.82 ? "end" : "middle";
    thresholdSvg = [
      `<line x1="${tx.toFixed(1)}" y1="${topPad - 4}" x2="${tx.toFixed(1)}" y2="${height - 4}" stroke="var(--text-3)" stroke-width="1.2" stroke-dasharray="3 3" />`,
      options.thresholdLabel
        ? `<text x="${tx.toFixed(1)}" y="12" text-anchor="${anchor}" class="waifu-hbar-limit">${escapeHtml(options.thresholdLabel)}</text>`
        : ""
    ].join("");
  }

  return [
    `<svg class="waifu-hbar-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${ariaLabel}">`,
    `<title>${ariaLabel}</title>`,
    ...svgRows,
    thresholdSvg,
    `</svg>`
  ].join("");
}

/**
 * Render an SVG stacked horizontal severity matrix across audited domains.
 * @param {Array<{ label: string, critical: number, warning: number, info: number, ok: number, total: number }>} rows
 * @param {{ ariaLabel?: string, legend?: { critical: string, warning: string, info: string, ok: string } }} options
 * @returns {string}
 */
export function renderDomainMatrixChartHtml(rows, options = {}) {
  const items = rows ?? [];
  const width = 540;
  const rowH = 28;
  const topPad = 6;
  const height = topPad + items.length * rowH + 6;
  const labelW = 136;
  const barX = labelW + 10;
  const barW = 284;
  const valX = barX + barW + 10;

  const ariaLabel = escapeHtml(options.ariaLabel || "Domain Severity Matrix");
  const legendLabels = options.legend ?? {
    critical: "Critical",
    warning: "Warning",
    info: "Info",
    ok: "Healthy"
  };

  const svgRows = items.map((row, idx) => {
    const y = topPad + idx * rowH;
    const total = Math.max(0, Number(row.total) || 0);
    const parts = [
      { key: "critical", val: Number(row.critical) || 0, color: resolveToneColor("critical") },
      { key: "warning", val: Number(row.warning) || 0, color: resolveToneColor("warning") },
      { key: "info", val: Number(row.info) || 0, color: resolveToneColor("info") },
      { key: "ok", val: Number(row.ok) || 0, color: resolveToneColor("ok") }
    ];

    let cursorX = barX;
    const rects = [];
    if (total > 0) {
      for (const part of parts) {
        if (part.val <= 0) continue;
        const remaining = Math.max(0, barX + barW - cursorX);
        if (remaining <= 0) break;
        const rawW = (part.val / total) * barW;
        const segW = Math.min(remaining, Math.max(2, rawW));
        rects.push(
          `<rect x="${cursorX.toFixed(1)}" y="${y + 5}" width="${segW.toFixed(1)}" height="12" rx="2" fill="${part.color}"><title>${escapeHtml(row.label)} • ${escapeHtml(legendLabels[part.key] ?? part.key)}: ${part.val}/${total}</title></rect>`
        );
        cursorX += rawW;
      }
    }

    const issues = (Number(row.critical) || 0) + (Number(row.warning) || 0);
    const summaryText =
      total === 0 ? "0" : issues > 0 ? `${issues} / ${total}` : `OK (${total})`;

    return [
      `<g>`,
      `<text x="${labelW}" y="${y + 15}" text-anchor="end" class="waifu-hbar-label">${escapeHtml(truncateLabel(row.label, 18))}</text>`,
      `<rect x="${barX}" y="${y + 5}" width="${barW}" height="12" rx="4" fill="var(--surface-3)" />`,
      ...rects,
      `<text x="${valX}" y="${y + 15}" text-anchor="start" class="waifu-hbar-val">${escapeHtml(summaryText)}</text>`,
      `</g>`
    ].join("");
  });

  const svg = [
    `<svg class="waifu-hbar-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${ariaLabel}">`,
    `<title>${ariaLabel}</title>`,
    ...svgRows,
    `</svg>`
  ].join("");

  const legend = ["critical", "warning", "info", "ok"]
    .map((key) => {
      const color = resolveToneColor(key);
      return `<span class="waifu-seg-pill"><i style="background:${color}" aria-hidden="true"></i>${escapeHtml(legendLabels[key] ?? key)}</span>`;
    })
    .join("");

  return `<div class="waifu-matrix-wrap">${svg}<div class="waifu-seg-legend">${legend}</div></div>`;
}

/**
 * Render a compact proportional stacked HTML bar + legend pills for domain analytics strips.
 * @param {Array<{ label: string, value: number, displayValue?: string, tone: string }>} segments
 * @param {{ ariaLabel?: string }} options
 * @returns {string}
 */
export function renderStackedBarHtml(segments, options = {}) {
  const clean = (segments ?? []).map((seg) => ({
    label: String(seg.label ?? ""),
    value: Math.max(0, Number(seg.value) || 0),
    displayValue: seg.displayValue ?? String(Math.max(0, Number(seg.value) || 0)),
    tone: seg.tone || "accent"
  }));
  const total = clean.reduce((sum, s) => sum + s.value, 0);
  const ariaLabel = escapeHtml(options.ariaLabel || "Breakdown");

  const barSegments =
    total > 0
      ? clean
          .filter((s) => s.value > 0)
          .map((s) => {
            const pct = ((s.value / total) * 100).toFixed(2);
            const color = resolveToneColor(s.tone);
            return `<span class="waifu-seg-fill" style="width:${pct}%;background:${color}" title="${escapeHtml(s.label)}: ${escapeHtml(s.displayValue)} (${Number(pct).toFixed(1)}%)"></span>`;
          })
          .join("")
      : `<span class="waifu-seg-fill is-empty" style="width:100%"></span>`;

  const pills = clean
    .map((s) => {
      const pct = total > 0 ? ((s.value / total) * 100).toFixed(0) : "0";
      const color = resolveToneColor(s.tone);
      return `<span class="waifu-seg-pill"><i style="background:${color}" aria-hidden="true"></i><b>${escapeHtml(s.displayValue)}</b> ${escapeHtml(s.label)} <small>(${pct}%)</small></span>`;
    })
    .join("");

  return [
    `<div class="waifu-segbar-block">`,
    `<div class="waifu-segbar" role="img" aria-label="${ariaLabel}">${barSegments}</div>`,
    `<div class="waifu-seg-legend">${pills}</div>`,
    `</div>`
  ].join("");
}

/**
 * Build localized chart labels object for charts shared between UI and HTML report export.
 * @param {"ru" | "en"} lang
 * @returns {Object}
 */
export function getChartLabels(lang = "en") {
  const ru = String(lang).toLowerCase().startsWith("ru");
  if (ru) {
    return {
      healthStates: { healthy: "НОРМА", warning: "ВНИМАНИЕ", critical: "КРИТИЧНО" },
      severity: { critical: "Критично", warning: "Предупр.", info: "Инфо", ok: "Норма" },
      domains: {
        scenes: "Сцены",
        assets: "Текстуры",
        uuids: "Ссылки @UUID",
        settings: "World Settings",
        flags: "Флаги док-тов"
      },
      formats: {
        webp: "WebP (опт.)",
        png: "PNG (тяжёлые)",
        otherRaster: "JPG/Проч. растр",
        video: "Видео (WebM/MP4)",
        assetsUnit: "текстур"
      },
      uuids: {
        valid: "Валидные ссылки",
        exact: "Точная замена",
        fuzzy: "Кандидат (похож.)",
        unmatched: "Без замены",
        refsUnit: "ссылок",
        journals: "Журналы",
        loreframe: "Loreframe / Флаги",
        actors: "Актёры и предметы"
      },
      storage: {
        core: "Ядро / Система",
        active: "Активные модули",
        inactive: "Отключённые",
        orphaned: "Удалённые (сироты)",
        reclaimable: "Можно очистить",
        retained: "Активные данные",
        bytesUnit: "Всего в БД"
      },
      emptyScenes: "Проблемных сцен не обнаружено.",
      emptyStorage: "Нет данных о занимаемом объёме.",
      emptyUuids: "Ссылки @UUID не обнаружены.",
      noBrokenUuids: "Битых ссылок @UUID не найдено.",
      thresholdRes: "Порог"
    };
  }

  return {
    healthStates: { healthy: "HEALTHY", warning: "ATTENTION", critical: "CRITICAL" },
    severity: { critical: "Critical", warning: "Warning", info: "Info", ok: "Healthy" },
    domains: {
      scenes: "Scenes",
      assets: "Assets",
      uuids: "@UUID Links",
      settings: "World Settings",
      flags: "Document Flags"
    },
    formats: {
      webp: "WebP (opt.)",
      png: "PNG (heavy)",
      otherRaster: "JPG / Raster",
      video: "Video",
      assetsUnit: "assets"
    },
    uuids: {
      valid: "Valid Links",
      exact: "Exact Match",
      fuzzy: "Fuzzy Candidate",
      unmatched: "No Match",
      refsUnit: "refs",
      journals: "Journals",
      loreframe: "Loreframe / Flags",
      actors: "Actors & Items"
    },
    storage: {
      core: "Core / System",
      active: "Active Modules",
      inactive: "Disabled",
      orphaned: "Deleted (Orphaned)",
      reclaimable: "Reclaimable",
      retained: "Active Data",
      bytesUnit: "Tracked"
    },
    emptyScenes: "No scenes available to chart.",
    emptyStorage: "No storage payload data.",
    emptyUuids: "No @UUID references scanned.",
    noBrokenUuids: "No broken @UUID references found.",
    thresholdRes: "Limit"
  };
}

/**
 * Render a compact multi-segment bar without legend (for tight telemetry headers).
 * @param {Array<{ label: string, value: number, displayValue?: string, tone: string }>} segments
 * @param {{ ariaLabel?: string, totalMax?: number }} options
 * @returns {string}
 */
export function renderCompactBarHtml(segments, options = {}) {
  const clean = (segments ?? []).map((seg) => ({
    label: String(seg.label ?? ""),
    value: Math.max(0, Number(seg.value) || 0),
    displayValue: seg.displayValue ?? String(Math.max(0, Number(seg.value) || 0)),
    tone: seg.tone || "accent"
  }));
  const sum = clean.reduce((acc, s) => acc + s.value, 0);
  const scaleTotal = Math.max(Number(options.totalMax) || 0, sum, 1);
  const ariaLabel = escapeHtml(options.ariaLabel || "Breakdown");

  const fills =
    sum > 0
      ? clean
          .filter((s) => s.value > 0)
          .map((s) => {
            const pct = Math.max(2, (s.value / scaleTotal) * 100).toFixed(2);
            const color = resolveToneColor(s.tone);
            return `<span class="waifu-seg-fill" style="width:${pct}%;background:${color}" title="${escapeHtml(s.label)}: ${escapeHtml(s.displayValue)}"></span>`;
          })
          .join("")
      : `<span class="waifu-seg-fill is-empty" style="width:100%"></span>`;

  return `<div class="waifu-segbar" role="img" aria-label="${ariaLabel}">${fills}</div>`;
}

/**
 * Render a compact sparkline SVG for the Hub Window 1 telemetry card.
 * @param {Array<{ generatedAt?: string, healthScore: number }>} history
 * @param {number} fallbackScore
 * @param {{ ariaLabel?: string }} options
 * @returns {string}
 */
export function renderCompactSparklineSvg(history = [], fallbackScore = 100, options = {}) {
  const entries = (history ?? []).filter((e) => Number.isFinite(Number(e?.healthScore)));
  const pointsSource =
    entries.length >= 2
      ? entries.slice(-8)
      : [
          { healthScore: Number.isFinite(Number(fallbackScore)) ? Number(fallbackScore) : 100 },
          { healthScore: Number.isFinite(Number(fallbackScore)) ? Number(fallbackScore) : 100 }
        ];

  const width = 380;
  const height = 42;
  const padX = 10;
  const padY = 9;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const scores = pointsSource.map((e) => Math.max(0, Math.min(100, Number(e.healthScore))));
  const minS = Math.max(0, Math.min(...scores) - 8);
  const maxS = Math.min(100, Math.max(...scores, minS + 10));
  const span = Math.max(10, maxS - minS);

  const coords = pointsSource.map((entry, idx) => {
    const x = padX + (pointsSource.length === 1 ? plotW / 2 : (idx / (pointsSource.length - 1)) * plotW);
    const ratio = (Math.max(0, Math.min(100, Number(entry.healthScore))) - minS) / span;
    const y = padY + (1 - ratio) * plotH;
    return { x, y, score: Math.round(Number(entry.healthScore)) };
  });

  const polylinePts = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  const lastTone = last.score < 60 ? "critical" : last.score < 85 ? "warning" : "ok";
  const dotColor = resolveToneColor(lastTone);
  const lineColor = resolveToneColor("ok");

  const dots = coords
    .map((c, idx) => {
      const isLast = idx === coords.length - 1;
      return `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${isLast ? 4 : 3}" fill="${isLast ? dotColor : lineColor}" />`;
    })
    .join("");

  const ariaLabel = escapeHtml(options.ariaLabel || "Health Sparkline");
  return [
    `<svg class="waifu-spark-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${ariaLabel}">`,
    `<title>${ariaLabel}</title>`,
    `<line x1="${padX}" y1="${(height / 2).toFixed(1)}" x2="${padX + plotW}" y2="${(height / 2).toFixed(1)}" stroke="var(--line)" stroke-width="1" />`,
    `<polyline points="${polylinePts}" fill="none" stroke="${lineColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />`,
    dots,
    `</svg>`
  ].join("");
}

/**
 * Render an inline SVG health score trend sparkline across audit history entries.
 * @param {Array<{ generatedAt: string, healthScore: number, totalIssues?: number }>} history
 * @param {{ ariaLabel?: string, emptyLabel?: string }} options
 * @returns {string}
 */
export function renderHealthTrendSvg(history = [], options = {}) {
  const entries = (history ?? []).filter((e) => Number.isFinite(Number(e?.healthScore)));
  if (entries.length < 2) {
    return `<p class="waifu-chart-empty">${escapeHtml(options.emptyLabel || "—")}</p>`;
  }

  const width = 540;
  const height = 112;
  const padX = 28;
  const padTop = 18;
  const padBottom = 22;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;

  const scores = entries.map((e) => Math.max(0, Math.min(100, Number(e.healthScore))));
  const minS = Math.max(0, Math.min(...scores) - 10);
  const maxS = Math.min(100, Math.max(...scores, minS + 10));
  const span = Math.max(10, maxS - minS);

  const coords = entries.map((entry, idx) => {
    const x = padX + (entries.length === 1 ? plotW / 2 : (idx / (entries.length - 1)) * plotW);
    const ratio = (Math.max(0, Math.min(100, Number(entry.healthScore))) - minS) / span;
    const y = padTop + (1 - ratio) * plotH;
    return { x, y, entry };
  });

  const polylinePts = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const areaPts = `${padX},${padTop + plotH} ${polylinePts} ${(padX + plotW).toFixed(1)},${padTop + plotH}`;
  const last = coords[coords.length - 1];
  const lastScore = Math.round(Number(last.entry.healthScore));
  const tone = lastScore < 60 ? "critical" : lastScore < 85 ? "warning" : "ok";
  const strokeColor = resolveToneColor(tone);
  const lineColor = resolveToneColor("ok");

  const gridLines = [0.25, 0.6].map((frac) => {
    const gy = (padTop + plotH * frac).toFixed(1);
    return `<line x1="${padX}" y1="${gy}" x2="${padX + plotW}" y2="${gy}" stroke="var(--line)" stroke-width="1" />`;
  }).join("");

  const dots = coords
    .map((c, idx) => {
      const dateStr = String(c.entry.generatedAt ?? "").slice(0, 16).replace("T", " ");
      const tip = `${dateStr}: ${Math.round(c.entry.healthScore)}%`;
      const isLast = idx === coords.length - 1;
      const isEnd = isLast || idx === 0;
      const dotFill = isLast ? strokeColor : lineColor;
      return [
        `<g>`,
        `<title>${escapeHtml(tip)}</title>`,
        `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${isEnd ? 4.2 : 3.2}" fill="${dotFill}" stroke="var(--surface-1)" stroke-width="1.5" />`,
        isEnd
          ? `<text x="${c.x.toFixed(1)}" y="${Math.max(12, c.y - 7).toFixed(1)}" text-anchor="${idx === 0 ? "start" : "end"}" class="waifu-hbar-val">${Math.round(c.entry.healthScore)}%</text>`
          : "",
        `</g>`
      ].join("");
    })
    .join("");

  const ariaLabel = escapeHtml(options.ariaLabel || "World Health Score Trend");
  const startStamp = String(entries[0].generatedAt ?? "").slice(5, 16).replace("T", " ");
  const endStamp = String(entries[entries.length - 1].generatedAt ?? "").slice(5, 16).replace("T", " ");

  return [
    `<svg class="waifu-hbar-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${ariaLabel}">`,
    `<title>${ariaLabel}</title>`,
    gridLines,
    `<line x1="${padX}" y1="${padTop + plotH}" x2="${padX + plotW}" y2="${padTop + plotH}" stroke="var(--line-strong)" stroke-width="1" />`,
    `<polygon points="${areaPts}" fill="${lineColor}" fill-opacity="0.11" />`,
    `<polyline points="${polylinePts}" fill="none" stroke="${lineColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />`,
    dots,
    `<text x="${padX}" y="${height - 4}" text-anchor="start" class="waifu-hbar-limit">${escapeHtml(startStamp)}</text>`,
    `<text x="${padX + plotW}" y="${height - 4}" text-anchor="end" class="waifu-hbar-limit">${escapeHtml(endStamp)}</text>`,
    `</svg>`
  ].join("");
}

/**
 * Render the complete set of analytical SVG/HTML charts for a given audit report and statistics.
 * @param {Object} report
 * @param {Object} stats
 * @param {"ru" | "en"} lang
 * @returns {Object}
 */
export function buildReportCharts(report, stats, lang = "en") {
  const L = getChartLabels(lang);
  const summary = report?.summary ?? {};
  const thresholds = report?.thresholds ?? {};
  const { sceneStats, uuidStats, storageStats, domainMatrix, scoreBreakdown } = stats;

  // 1. Sidebar / Masthead Health Gauge
  const hasRealScore = Boolean(report?.generatedAt);
  const healthGaugeSvg = renderHealthGaugeSvg(
    hasRealScore ? (summary.healthScore ?? 100) : null,
    hasRealScore ? (summary.healthState ?? "healthy") : "idle",
    {
      stateLabel: hasRealScore
        ? L.healthStates[summary.healthState ?? "healthy"]
        : lang === "ru"
          ? "ОЖИДАНИЕ"
          : "PENDING",
      ariaLabel: hasRealScore ? `${summary.healthScore ?? 100}%` : "Pending audit"
    }
  );

  // 2. Domain Severity Matrix
  const domainMatrixHtml = renderDomainMatrixChartHtml(
    domainMatrix.map((row) => ({
      ...row,
      label: L.domains[row.id] ?? row.id
    })),
    { legend: L.severity }
  );

  // 3. Score Deductions Stacked Bar
  const penaltyColors = {
    scenes: "critical",
    media: "warning",
    uuids: "arcane",
    settings: "info",
    flags: "accent"
  };
  const penaltySegments = scoreBreakdown.categories
    .filter((c) => c.penalty > 0)
    .map((c) => ({
      label: L.domains[c.id] ?? c.id,
      value: c.penalty,
      displayValue: `-${c.penalty}`,
      tone: penaltyColors[c.id] ?? "warning"
    }));
  const penaltyBarHtml = penaltySegments.length
    ? renderStackedBarHtml(penaltySegments, { ariaLabel: "Score penalties" })
    : "";
  const penaltyCompactBarHtml = renderCompactBarHtml(penaltySegments, {
    totalMax: 100,
    ariaLabel: "Score penalties"
  });

  // 4. Texture Format Donut + Stacked Bar
  const formatSegments = [
    { label: L.formats.webp, value: sceneStats.assetFormats.webp, tone: "ok" },
    { label: L.formats.png, value: sceneStats.assetFormats.png, tone: "critical" },
    { label: L.formats.otherRaster, value: sceneStats.assetFormats.otherRaster, tone: "warning" },
    { label: L.formats.video, value: sceneStats.assetFormats.video, tone: "info" }
  ];
  const assetFormatDonutHtml = renderDonutChartHtml(
    formatSegments,
    sceneStats.assetFormats.totalAssets,
    L.formats.assetsUnit,
    { emptyLabel: L.emptyScenes }
  );
  const assetFormatBarHtml = renderStackedBarHtml(formatSegments, {
    ariaLabel: L.domains.assets
  });
  const assetFormatCompactBarHtml = renderCompactBarHtml(formatSegments, {
    ariaLabel: L.domains.assets
  });

  // 5. Top Heavy Scenes Horizontal Bars (Heaviness Score & Resolution)
  const heavySceneBarsSvg = renderHorizontalBarChartSvg(
    sceneStats.topHeavyScenes.slice(0, 6).map((s) => ({
      label: s.name,
      value: s.heavinessScore,
      displayValue:
        s.width > 0 ? `${s.heavinessScore} (${s.megapixels} MP)` : `${s.heavinessScore}`,
      tone: s.severity === "critical" ? "critical" : s.severity === "warning" ? "warning" : "ok",
      tooltip: `${s.width}×${s.height}, ${s.wallsCount} walls, ${s.lightsCount} lights, ${s.animationsCount} anims`
    })),
    { emptyLabel: L.emptyScenes }
  );

  // 6. Scene Resolution (Megapixels) Bars with Threshold line
  const sceneResolutionBarsSvg = renderHorizontalBarChartSvg(
    sceneStats.topHeavyScenes
      .filter((s) => s.megapixels > 0)
      .slice(0, 6)
      .map((s) => ({
        label: s.name,
        value: s.megapixels,
        displayValue: `${s.megapixels} MP • ${s.width}×${s.height}`,
        tone:
          s.megapixels > (thresholds.maxMegapixels || 18)
            ? "critical"
            : s.pngCount > 0
              ? "warning"
              : "ok"
      })),
    {
      threshold: thresholds.maxMegapixels || 18,
      thresholdLabel: `${L.thresholdRes}: ${thresholds.maxMegapixels || 18} MP`,
      emptyLabel: L.emptyScenes
    }
  );

  // 7. @UUID Integrity Donut + Bar
  const uuidHealthSegments = [
    { label: L.uuids.valid, value: uuidStats.validCount, tone: "ok" },
    { label: L.uuids.exact, value: uuidStats.byFixability.exact, tone: "info" },
    { label: L.uuids.fuzzy, value: uuidStats.byFixability.fuzzy, tone: "warning" },
    { label: L.uuids.unmatched, value: uuidStats.byFixability.unmatched, tone: "critical" }
  ];
  const uuidDonutHtml = renderDonutChartHtml(
    uuidHealthSegments,
    `${uuidStats.validPercent}%`,
    L.uuids.refsUnit,
    { emptyLabel: L.emptyUuids }
  );
  const uuidBarHtml = renderStackedBarHtml(uuidHealthSegments, {
    ariaLabel: L.domains.uuids
  });
  const uuidCompactBarHtml = renderCompactBarHtml(uuidHealthSegments, {
    ariaLabel: L.domains.uuids
  });

  // 8. Top Offending @UUID Source Documents
  const uuidTopDocsSvg = renderHorizontalBarChartSvg(
    uuidStats.topOffendingDocs.slice(0, 6).map((d) => ({
      label: d.rootDocName,
      value: d.count,
      displayValue: d.exactCount > 0 ? `${d.count} (${d.exactCount} exact)` : String(d.count),
      tone: d.criticalCount > 0 ? "critical" : "warning"
    })),
    { emptyLabel: uuidStats.totalScanned > 0 ? L.noBrokenUuids : L.emptyUuids }
  );

  // 9. Storage Allocation Donut & Stacked Bar (by Module State across Settings)
  const stateTone = {
    core: "info",
    active: "ok",
    inactive: "warning",
    orphaned: "critical"
  };
  const storageStateSegments = storageStats.settingsByState.map((st) => ({
    label: L.storage[st.state] ?? st.state,
    value: st.bytes,
    displayValue: st.formattedSize,
    tone: stateTone[st.state] ?? "accent"
  }));
  const storageDonutHtml = renderDonutChartHtml(
    storageStateSegments,
    storageStats.formattedSettingsSize,
    L.domains.settings,
    { emptyLabel: L.emptyStorage }
  );
  const storageStateBarHtml = renderStackedBarHtml(
    [
      {
        label: L.storage.retained,
        value: Math.max(0, storageStats.totalTrackedBytes - storageStats.totalReclaimableBytes),
        displayValue: formatBytes(
          Math.max(0, storageStats.totalTrackedBytes - storageStats.totalReclaimableBytes)
        ),
        tone: "ok"
      },
      {
        label: L.storage.reclaimable,
        value: storageStats.totalReclaimableBytes,
        displayValue: storageStats.formattedReclaimableTotal,
        tone: "critical"
      }
    ],
    { ariaLabel: L.storage.reclaimable }
  );

  const storageCompactSegments = storageStats.settingsByState.map((st) => ({
    label: L.storage[st.state] ?? st.state,
    value: st.bytes,
    displayValue: st.formattedSize,
    tone: stateTone[st.state] ?? "accent"
  }));
  if (storageStats.totalFlagsBytes > 0 && storageStats.reclaimableFlagsBytes > 0) {
    storageCompactSegments[3].value += storageStats.reclaimableFlagsBytes;
  }
  const storageCompactBarHtml = renderCompactBarHtml(storageCompactSegments, {
    ariaLabel: L.domains.settings
  });

  // 10. Top Namespaces Horizontal Bars
  const topNamespacesSvg = renderHorizontalBarChartSvg(
    storageStats.topNamespaces.slice(0, 7).map((ns) => ({
      label: ns.namespace,
      value: ns.totalBytes,
      displayValue: `${ns.formattedSize} (${ns.sharePercent}%)`,
      tone: stateTone[ns.moduleState] ?? "accent"
    })),
    { emptyLabel: L.emptyStorage }
  );

  // 11. Optional Audit History Sparkline + Hub micro-sparkline
  const healthTrendSvg =
    Array.isArray(report?.history) && report.history.length >= 2
      ? renderHealthTrendSvg(report.history, {
          ariaLabel: lang === "ru" ? "Динамика индекса здоровья" : "Health Score Trend"
        })
      : "";
  const healthSparklineSvg = renderCompactSparklineSvg(
    report?.history ?? [],
    summary.healthScore ?? 100,
    { ariaLabel: lang === "ru" ? "Динамика индекса здоровья" : "Health Score Trend" }
  );

  return {
    healthGaugeSvg,
    domainMatrixHtml,
    penaltyBarHtml,
    penaltyCompactBarHtml,
    assetFormatDonutHtml,
    assetFormatBarHtml,
    assetFormatCompactBarHtml,
    heavySceneBarsSvg,
    sceneResolutionBarsSvg,
    uuidDonutHtml,
    uuidBarHtml,
    uuidCompactBarHtml,
    uuidTopDocsSvg,
    storageDonutHtml,
    storageStateBarHtml,
    storageCompactBarHtml,
    topNamespacesSvg,
    healthTrendSvg,
    healthSparklineSvg
  };
}
