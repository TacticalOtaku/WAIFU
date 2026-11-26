import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function readJson(relPath) {
  const fullPath = path.join(ROOT, relPath);
  const raw = fs.readFileSync(fullPath, "utf8");
  return JSON.parse(raw);
}

function collectLeafKeys(obj, prefix = "") {
  const keys = [];
  for (const [key, value] of Object.entries(obj ?? {})) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...collectLeafKeys(value, next));
    } else {
      keys.push(next);
    }
  }
  return keys;
}

function collectMjsFiles(dirRel) {
  const dirFull = path.join(ROOT, dirRel);
  if (!fs.existsSync(dirFull)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dirFull, { withFileTypes: true })) {
    const rel = path.join(dirRel, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMjsFiles(rel));
    } else if (entry.isFile() && entry.name.endsWith(".mjs")) {
      results.push(rel);
    }
  }
  return results;
}

const pkg = readJson("package.json");
const mod = readJson("module.json");

if (pkg.version !== mod.version) {
  throw new Error(`Version mismatch: package.json=${pkg.version} vs module.json=${mod.version}`);
}

for (const requiredDoc of ["LICENSE", "CHANGELOG.md", "README.md", "README.ru.md"]) {
  if (!fs.existsSync(path.join(ROOT, requiredDoc))) {
    throw new Error(`Missing required repository file: ${requiredDoc}`);
  }
}

for (const assetPath of [...(mod.esmodules ?? []), ...(mod.styles ?? [])]) {
  if (!fs.existsSync(path.join(ROOT, assetPath))) {
    throw new Error(`Missing manifest asset: ${assetPath}`);
  }
}

for (const lang of mod.languages ?? []) {
  if (!fs.existsSync(path.join(ROOT, lang.path))) {
    throw new Error(`Missing language file: ${lang.path}`);
  }
}

const enKeys = new Set(collectLeafKeys(readJson("lang/en.json")));
const ruKeys = new Set(collectLeafKeys(readJson("lang/ru.json")));

const missingInRu = [...enKeys].filter((k) => !ruKeys.has(k));
const missingInEn = [...ruKeys].filter((k) => !enKeys.has(k));
if (missingInRu.length || missingInEn.length) {
  throw new Error(
    `Localization key mismatch. Missing in ru: [${missingInRu.join(", ")}]; missing in en: [${missingInEn.join(", ")}]`
  );
}

const mjsFiles = [
  ...collectMjsFiles("scripts"),
  ...collectMjsFiles("tools"),
  ...collectMjsFiles("test")
];

for (const file of mjsFiles) {
  execFileSync(process.execPath, ["--check", path.join(ROOT, file)], { stdio: "inherit" });
}

console.log(
  `WAIFU static check passed (${mjsFiles.length} .mjs files, ${enKeys.size} i18n keys verified).`
);
