import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const mod = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));

function resolveFoundryDataPath() {
  if (process.env.FOUNDRY_DATA_PATH) return process.env.FOUNDRY_DATA_PATH;
  const defaultBase = path.join(os.homedir(), "Library", "Application Support", "FoundryVTT");
  const optionsPath = path.join(defaultBase, "Config", "options.json");
  if (fs.existsSync(optionsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(optionsPath, "utf8"));
      if (parsed?.dataPath) return parsed.dataPath;
    } catch {
      // Fallback to defaultBase
    }
  }
  return defaultBase;
}

const dataPath = resolveFoundryDataPath();
const modulesDir = path.join(dataPath, "Data", "modules");
if (!fs.existsSync(modulesDir)) {
  throw new Error(`Foundry modules directory does not exist: ${modulesDir}`);
}

const targetDir = path.join(modulesDir, mod.id);
if (path.basename(targetDir) !== mod.id) {
  throw new Error(`Unexpected target path: ${targetDir}`);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });

const runtimeEntries = ["module.json", "README.md", "lang", "scripts", "styles", "templates"];
for (const entry of runtimeEntries) {
  const src = path.join(ROOT, entry);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(targetDir, entry), { recursive: true });
}

console.log(`Deployed ${mod.id} v${mod.version} to ${targetDir}`);
