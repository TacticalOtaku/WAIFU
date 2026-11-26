import assert from "node:assert/strict";
import test from "node:test";
import {
  auditEntityBatch,
  reconcileCleanedEntityFindings
} from "../scripts/core/entity-audit.mjs";
import { cleanEntityFindingsBatch } from "../scripts/foundry/auto-fixer.mjs";
import { collectFolderDocuments } from "../scripts/foundry/world-audit-runner.mjs";

test("auditEntityBatch detects root, prototypeToken, embedded item, and ActiveEffect leftovers while skipping _stats and flags.core", () => {
  const actorSnapshot = {
    id: "a1",
    uuid: "Actor.a1",
    name: "Astaroth",
    docType: "Actor",
    isLocked: false,
    isCompendium: false,
    sourceLabel: "Campaign Folder",
    img: "modules/gone-art/portraits/astaroth.png",
    _stats: {
      compendiumSource: "Compendium.gone-mod.monsters.Actor.old99",
      lastModifiedBy: "gm"
    },
    flags: {
      core: { sheetClass: "dnd5e.CharacterSheet" },
      dnd5e: { proficient: true },
      "active-mod": { cached: true },
      "gone-mod": { legacyFlag: { tier: 3 } },
      "disabled-mod": { note: "inactive module data" }
    },
    prototypeToken: {
      texture: { src: "icons/svg/mystery-man.svg" },
      flags: {
        "gone-mod": { auraColor: "#ff00aa" },
        "active-mod": { scale: 1 }
      }
    },
    system: {
      details: {
        biography: {
          value:
            "<p>See @UUID[Compendium.gone-mod.spells.Item.sp1]{Fire Sigil}</p><div data-module=\"gone-ui\">legacy widget</div>"
        }
      }
    },
    items: [
      {
        id: "i1",
        uuid: "Actor.a1.Item.i1",
        name: "Rusty Blade",
        type: "weapon",
        img: "icons/weapons/swords/sword-broad.webp",
        flags: {
          "gone-mod": { weaponTag: "legacy" },
          "active-mod": { favorite: true }
        },
        effects: [
          {
            id: "e1",
            uuid: "Actor.a1.Item.i1.ActiveEffect.e1",
            name: "Hex Aura",
            flags: { "disabled-mod": { stackCount: 2 } },
            changes: [
              { key: "flags.gone-mod.hexBonus", mode: 2, value: "3" },
              { key: "system.bonuses.mwak.attack", mode: 2, value: "1" },
              { key: "flags.gone-mod.hexSave", mode: 2, value: "2" }
            ]
          }
        ]
      }
    ],
    effects: []
  };

  const report = auditEntityBatch([actorSnapshot], {
    activeModuleIds: new Set(["active-mod", "waifu"]),
    installedModuleIds: new Set(["active-mod", "disabled-mod", "waifu"]),
    systemId: "dnd5e"
  });

  assert.equal(report.targetsCount, 1);
  assert.equal(report.actorsCount, 1);
  assert.equal(report.embeddedScannedCount, 2); // Item.i1 + ActiveEffect.e1

  // Must NEVER flag core, system, active modules, or _stats metadata
  assert.ok(!report.findings.some((f) => f.namespace === "core"));
  assert.ok(!report.findings.some((f) => f.namespace === "dnd5e"));
  assert.ok(!report.findings.some((f) => f.namespace === "active-mod"));
  assert.ok(!report.findings.some((f) => f.fieldPath.includes("_stats")));

  // Expected findings across orphaned + inactive modules
  assert.ok(report.findings.some((f) => f.namespace === "gone-mod" && f.kind === "flag" && f.targetUuid === "Actor.a1" && f.isOrphaned));
  assert.ok(report.findings.some((f) => f.namespace === "disabled-mod" && f.kind === "flag" && f.targetUuid === "Actor.a1" && f.isInactive));
  assert.ok(report.findings.some((f) => f.namespace === "gone-mod" && f.kind === "prototype-flag"));
  assert.ok(report.findings.some((f) => f.namespace === "gone-art" && f.kind === "module-path" && f.fieldPath === "img"));
  assert.ok(report.findings.some((f) => f.namespace === "gone-mod" && f.kind === "uuid-string"));
  assert.ok(report.findings.some((f) => f.namespace === "gone-ui" && f.kind === "module-string"));
  assert.ok(report.findings.some((f) => f.namespace === "gone-mod" && f.kind === "flag" && f.targetUuid === "Actor.a1.Item.i1"));
  assert.ok(report.findings.some((f) => f.namespace === "disabled-mod" && f.kind === "flag" && f.targetUuid === "Actor.a1.Item.i1.ActiveEffect.e1"));
  const effectChanges = report.findings.filter((f) => f.kind === "effect-change" && f.namespace === "gone-mod");
  assert.equal(effectChanges.length, 2);
});

test("auditEntityBatch marks locked compendium findings read-only and cleanEntityFindingsBatch + reconcileCleanedEntityFindings handle atomic cleanup", async () => {
  const prevFromUuid = globalThis.fromUuid;
  const prevFoundry = globalThis.foundry;

  try {
    globalThis.foundry = {
      utils: {
        deepClone: (value) => structuredClone(value)
      }
    };
    const effectObj = {
      id: "e1",
      uuid: "Actor.a1.ActiveEffect.e1",
      name: "Old Buff",
      flags: { "gone-mod": { origin: "x" } },
      changes: [
        { key: "flags.gone-mod.first", mode: 2, value: "1" },
        { key: "system.abilities.str.value", mode: 2, value: "2" },
        { key: "flags.gone-mod.second", mode: 2, value: "3" }
      ],
      async update(patch) {
        if ("flags.-=gone-mod" in patch) delete this.flags["gone-mod"];
        if ("changes" in patch) this.changes = patch.changes;
      }
    };

    const itemObj = {
      id: "i1",
      uuid: "Actor.a1.Item.i1",
      name: "Legacy Scroll",
      flags: { "gone-mod": { stamp: 42 } },
      system: {
        description: { value: "<p>@UUID[Compendium.gone-mod.lore.Page1]{Old Tale}</p>" }
      },
      async update(patch) {
        if ("flags.-=gone-mod" in patch) delete this.flags["gone-mod"];
        if ("system.description.value" in patch) this.system.description.value = patch["system.description.value"];
        if ("system.==description" in patch) this.system.description = patch["system.==description"];
        if ("==system" in patch) this.system = patch["==system"];
      }
    };

    const actorObj = {
      id: "a1",
      uuid: "Actor.a1",
      name: "Vex",
      img: "modules/gone-art/token.webp",
      flags: { "gone-mod": { legacy: true } },
      prototypeToken: { flags: { "gone-mod": { ring: true } } },
      items: [itemObj],
      effects: [effectObj],
      async update(patch) {
        if ("flags.-=gone-mod" in patch) delete this.flags["gone-mod"];
        if ("prototypeToken.flags.-=gone-mod" in patch) delete this.prototypeToken.flags["gone-mod"];
        if ("img" in patch) this.img = patch.img;
      }
    };

    const docsMap = new Map([
      [actorObj.uuid, actorObj],
      [itemObj.uuid, itemObj],
      [effectObj.uuid, effectObj]
    ]);
    globalThis.fromUuid = async (uuid) => docsMap.get(uuid) ?? null;

    const worldSnap = {
      id: actorObj.id,
      uuid: actorObj.uuid,
      name: actorObj.name,
      docType: "Actor",
      isLocked: false,
      isCompendium: false,
      sourceLabel: "World Actors",
      img: actorObj.img,
      flags: actorObj.flags,
      prototypeToken: actorObj.prototypeToken,
      items: JSON.parse(JSON.stringify(actorObj.items)),
      effects: JSON.parse(JSON.stringify(actorObj.effects))
    };

    const lockedSnap = {
      id: "locked1",
      uuid: "Compendium.old-pack.actors.Actor.locked1",
      name: "Locked Boss",
      docType: "Actor",
      isLocked: true,
      isCompendium: true,
      sourceLabel: "Locked Compendium",
      flags: { "gone-mod": { bossMode: 1 } },
      items: [],
      effects: []
    };

    const report = auditEntityBatch([worldSnap, lockedSnap], {
      activeModuleIds: new Set(["waifu"]),
      installedModuleIds: new Set(["waifu"])
    });

    const lockedFinding = report.findings.find((f) => f.rootUuid === lockedSnap.uuid);
    assert.ok(lockedFinding);
    assert.equal(lockedFinding.isLocked, true);
    assert.equal(lockedFinding.canClean, false);

    const progressUpdates = [];
    const { cleanedIds, errors } = await cleanEntityFindingsBatch(report.findings, {
      onProgress: (info) => progressUpdates.push(info)
    });

    assert.equal(errors.length, 0);
    assert.ok(progressUpdates.length >= 1);
    assert.equal(progressUpdates.at(-1).current, report.findings.filter((f) => f.canClean).length);
    assert.ok(!cleanedIds.includes(lockedFinding.id), "Locked compendium entries must not be cleaned");

    // Verify mutations applied cleanly on world docs & effect changes kept valid system entry
    assert.equal(actorObj.flags["gone-mod"], undefined);
    assert.equal(actorObj.prototypeToken.flags["gone-mod"], undefined);
    assert.equal(actorObj.img, "");
    assert.equal(itemObj.flags["gone-mod"], undefined);
    assert.equal(itemObj.system.description.value, "<p>Old Tale</p>");
    assert.equal(effectObj.flags["gone-mod"], undefined);
    assert.deepEqual(effectObj.changes, [{ key: "system.abilities.str.value", mode: 2, value: "2" }]);

    const updatedReport = reconcileCleanedEntityFindings(report, cleanedIds);
    assert.equal(updatedReport.findingsCount, 1);
    assert.equal(updatedReport.findings[0].id, lockedFinding.id);
  } finally {
    globalThis.fromUuid = prevFromUuid;
    globalThis.foundry = prevFoundry;
  }
});

test("collectFolderDocuments traverses nested subfolders recursively without infinite loops on cycles", () => {
  const actor1 = { id: "a1", documentName: "Actor", name: "Alpha" };
  const actor2 = { id: "a2", documentName: "Actor", name: "Beta" };
  const childFolder = { id: "f-child", contents: [actor2], children: [] };
  const rootFolder = {
    id: "f-root",
    contents: [actor1],
    children: [{ folder: childFolder }]
  };
  // Deliberate cycle
  childFolder.children.push({ folder: rootFolder });

  const collected = collectFolderDocuments(rootFolder);
  assert.deepEqual(collected.map((d) => d.id), ["a1", "a2"]);
});
