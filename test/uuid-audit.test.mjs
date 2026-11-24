import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPatchAtPath,
  auditUuidReferences,
  collectUuidOccurrences,
  findUuidCandidates,
  parseFoundryUuid,
  patchStringUuidReference,
  searchUuidCatalog
} from "../scripts/core/uuid-audit.mjs";
import { extractJournalAnchors, slugifyAnchor } from "../scripts/core/utils.mjs";

test("parseFoundryUuid parses world, embedded, compendium, relative, and anchor UUIDs", () => {
  const page = parseFoundryUuid("JournalEntry.abc12345.JournalEntryPage.page9999#lore-top");
  assert.equal(page.validSyntax, true);
  assert.equal(page.baseUuid, "JournalEntry.abc12345.JournalEntryPage.page9999");
  assert.equal(page.anchor, "lore-top");
  assert.equal(page.targetDocType, "JournalEntryPage");
  assert.equal(page.parentUuid, "JournalEntry.abc12345");

  const rel = parseFoundryUuid(".JournalEntryPage.sub123", "JournalEntry.parent1");
  assert.equal(rel.validSyntax, true);
  assert.equal(rel.resolvedUuid, "JournalEntry.parent1.JournalEntryPage.sub123");
  assert.equal(rel.isRelative, true);

  const comp = parseFoundryUuid("Compendium.dnd5e.monsters.Actor.goblin123");
  assert.equal(comp.validSyntax, true);
  assert.equal(comp.isCompendium, true);
  assert.equal(comp.packId, "dnd5e.monsters");
  assert.equal(comp.targetDocType, "Actor");

  const bad = parseFoundryUuid("not a valid uuid");
  assert.equal(bad.validSyntax, false);
});

test("collectUuidOccurrences scans journals, Loreframe flags, actors, and embedded items", () => {
  const worldDocs = {
    journals: [
      {
        id: "j1",
        uuid: "JournalEntry.j1",
        name: "Campaign Lore",
        flags: {
          loreframe: {
            relations: [
              { label: "King", targetUuid: "Actor.deadKing12345678" }
            ],
            "node.with.dots": "See @UUID[JournalEntry.missing99]{Royal Decree}"
          },
          waifu: {
            ignoreMe: "@UUID[Actor.ignored123]{Ignored}"
          }
        },
        pages: [
          {
            id: "p1",
            uuid: "JournalEntry.j1.JournalEntryPage.p1",
            name: "History",
            text: {
              content:
                '<p>Talk to @UUID[Actor.deadKing12345678]{King Aldric} and check <a class="content-link" data-uuid="JournalEntry.missing99#sec">Royal Decree</a>.</p>',
              markdown: "@UUID[.JournalEntryPage.p2]{Next Page}"
            },
            system: { summary: "@UUID[Compendium.gone.pack.Item.sword1]{Sunblade}" },
            flags: {}
          }
        ]
      }
    ],
    actors: [
      {
        id: "a1",
        uuid: "Actor.a1",
        name: "Hero",
        system: { details: { biography: { value: "@UUID[Item.missingBlade1]{Stormbringer}" } } },
        flags: {},
        items: [
          {
            id: "i1",
            uuid: "Actor.a1.Item.i1",
            name: "Note",
            system: { description: { value: "@UUID[Actor.allyMissing1]{Ser Galen}" } },
            flags: {}
          }
        ],
        effects: []
      }
    ]
  };

  const occurrences = collectUuidOccurrences(worldDocs);
  assert.equal(occurrences.length, 8);
  assert.equal(occurrences.filter((o) => o.isLoreframe).length, 2);
  assert.equal(occurrences.some((o) => o.rawUuid === "Actor.ignored123"), false);
  assert.equal(occurrences.filter((o) => o.sourceCategory === "actor").length, 2);
});

test("collectUuidOccurrences tags Loreframe HTML blocks inside JournalEntryPage text.content", () => {
  const html = [
    `<div class="loreframe-block" data-loreframe-template="npc-card">`,
    `<ul data-loreframe-field="links"><li><p>@UUID[Actor.brokenNpc1]{Lord Varyn}</p></li></ul>`,
    `</div>`,
    `<p>Outside link @UUID[Actor.brokenOutside]{Guard}</p>`
  ].join("");

  const occurrences = collectUuidOccurrences({
    journals: [
      {
        id: "j2",
        uuid: "JournalEntry.j2",
        name: "Lore",
        flags: {},
        pages: [
          {
            id: "p2",
            uuid: "JournalEntry.j2.JournalEntryPage.p2",
            name: "NPCs",
            text: { content: html, markdown: "" },
            system: {},
            flags: {}
          }
        ]
      }
    ],
    actors: []
  });

  assert.equal(occurrences.length, 2);
  assert.equal(occurrences[0].isLoreframe, true);
  assert.equal(occurrences[0].loreframeTemplate, "npc-card");
  assert.equal(occurrences[0].sourceCategory, "loreframe");
  assert.equal(occurrences[1].isLoreframe, false);
  assert.equal(occurrences[1].sourceCategory, "journal");
});

test("auditUuidReferences detects missing packs/documents and ranks candidates", async () => {
  const worldDocs = {
    journals: [
      {
        id: "j1",
        uuid: "JournalEntry.j1",
        name: "Notes",
        flags: { loreframe: { linked: ["Actor.oldBob12345678"] } },
        pages: [
          {
            id: "p1",
            uuid: "JournalEntry.j1.JournalEntryPage.p1",
            name: "Intro",
            text: {
              content: "@UUID[Actor.oldBob12345678]{Bob the Smith} & @UUID[Actor.alive1]{Alive}",
              markdown: ""
            },
            system: {},
            flags: {}
          }
        ]
      }
    ],
    actors: []
  };

  const catalog = [
    { uuid: "Actor.newBob1", name: "Bob the Smith", docType: "Actor", sourceLabel: "World" },
    {
      uuid: "Compendium.world.npcs.Actor.bob2",
      name: "Bob the Smith",
      docType: "Actor",
      sourceLabel: "NPCs",
      isCompendium: true
    },
    { uuid: "Actor.other", name: "Bob Blacksmith", docType: "Actor", sourceLabel: "World" }
  ];

  const report = await auditUuidReferences(worldDocs, {
    catalog,
    hasPack: () => true,
    resolveUuid: async (uuid) => uuid === "Actor.alive1"
  });

  assert.equal(report.totalScanned, 3);
  assert.equal(report.brokenCount, 2);
  assert.equal(report.exactMatchCount, 1);

  const pageBroken = report.items.find((i) => i.syntax === "enricher");
  assert.equal(pageBroken.bestCandidate.uuid, "Actor.newBob1");
  assert.equal(pageBroken.bestCandidate.confidence, "exact");
});

test("findUuidCandidates scores fuzzy matches and patch helpers rewrite/unlink cleanly", () => {
  const cands = findUuidCandidates(
    { targetDocType: "Actor", label: "Goblin Shaman" },
    [
      { uuid: "Actor.1", name: "Goblin Shamans", docType: "Actor", sourceLabel: "World" },
      { uuid: "Item.2", name: "Goblin Shaman", docType: "Item", sourceLabel: "World" }
    ]
  );
  assert.equal(cands.length, 1);
  assert.equal(cands[0].uuid, "Actor.1");

  const replacedEnricher = patchStringUuidReference(
    "Meet @UUID[Actor.bad]{Goblin} today",
    { syntax: "enricher", rawUuid: "Actor.bad" },
    { mode: "replace", newUuid: "Actor.good" }
  );
  assert.equal(replacedEnricher, "Meet @UUID[Actor.good]{Goblin} today");

  const unlinkedHtml = patchStringUuidReference(
    'Talk to <a class="content-link" data-uuid="Actor.bad"><i class="fa"></i>Goblin</a> now',
    { syntax: "html-link", rawUuid: "Actor.bad" },
    { mode: "unlink" }
  );
  assert.equal(unlinkedHtml, "Talk to Goblin now");

  const loreframeObj = {
    "node.with.dots": "@UUID[Actor.bad]{Hero}",
    links: ["Actor.bad", "Actor.ok12345678"]
  };
  const patchedDotKey = applyPatchAtPath(
    loreframeObj,
    ["node.with.dots"],
    { syntax: "enricher", rawUuid: "Actor.bad" },
    { mode: "replace", newUuid: "Actor.fixed" }
  );
  assert.equal(patchedDotKey["node.with.dots"], "@UUID[Actor.fixed]{Hero}");

  const unlinkedArray = applyPatchAtPath(
    loreframeObj,
    ["links", 0],
    { syntax: "bare-uuid", rawUuid: "Actor.bad" },
    { mode: "unlink" }
  );
  assert.deepEqual(unlinkedArray.links, ["Actor.ok12345678"]);
});

test("collectUuidOccurrences scans world items, roll tables, macros, and scene notes/regions", () => {
  const occurrences = collectUuidOccurrences({
    items: [
      {
        id: "it1",
        uuid: "Item.it1",
        name: "Wand",
        system: { description: { value: "@UUID[JournalEntry.lost1]{Lore}" } },
        flags: {}
      }
    ],
    tables: [
      {
        id: "rt1",
        uuid: "RollTable.rt1",
        name: "Loot",
        description: "",
        flags: {},
        results: [
          { id: "r1", uuid: "RollTable.rt1.TableResult.r1", documentUuid: "Item.missingSword1234", text: "Sword" }
        ]
      }
    ],
    macros: [
      {
        id: "m1",
        uuid: "Macro.m1",
        name: "Open Boss",
        command: 'const d = await fromUuid("Actor.missingBoss123");',
        flags: {}
      }
    ],
    scenes: [
      {
        id: "sc1",
        uuid: "Scene.sc1",
        name: "Tavern",
        flags: {},
        notes: [
          { id: "n1", uuid: "Scene.sc1.Note.n1", label: "Pin", text: "", journalTarget: "JournalEntry.missingJrn123" }
        ],
        regions: []
      }
    ]
  });

  assert.equal(occurrences.length, 4);
  assert.equal(occurrences.some((o) => o.syntax === "from-uuid" && o.rawUuid === "Actor.missingBoss123"), true);
  assert.equal(occurrences.some((o) => o.rootDocType === "RollTable"), true);
  assert.equal(occurrences.some((o) => o.rootDocType === "Scene"), true);
});

test("extractJournalAnchors, missing-anchor detection, catalog search, and label/fromUuid patching work", async () => {
  const anchors = extractJournalAnchors(
    '<h2 id="sec-one">Глава Первая</h2><h3>Boss Fight!</h3>',
    "# Secret Room"
  );
  assert.equal(anchors.has("sec-one"), true);
  assert.equal(anchors.has(slugifyAnchor("Глава Первая")), true);
  assert.equal(anchors.has("boss-fight"), true);
  assert.equal(anchors.has("secret-room"), true);

  const report = await auditUuidReferences(
    {
      journals: [
        {
          id: "j1",
          uuid: "JournalEntry.j1",
          name: "Index",
          flags: {},
          pages: [
            {
              id: "p1",
              uuid: "JournalEntry.j1.JournalEntryPage.p1",
              name: "Links",
              text: {
                content: "@UUID[JournalEntry.j1.JournalEntryPage.p2#old-heading]{Section}",
                markdown: ""
              },
              system: {},
              flags: {}
            }
          ]
        }
      ]
    },
    {
      resolveUuid: async () => true,
      resolveAnchor: async () => ({ valid: false, suggestions: ["new-heading"] })
    }
  );

  assert.equal(report.brokenCount, 1);
  assert.equal(report.missingAnchorCount, 1);
  assert.equal(report.items[0].reason, "missing-anchor");
  assert.equal(report.items[0].bestCandidate.uuid, "JournalEntry.j1.JournalEntryPage.p2#new-heading");

  const catalogHits = searchUuidCatalog("king", [
    { uuid: "Actor.k1", name: "King Aldric", docType: "Actor", sourceLabel: "World" },
    { uuid: "Item.s1", name: "Short Sword", docType: "Item", sourceLabel: "World" }
  ]);
  assert.equal(catalogHits.length, 1);
  assert.equal(catalogHits[0].uuid, "Actor.k1");

  const renamedEnricher = patchStringUuidReference(
    "Talk to @UUID[Actor.old]{Old Name}",
    { syntax: "enricher", rawUuid: "Actor.old" },
    { mode: "replace", newUuid: "Actor.new", newLabel: "New Name" }
  );
  assert.equal(renamedEnricher, "Talk to @UUID[Actor.new]{New Name}");

  const patchedMacro = patchStringUuidReference(
    'await fromUuid("Actor.old");',
    { syntax: "from-uuid", rawUuid: "Actor.old" },
    { mode: "replace", newUuid: "Actor.new" }
  );
  assert.equal(patchedMacro, 'await fromUuid("Actor.new");');
});
