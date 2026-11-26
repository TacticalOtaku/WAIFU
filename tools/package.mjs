import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const mod = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
const distDir = path.join(ROOT, "dist");
const zipName = `${mod.id}-v${mod.version}.zip`;
const zipPath = path.join(distDir, zipName);

fs.mkdirSync(distDir, { recursive: true });
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

const entriesToPack = [
  "module.json",
  "LICENSE",
  "README.md",
  "README.ru.md",
  "CHANGELOG.md",
  "assets",
  "lang",
  "scripts",
  "styles",
  "templates"
].filter((entry) => fs.existsSync(path.join(ROOT, entry)));

execFileSync("zip", ["-r", zipPath, ...entriesToPack], { cwd: ROOT, stdio: "inherit" });
fs.copyFileSync(path.join(ROOT, "module.json"), path.join(distDir, "module.json"));

console.log(`Built release archive: dist/${zipName}`);
