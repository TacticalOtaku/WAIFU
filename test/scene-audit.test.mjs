import assert from "node:assert/strict";
import test from "node:test";
import { analyzeScene, auditScenes, findRedundantWalls } from "../scripts/core/scene-audit.mjs";
import { suggestWebpTarget } from "../scripts/core/utils.mjs";

test("analyzeScene inspects v14 levels, tiles, walls, lights, and animations accurately", () => {
  const scene = {
    id: "scene-1",
    name: "Castle Keep",
    active: true,
    width: 4096,
    height: 4096,
    backgroundSrc: "worlds/demo/maps/keep-f1.png",
    weather: "rain",
    levels: [
      {
        id: "lvl-1",
        name: "Ground Floor",
        backgroundSrc: "worlds/demo/maps/keep-f1.png",
        foregroundSrc: "",
        width: 4096,
        height: 4096
      },
      {
        id: "lvl-2",
        name: "Upper Battlements",
        backgroundSrc: "worlds/demo/maps/keep-f2.webp",
        foregroundSrc: "worlds/demo/maps/roof.png",
        width: 6000,
        height: 4000
      }
    ],
    tiles: [
      { id: "tile-1", src: "modules/fx/portal.webm", width: 300, height: 300 },
      { id: "tile-2", src: "worlds/demo/tiles/statue.jpg", width: 512, height: 512 }
    ],
    walls: [
      { id: "w1", c: [0, 0, 100, 0], move: 20, sight: 20, light: 20, sound: 20, door: 0 },
      { id: "w2", c: [100, 0, 0, 0], move: 20, sight: 20, light: 20, sound: 20, door: 0 },
      { id: "w3", c: [50, 50, 50, 50], move: 20, sight: 20, light: 20, sound: 20, door: 0 }
    ],
    lights: [
      { id: "l1", animationType: "torch" },
      { id: "l2", animationType: "none" },
      { id: "l3", animationType: "pulse" }
    ],
    tokens: [
      { id: "t1", textureSrc: "worlds/demo/tokens/boss.webm", lightAnimationType: "" },
      { id: "t2", textureSrc: "worlds/demo/tokens/guard.webp", lightAnimationType: "flame" }
    ],
    drawings: []
  };

  const meta = new Map([
    ["worlds/demo/maps/keep-f1.png", { width: 4096, height: 4096, byteSize: 12_000_000 }],
    ["worlds/demo/maps/keep-f2.webp", { width: 6000, height: 4000, byteSize: 2_200_000 }],
    ["worlds/demo/maps/roof.png", { width: 2048, height: 2048, byteSize: 4_500_000 }],
    ["worlds/demo/tiles/statue.jpg", { width: 512, height: 512, byteSize: 250_000 }]
  ]);

  const result = analyzeScene(scene, meta);

  // Top-level background matching lvl-1 backgroundSrc must not be double-counted
  assert.equal(result.assets.length, 5);
  assert.equal(result.pngCount, 2);
  assert.equal(result.unoptimizedCount, 3); // 2 png + 1 jpg
  assert.equal(result.oversizedCount, 1); // 6000x4000 = 24 MP
  assert.equal(result.maxResolution.width, 6000);
  assert.equal(result.maxResolution.height, 4000);
  assert.deepEqual(result.zeroLengthWallIds, ["w3"]);
  assert.deepEqual(result.duplicateWallIds, ["w2"]);
  // 2 animated lights + 2 animated tokens + 1 video tile + 1 weather = 6
  assert.equal(result.animationsCount, 6);
  assert.equal(result.severity, "critical");
});

test("4096x4096 WebP scene with clean walls stays ok under default thresholds", () => {
  const scene = {
    id: "clean-1",
    name: "Clean Arena",
    width: 4096,
    height: 4096,
    levels: [
      {
        id: "lvl-0",
        name: "Base",
        backgroundSrc: "worlds/demo/maps/arena.webp",
        foregroundSrc: "",
        width: 4096,
        height: 4096
      }
    ],
    tiles: [],
    walls: [{ id: "w1", c: [0, 0, 500, 0] }],
    lights: [{ id: "l1", animationType: "" }],
    tokens: [],
    drawings: []
  };

  const meta = new Map([
    ["worlds/demo/maps/arena.webp", { width: 4096, height: 4096, byteSize: 1_500_000 }]
  ]);

  const res = analyzeScene(scene, meta);
  assert.equal(res.oversizedCount, 0);
  assert.equal(res.pngCount, 0);
  assert.equal(res.hasIssues, false);
  assert.equal(res.severity, "ok");
});

test("findRedundantWalls distinguishes wall properties and elevation", () => {
  const walls = [
    { id: "a", c: [0, 0, 100, 0], move: 20, sight: 20, door: 0, levels: ["l1"] },
    { id: "b", c: [100, 0, 0, 0], move: 20, sight: 20, door: 0, levels: ["l2"] },
    { id: "c", c: [100, 0, 0, 0], move: 20, sight: 20, door: 0, levels: ["l1"] }
  ];
  const { zeroLengthIds, duplicateIds } = findRedundantWalls(walls);
  assert.deepEqual(zeroLengthIds, []);
  assert.deepEqual(duplicateIds, ["c"]);
});

test("suggestWebpTarget keeps writable world paths and redirects protected module paths", () => {
  const worldPlan = suggestWebpTarget("worlds/campaign/maps/tavern%20floor.png", "campaign");
  assert.equal(worldPlan.redirected, false);
  assert.equal(worldPlan.directory, "worlds/campaign/maps");
  assert.equal(worldPlan.filename, "tavern-floor.webp");

  const modulePlan = suggestWebpTarget("modules/cool-maps/assets/forest.png?v=2", "campaign");
  assert.equal(modulePlan.redirected, true);
  assert.equal(modulePlan.directory, "worlds/campaign/waifu-optimized");
  assert.equal(modulePlan.filename, "forest.webp");
});

test("auditScenes sorts heaviest critical scenes first", () => {
  const report = auditScenes(
    [
      { id: "ok", name: "Small Room", levels: [{ id: "l1", backgroundSrc: "a.webp" }] },
      { id: "bad", name: "Huge Map", levels: [{ id: "l1", backgroundSrc: "b.png" }] }
    ],
    new Map([
      ["a.webp", { width: 1000, height: 1000, byteSize: 100_000 }],
      ["b.png", { width: 5000, height: 5000, byteSize: 20_000_000 }]
    ])
  );
  assert.equal(report.totalScenes, 2);
  assert.equal(report.heavyScenesCount, 1);
  assert.equal(report.items[0].id, "bad");
});

test("analyzeScene detects 404 missing media, heavy asset bytes, orphaned tokens, and near-duplicate walls", () => {
  const scene = {
    id: "s-broken",
    name: "Broken Manor",
    levels: [{ id: "l1", backgroundSrc: "worlds/demo/missing.webp", width: 2048, height: 2048 }],
    tiles: [{ id: "t1", src: "worlds/demo/huge.webp", width: 2048, height: 2048 }],
    walls: [
      { id: "w1", c: [0, 0, 100, 0], move: 20, sight: 20, door: 0 },
      { id: "w2", c: [1.5, 0.5, 99.5, -0.5], move: 20, sight: 20, door: 0 },
      { id: "w3", c: [0, 0, 0, 100], move: 20, sight: 20, door: 0 }
    ],
    tokens: [
      { id: "tok1", actorId: "dead-actor", actorExists: false, textureSrc: "worlds/demo/tok.webp" },
      { id: "tok2", actorId: "ok-actor", actorExists: true, textureSrc: "worlds/demo/tok-404.png" }
    ],
    lights: [],
    drawings: []
  };

  const meta = new Map([
    ["worlds/demo/missing.webp", { width: 0, height: 0, byteSize: null, missing: true, statusCode: 404 }],
    ["worlds/demo/huge.webp", { width: 2048, height: 2048, byteSize: 22 * 1024 * 1024, missing: false }],
    ["worlds/demo/tok-404.png", { width: 0, height: 0, byteSize: null, missing: true, statusCode: 404 }]
  ]);

  const res = analyzeScene(scene, meta, {
    maxAssetBytes: 15 * 1024 * 1024,
    nearDuplicateWallTolerance: 2
  });

  assert.equal(res.severity, "critical");
  assert.equal(res.flags.hasMissingAsset, true);
  assert.equal(res.missingMediaCount, 2);
  assert.equal(res.assets[0].isMissing, true);
  assert.equal(res.assets[0].canAutoConvert, false);
  assert.equal(res.assets[1].isHeavyBytes, true);
  assert.equal(res.flags.hasHeavyBytes, true);
  assert.deepEqual(res.nearDuplicateWallIds, ["w2"]);
  assert.deepEqual(res.orphanedTokenIds, ["tok1"]);

  const audited = auditScenes([scene], meta, {
    ignoredSceneIds: new Set(["s-broken"])
  });
  assert.equal(audited.totalScenes, 0);
  assert.equal(audited.ignoredCount, 1);
  assert.equal(audited.ignoredItems[0].isIgnored, true);
});
