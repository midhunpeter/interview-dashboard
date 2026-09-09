import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { TABLES, exportDataset, validateBackup, createBackupService, generation, revision, preserveLegacyAnswers } from "../reliability.js";

// Set this BEFORE importing db.js/server.js. No test can open the user's database.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "interview-reliability-tests-"));
process.env.DATABASE_PATH = path.join(directory, "application.db");
process.env.RECOVERY_DIRECTORY = path.join(directory, "server-recovery");
process.env.API_ONLY = "1";
const { db } = await import("../db.js");
const { app } = await import("../server.js");
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const baseURL = `http://127.0.0.1:${server.address().port}/api`;
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options) => originalFetch(typeof url === "string" && url.startsWith("/api") ? baseURL + url.slice(4) : url, options);
after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise((resolve) => server.close(resolve));
  db.close();
  await fs.rm(directory, { recursive: true, force: true });
});

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
function seedAll() {
  db.transaction(() => {
    db.prepare("INSERT INTO workspaces (id, company_name, role_title) VALUES (2, 'Second company', 'PM')").run();
    db.prepare("INSERT INTO prep_sections (workspace_id,module_key,label) VALUES (2,'custom','Custom section')").run();
    db.prepare("INSERT INTO interview_rounds (id,workspace_id,label,interviewers,interviewer_notes,questions_to_ask,outcome_notes) VALUES (1,1,'Hiring manager','[\"One\"]','Research','**Ask**','Outcome'),(2,2,'Technical','[]','Other research','Other question','Other outcome')").run();
    db.prepare("INSERT INTO story_bank (id,module,title,tags,situation,task,action,result,used_for,status) VALUES (1,'positioning','First story','[\"tag\"]','Situation','Task','Action','Result','[\"intro\"]','confident'),(2,'positioning','Second story','[]','Other situation','','','','[]','reviewed')").run();
    db.prepare("INSERT INTO case_framework_bank (id,workspace_id,module,title,tags,clarify,user_goal,pain_points,solutions,prioritize,success,risks_wrap,used_for,status) VALUES (1,2,'custom','Case','[]','One','Two','Three','Four','Five','Six','Seven','[\"Case study\"]','reviewed')").run();
    db.prepare("INSERT INTO question_bank (id,module,sub_topic,question,my_answer,status) VALUES (1,'custom','Topic','Question','Answer','confident')").run();
    db.prepare("INSERT INTO drill_trees (id,module,root_question,round_id) VALUES (1,'custom','Root question',2)").run();
    db.prepare("INSERT INTO drill_followups (id,drill_tree_id,level,question,my_answer,status) VALUES (1,1,1,'Follow up','Answer','confident')").run();
    db.prepare("UPDATE scheduling_machine SET overview='Overview', architecture_notes='[\"Architecture\"]', ownership_stories='[\"Owned it\"]', scale_metrics='Scale', lessons_learned='Lessons'").run();
    db.prepare("INSERT INTO reliability_incidents (id,title,what_broke,how_found,how_fixed,what_changed_after,tags) VALUES (1,'Incident','Broke','Found','Fixed','Changed','[\"incident\"]')").run();
    db.prepare("INSERT INTO translation_map (id,scheduling_machine_pattern,tempus_problem,what_i_bring) VALUES (1,'Pattern','Problem','Contribution')").run();
    db.prepare("INSERT INTO knowledge_items (id,module,term,definition,notes,tags) VALUES (1,'custom','Term','Definition','Notes','[\"knowledge\"]')").run();
    db.prepare("INSERT INTO app_metadata (resource,record_id,value) VALUES ('settings',1,?),('story-bank',1,?),('drill-trees',1,?)").run(JSON.stringify({ activeWorkspaceId: 2 }), JSON.stringify({ priority: "high", starred: true, sortOrder: 17, createdAt: "2025-01-01", content: { notes: "Metadata retained" } }), JSON.stringify({ rootNode: { question: "Root", myAnswer: "Root answer" }, quickReviewNotes: "Review" }));
    const tags = db.prepare("INSERT INTO item_round_tags (item_type,item_id,round_id) VALUES (?,1,?)");
    for (const type of ["story", "case_framework", "question", "reliability_incident", "translation_map", "knowledge_item"]) tags.run(type, 2);
    db.prepare("INSERT INTO item_round_tags (item_type,item_id,round_id) VALUES ('story',1,1)").run();
    db.prepare("INSERT INTO item_images (resource,record_id,filename,mime_type,data) VALUES ('story-bank',1,'first.png','image/png',?),('case-framework',1,'second.png','image/png',?)").run(png, png);
    db.prepare("INSERT INTO case_legacy_answers (case_id,stage,source,answer) VALUES (1,'understand','Database column','  Original **answer**\n')").run();
  })();
}
seedAll();
const originalBackup = exportDataset(db);
const contents = (backup) => ({ tables: backup.tables, sequences: backup.sequences });
async function temporaryCopy() {
  const filename = path.join(directory, `${randomUUID()}.db`);
  await db.backup(filename);
  const copy = new Database(filename);
  copy.pragma("foreign_keys=ON");
  copy.pragma("journal_mode=WAL");
  return { copy, filename };
}
async function request(route, { method = "GET", body, token = generation(db), expected, headers = {} } = {}) {
  const response = await originalFetch(baseURL + route, { method, headers: { "Content-Type": "application/json", "X-Dataset-Generation": token, ...(expected == null ? {} : { "If-Match": String(expected) }), ...headers }, body: body == null ? undefined : JSON.stringify(body) });
  const value = response.status === 204 ? null : await response.json();
  return { response, value };
}

test("complete snapshot contains every table, preserves IDs, image bytes and sequences after restore/reopen", async () => {
  const { copy, filename } = await temporaryCopy();
  try {
    copy.prepare("UPDATE story_bank SET situation='Changed after export' WHERE id=1").run();
    const result = await createBackupService(copy, path.join(directory, "recovery")).restore(originalBackup, generation(copy));
    assert.ok((await fs.stat(result.recoveryPath)).size > 0);
    const recovery = new Database(result.recoveryPath, { readonly: true });
    assert.equal(recovery.prepare("SELECT situation FROM story_bank WHERE id=1").get().situation, "Changed after export");
    recovery.close();
  } finally { copy.close(); }
  const reopened = new Database(filename);
  try {
    assert.deepEqual(contents(exportDataset(reopened)), contents(originalBackup));
    assert.deepEqual(reopened.prepare("SELECT data FROM item_images ORDER BY id").all().map((r) => r.data), [png, png]);
    const created = reopened.prepare("INSERT INTO story_bank(title) VALUES ('After restore')").run();
    assert.ok(Number(created.lastInsertRowid) > 2);
    assert.deepEqual(reopened.pragma("foreign_key_check"), []);
  } finally { reopened.close(); }
});

test("backup endpoint ignores active workspace and round filters", async () => {
  const { response, value } = await request("/backup?workspace_id=2&round_id=2");
  assert.equal(response.status, 200);
  assert.equal(value.tables.workspaces.length, 2);
  assert.equal(value.tables.interview_rounds.length, 2);
  assert.equal(value.tables.story_bank.length, 2);
  assert.equal(value.tables.item_images[0].data, png.toString("base64"));
  assert.deepEqual(Object.keys(value.tables), TABLES);
});

test("malformed, unsupported, duplicate, invalid relationships, field types and images are rejected before backup or writes", async () => {
  const mutations = [
    (b) => { b.version = 999; }, (b) => { delete b.tables.drill_followups; },
    (b) => { b.tables.story_bank.push(b.tables.story_bank[0]); },
    (b) => { b.tables.story_bank[0].id = "1"; },
    (b) => { b.tables.story_bank[0].tags = "{\"not\":\"an array\"}"; },
    (b) => { b.tables.interview_rounds[0].workspace_id = 999; },
    (b) => { b.tables.item_round_tags[0].item_id = 999; },
    (b) => { b.tables.item_round_tags.push({ ...b.tables.item_round_tags[0], id: 99 }); },
    (b) => { b.tables.item_images[0].record_id = 999; },
    (b) => { b.tables.item_images[0].data = "not base64!"; },
    (b) => { b.tables.item_images[0].data = Buffer.from("not actually an image").toString("base64"); },
    (b) => { b.tables.item_images[0].data = Buffer.alloc(12 * 1024 * 1024 + 1).toString("base64"); },
    (b) => { b.tables.item_images[0].mime_type = "text/html"; },
    (b) => { b.tables.item_images[0].filename = "../evil.png"; },
    (b) => { b.tables.app_metadata.push({ resource: "question-bank", record_id: 999, value: "{}" }); },
  ];
  const before = exportDataset(db);
  let recoveryCalls = 0;
  const service = createBackupService(db, directory, { backup: async () => { recoveryCalls++; throw new Error("Should not reach backup"); } });
  for (const mutate of mutations) {
    const bad = structuredClone(originalBackup); mutate(bad);
    await assert.rejects(service.restore(bad, generation(db)));
    assert.deepEqual(contents(exportDataset(db)), contents(before));
  }
  assert.throws(() => validateBackup(db, { schemaVersion: 1, items: [] }), /older browser-state export/);
  assert.equal(recoveryCalls, 0);
});

test("mid-restore failure rolls back content, metadata, relationships, images, sequence state, generation and revisions", async () => {
  const { copy } = await temporaryCopy();
  try {
    copy.prepare("UPDATE story_bank SET title='Do not lose me' WHERE id=1").run();
    const before = contents(exportDataset(copy));
    const token = generation(copy);
    const versions = copy.prepare("SELECT * FROM record_versions ORDER BY resource,record_id").all();
    const service = createBackupService(copy, path.join(directory, "recovery"), { onTable: (table) => { if (table === "item_images") throw new Error("Injected failure after images"); } });
    await assert.rejects(service.restore(originalBackup, token), /Injected failure/);
    assert.deepEqual(contents(exportDataset(copy)), before);
    assert.equal(generation(copy), token);
    assert.deepEqual(copy.prepare("SELECT * FROM record_versions ORDER BY resource,record_id").all(), versions);
  } finally { copy.close(); }
});

test("restore aborts if a verified recovery backup cannot be created", async () => {
  const before = contents(exportDataset(db));
  const token = generation(db);
  const service = createBackupService(db, directory, { backup: async () => { throw new Error("Disk unavailable"); } });
  await assert.rejects(service.restore(originalBackup, token), /Disk unavailable/);
  assert.deepEqual(contents(exportDataset(db)), before);
  assert.equal(generation(db), token);
});

test("legacy migration preserves column and disagreeing metadata verbatim, retains seven stages, backs up and is idempotent", async () => {
  const legacy = new Database(path.join(directory, "legacy.db"));
  legacy.pragma("journal_mode=WAL"); legacy.pragma("foreign_keys=ON");
  legacy.exec("CREATE TABLE case_framework_bank (id INTEGER PRIMARY KEY, title TEXT, understand TEXT, define TEXT, solve TEXT, prove TEXT, clarify TEXT); CREATE TABLE app_metadata(resource TEXT,record_id INTEGER,value TEXT,PRIMARY KEY(resource,record_id));");
  legacy.prepare("INSERT INTO case_framework_bank VALUES (1,'Original','  column\n**answer**  ','define','','prove','Seven-stage answer'),(2,'Empty',NULL,NULL,NULL,NULL,'Keep this')").run();
  const metadata = JSON.stringify({ content: { understand: "different metadata\n", define: "define", solve: "Metadata only", clarify: "Original metadata" }, tags: ["keep"] });
  legacy.prepare("INSERT INTO app_metadata VALUES ('case-framework',1,?)").run(metadata);
  try {
    await preserveLegacyAnswers(legacy, path.join(directory, "legacy-recovery"));
    const answers = legacy.prepare("SELECT * FROM case_legacy_answers ORDER BY id").all();
    assert.ok(answers.some((a) => a.source === "Database column" && a.answer === "  column\n**answer**  "));
    assert.ok(answers.some((a) => a.source === "Application metadata" && a.answer === "different metadata\n"));
    assert.ok(answers.some((a) => a.answer === "Metadata only"));
    assert.equal(legacy.prepare("SELECT clarify FROM case_framework_bank WHERE id=1").get().clarify, "Seven-stage answer");
    assert.equal(legacy.prepare("SELECT value FROM app_metadata WHERE resource='case-framework'").get().value, metadata);
    assert.equal(legacy.prepare("PRAGMA table_info(case_framework_bank)").all().some((c) => c.name === "understand"), false);
    const copies = (await fs.readdir(path.join(directory, "legacy-recovery"))).filter((name) => name.endsWith(".db"));
    assert.equal(copies.length, 1);
    const recovery = new Database(path.join(directory, "legacy-recovery", copies[0]), { readonly: true });
    assert.equal(recovery.prepare("SELECT understand FROM case_framework_bank WHERE id=1").get().understand, "  column\n**answer**  "); recovery.close();
    await preserveLegacyAnswers(legacy, path.join(directory, "legacy-recovery"), () => { throw new Error("Should not back up twice"); });
    assert.deepEqual(legacy.prepare("SELECT * FROM case_legacy_answers ORDER BY id").all(), answers);
  } finally { legacy.close(); }
});

test("metadata-only legacy answers are preserved; backup failure leaves old schema and marker untouched", async () => {
  for (const mode of ["metadata-only", "backup-failure"]) {
    const legacy = new Database(path.join(directory, `${mode}.db`));
    legacy.exec(`CREATE TABLE case_framework_bank(id INTEGER PRIMARY KEY, clarify TEXT${mode === "backup-failure" ? ", understand TEXT" : ""}); CREATE TABLE app_metadata(resource TEXT,record_id INTEGER,value TEXT,PRIMARY KEY(resource,record_id)); INSERT INTO case_framework_bank(id,clarify) VALUES(1,'Modern');`);
    legacy.prepare("INSERT INTO app_metadata VALUES ('case-framework',1,?)").run(JSON.stringify({ content: { understand: "Metadata survives" } }));
    try {
      if (mode === "backup-failure") {
        await assert.rejects(preserveLegacyAnswers(legacy, directory, async () => { throw new Error("No recovery"); }), /No recovery/);
        assert.ok(legacy.prepare("PRAGMA table_info(case_framework_bank)").all().some((c) => c.name === "understand"));
        assert.equal(legacy.prepare("SELECT count(*) AS n FROM app_metadata WHERE resource='migration'").get().n, 0);
      } else {
        await preserveLegacyAnswers(legacy, directory);
        assert.equal(legacy.prepare("SELECT answer FROM case_legacy_answers").get().answer, "Metadata survives");
      }
    } finally { legacy.close(); }
  }
});

test("HTTP optimistic writes protect metadata and relationships and reject stale updates/deletes", async () => {
  const a = await request("/story-bank/1");
  const b = await request("/story-bank/1");
  const saved = await request("/story-bank/1", { method: "PUT", expected: a.value._revision, body: { situation: "Client A", _ui: { content: { notes: "New metadata" } }, roundIds: [1] } });
  assert.equal(saved.response.status, 200);
  const stale = await request("/story-bank/1", { method: "PUT", expected: b.value._revision, body: { situation: "Client B draft", _ui: { content: { notes: "Must not overwrite" } }, roundIds: [2] } });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.value.code, "REVISION_CONFLICT");
  const after = (await request("/story-bank/1")).value;
  assert.equal(after.situation, "Client A"); assert.equal(after._ui.content.notes, "New metadata"); assert.deepEqual(after.roundIds, [1]);
  assert.equal((await request("/story-bank/1", { method: "DELETE", expected: b.value._revision })).response.status, 409);
  assert.equal((await request("/story-bank/1", { method: "PUT", body: { situation: "Missing version" } })).response.status, 409);
});

test("client dirty tracking: different records survive, unchanged records are not rewritten, filtered absence never deletes", async () => {
  const a = await import(`../src/data.js?client=${randomUUID()}`);
  const b = await import(`../src/data.js?client=${randomUUID()}`);
  const da = await a.loadData(); const dbState = await b.loadData();
  const untouched = revision(db, "question-bank", 1);
  const story = (data, id) => data.items.find((item) => item.id === `story-bank:${id}`);
  story(da, 1).content.situation = "Client A independent edit";
  story(dbState, 2).content.situation = "Client B independent edit";
  await a.saveData(da); await b.saveData(dbState);
  assert.equal(db.prepare("SELECT situation FROM story_bank WHERE id=1").get().situation, "Client A independent edit");
  assert.equal(db.prepare("SELECT situation FROM story_bank WHERE id=2").get().situation, "Client B independent edit");
  assert.equal(revision(db, "question-bank", 1), untouched);
  const beforeFilter = db.prepare("SELECT * FROM record_versions ORDER BY resource,record_id").all();
  const filtered = await a.loadRoundFilteredContent(2, 2);
  assert.equal(filtered.items.some((item) => item.id === "story-bank:1"), false);
  await a.saveData({ ...da, ...filtered });
  assert.ok(db.prepare("SELECT id FROM story_bank WHERE id=1").get());
  assert.deepEqual(db.prepare("SELECT * FROM record_versions ORDER BY resource,record_id").all(), beforeFilter);
});

test("client same-record conflict keeps draft, compares latest and only retries by explicit choice", async () => {
  const a = await import(`../src/data.js?client=${randomUUID()}`);
  const b = await import(`../src/data.js?client=${randomUUID()}`);
  const da = await a.loadData(); const dbState = await b.loadData();
  da.items.find((item) => item.id === "story-bank:2").content.situation = "Newest saved answer";
  dbState.items.find((item) => item.id === "story-bank:2").content.situation = "Unsaved competing draft";
  await a.saveData(da);
  let conflict;
  await assert.rejects(b.saveData(dbState), (error) => { conflict = error; return error.status === 409; });
  assert.ok(JSON.stringify(b.getUnsavedDrafts()).includes("Unsaved competing draft"));
  assert.equal(dbState.items.find((item) => item.id === "story-bank:2").content.situation, "Unsaved competing draft");
  const latest = await b.latestConflictVersion(conflict);
  assert.equal(latest.situation, "Newest saved answer");
  await b.resolveDataConflict("retry", latest);
  assert.equal(db.prepare("SELECT situation FROM story_bank WHERE id=2").get().situation, "Unsaved competing draft");
  assert.equal(b.getUnsavedDrafts().operations.length, 0);
});

test("restore invalidates stale updates AND deletes even when IDs/versions look valid", async () => {
  const before = await request("/story-bank/1");
  const oldToken = generation(db);
  const restored = await request("/backup/restore", { method: "POST", body: originalBackup, headers: { "X-Confirm-Replacement": "replace-all-workspaces" } });
  assert.equal(restored.response.status, 200);
  assert.notEqual(generation(db), oldToken);
  for (const method of ["PUT", "DELETE"]) {
    const result = await request("/story-bank/1", { method, token: oldToken, expected: revision(db, "story-bank", 1), body: method === "PUT" ? { situation: "Stale" } : undefined });
    assert.equal(result.response.status, 409); assert.equal(result.value.code, "DATASET_CHANGED");
  }
  assert.equal((await request("/story-bank/1")).value.situation, originalBackup.tables.story_bank[0].situation);
  assert.ok(before.value._revision > 0);
});

test("multi-image imports over the former 20 MB body limit are validated and previewed", async () => {
  const large = structuredClone(originalBackup);
  const bytes = Buffer.alloc(8 * 1024 * 1024); png.copy(bytes);
  for (const image of large.tables.item_images) image.data = bytes.toString("base64");
  assert.ok(Buffer.byteLength(JSON.stringify(large)) > 20 * 1024 * 1024);
  const { response, value } = await request("/backup/preview", { method: "POST", body: large });
  assert.equal(response.status, 200);
  assert.equal(value.imageBytes, 16 * 1024 * 1024);
});

test("newer drafts queued during an in-flight save finish before all save promises resolve", async () => {
  const client = await import(`../src/data.js?client=${randomUUID()}`);
  const state = await client.loadData();
  const draft = state.items.find((item) => item.id === "story-bank:2");
  draft.content.situation = "First keystrokes";
  const first = client.saveData(structuredClone(state));
  draft.content.situation = "Newer text must win";
  const second = client.saveData(structuredClone(state));
  await Promise.all([first, second]);
  assert.equal(db.prepare("SELECT situation FROM story_bank WHERE id=2").get().situation, "Newer text must win");
  assert.equal(client.getUnsavedDrafts().operations.length, 0);
});

test("explicit load-saved conflict resolution discards only the selected draft, saves unrelated pending edits", async () => {
  const client = await import(`../src/data.js?client=${randomUUID()}`);
  const state = await client.loadData();
  const latest = (await request("/story-bank/1")).value;
  await request("/story-bank/1", { method: "PUT", expected: latest._revision, body: { situation: "Other client" } });
  state.items.find((item) => item.id === "story-bank:1").content.situation = "Draft I choose to discard";
  state.items.find((item) => item.id === "story-bank:2").content.situation = "Unrelated draft kept";
  let conflict;
  await assert.rejects(client.saveData(state), (error) => { conflict = error; return error.status === 409; });
  const canonical = await client.resolveDataConflict("saved", await client.latestConflictVersion(conflict));
  assert.equal(canonical.items.find((item) => item.id === "story-bank:1").content.situation, "Other client");
  assert.equal(canonical.items.find((item) => item.id === "story-bank:2").content.situation, "Unrelated draft kept");
});

test("filtered fetch cannot rebase a pending conflicting draft onto a newer revision", async () => {
  const client = await import(`../src/data.js?client=${randomUUID()}`);
  const state = await client.loadData();
  const latest = (await request("/story-bank/2")).value;
  await request("/story-bank/2", { method: "PUT", expected: latest._revision, body: { situation: "Server change" } });
  state.items.find((item) => item.id === "story-bank:2").content.situation = "Still unsaved";
  await assert.rejects(client.saveData(state), { status: 409 });
  await client.loadRoundFilteredContent(2, 2);
  await assert.rejects(client.saveData(state), { status: 409 });
  assert.equal(db.prepare("SELECT situation FROM story_bank WHERE id=2").get().situation, "Server change");
  assert.ok(JSON.stringify(client.getUnsavedDrafts()).includes("Still unsaved"));
});

test("explicit item deletion atomically removes images, tags and metadata; omission alone is harmless", async () => {
  const client = await import(`../src/data.js?client=${randomUUID()}`);
  const state = await client.loadData();
  const item = state.items.find((entry) => entry.id === "story-bank:1");
  const hidden = { ...state, items: state.items.filter((entry) => entry.id !== item.id) };
  await client.saveData(hidden);
  assert.ok(db.prepare("SELECT id FROM story_bank WHERE id=1").get());
  client.queueItemDeletion(item);
  await client.saveData(hidden);
  assert.equal(db.prepare("SELECT id FROM story_bank WHERE id=1").get(), undefined);
  assert.equal(db.prepare("SELECT count(*) n FROM item_round_tags WHERE item_type='story' AND item_id=1").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM item_images WHERE resource='story-bank' AND record_id=1").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM app_metadata WHERE resource='story-bank' AND record_id=1").get().n, 0);
});

test("round deletion changes affected logical revisions and preserves drill trees as general prep", async () => {
  const beforeTree = revision(db, "drill-trees", 1);
  const beforeCase = revision(db, "case-framework", 1);
  const round = (await request("/workspaces/2/rounds/2")).value;
  assert.equal((await request("/workspaces/2/rounds/2", { method: "DELETE", expected: round._revision })).response.status, 204);
  assert.equal(db.prepare("SELECT round_id FROM drill_trees WHERE id=1").get().round_id, null);
  assert.ok(revision(db, "drill-trees", 1) > beforeTree);
  assert.ok(revision(db, "case-framework", 1) > beforeCase);
});

test("restore blocks writes while recovery is pending, and no success is exposed before commit", async () => {
  const { copy } = await temporaryCopy();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { recoveryBackup } = await import("../reliability.js");
  const service = createBackupService(copy, directory, { backup: async (...args) => { await gate; return recoveryBackup(...args); } });
  const token = generation(copy);
  const operation = service.restore(originalBackup, token);
  assert.equal(service.replacing, true);
  assert.equal(generation(copy), token);
  await assert.rejects(service.restore(originalBackup, token), /already in progress/);
  release();
  await operation;
  assert.equal(service.replacing, false);
  assert.notEqual(generation(copy), token);
  copy.close();
});

test("images require the owner's version and atomically advance it, preventing stale parent deletion", async () => {
  const owner = (await request("/story-bank/2")).value;
  const upload = await request("/item-images", { method: "POST", body: { resource: "story-bank", record_id: 2, filename: "new.png", data: png.toString("base64") }, headers: { "If-Match-Owner": String(owner._revision) } });
  assert.equal(upload.response.status, 201);
  assert.ok(Number(upload.response.headers.get("X-Owner-Revision")) > owner._revision);
  assert.equal((await request("/story-bank/2", { method: "DELETE", expected: owner._revision })).response.status, 409);
  const client = await import(`../src/data.js?client=${randomUUID()}`);
  await client.loadData();
  await client.deleteItemImage(upload.value.id);
  assert.equal(db.prepare("SELECT id FROM item_images WHERE id=?").get(upload.value.id), undefined);
});

test("section edits retain unchanged row identities, timestamps and values", async () => {
  const before = db.prepare("SELECT * FROM prep_sections WHERE workspace_id=1 ORDER BY id").all();
  const response = await request("/prep-sections?workspace_id=1");
  const sections = response.value.map((row) => ({ ...row, isBuiltin: row.is_builtin }));
  sections[0].label = "Renamed section";
  const saved = await request("/prep-sections?workspace_id=1", { method: "PUT", expected: Number(response.response.headers.get("X-Record-Revision")), body: { sections } });
  assert.equal(saved.response.status, 200);
  const after = db.prepare("SELECT * FROM prep_sections WHERE workspace_id=1 ORDER BY id").all();
  assert.deepEqual(after.map((row, index) => ({ ...row, label: before[index].label })), before);
});

test("new item creation and type conversion are atomic, including round tags and images", async () => {
  const created = await request("/knowledge-items", { method: "POST", body: { module: "custom", term: "Convert me", notes: "Draft text", tags: [], _ui: { content: { notes: "Draft text" } } } });
  assert.equal(created.response.status, 201);
  const bad = await request("/convert-item", { method: "POST", body: { source: "knowledge-items", id: created.value.id, expectedRevision: created.value._revision, target: "case-framework", item: { workspace_id: 999, title: "Fail" } } });
  assert.equal(bad.response.status, 500);
  assert.ok(db.prepare("SELECT id FROM knowledge_items WHERE id=?").get(created.value.id));
  const converted = await request("/convert-item", { method: "POST", body: { source: "knowledge-items", id: created.value.id, expectedRevision: created.value._revision, target: "question-bank", item: { question: "Converted", my_answer: "Draft text", _ui: { content: { notes: "Draft text" } } } } });
  assert.equal(converted.response.status, 200);
  assert.equal(converted.value.my_answer, "Draft text");
  assert.equal(db.prepare("SELECT id FROM knowledge_items WHERE id=?").get(created.value.id), undefined);
});

test("client restore reloads canonical state, drops caches, and rejects another tab's queued draft", async () => {
  const a = await import(`../src/data.js?client=${randomUUID()}`);
  const b = await import(`../src/data.js?client=${randomUUID()}`);
  await a.loadData(); const old = await b.loadData();
  const result = await a.restoreBackup(originalBackup);
  assert.equal(result.data.rounds.length, 1);
  assert.equal(result.data.activeWorkspaceId, 2);
  old.items.find((item) => item.id === "story-bank:2").content.situation = "Pre-restore draft";
  let conflict;
  await assert.rejects(b.saveData(old), (error) => { conflict = error; return error.code === "DATASET_CHANGED"; });
  assert.ok(JSON.stringify(b.getUnsavedDrafts()).includes("Pre-restore draft"));
  await assert.rejects(b.resolveDataConflict("retry", {}), /Pre-restore writes/);
  const canonical = await b.resolveDataConflict("saved", await b.latestConflictVersion(conflict));
  assert.equal(canonical.items.find((item) => item.id === "story-bank:2").content.situation, "Other situation");
  assert.equal(b.getUnsavedDrafts().operations.length, 0);
});

test("legacy preservation on the full schema retains case identity, modern stages and round associations", async () => {
  const { copy } = await temporaryCopy();
  try {
    const before = copy.prepare("SELECT * FROM case_framework_bank WHERE id=1").get();
    const tags = copy.prepare("SELECT * FROM item_round_tags WHERE item_type='case_framework'").all();
    copy.exec("ALTER TABLE case_framework_bank ADD COLUMN understand TEXT; ALTER TABLE case_framework_bank ADD COLUMN prove TEXT;");
    copy.prepare("UPDATE case_framework_bank SET understand='Legacy column', prove='Legacy proof' WHERE id=1").run();
    copy.prepare("DELETE FROM app_metadata WHERE resource='migration' AND record_id=3").run();
    copy.prepare("INSERT INTO app_metadata(resource,record_id,value) VALUES('case-framework',1,?)").run(JSON.stringify({ content: { understand: "Distinct metadata", clarify: "Modern metadata" } }));
    await preserveLegacyAnswers(copy, directory);
    assert.deepEqual(copy.prepare("SELECT * FROM case_framework_bank WHERE id=1").get(), before);
    assert.deepEqual(copy.prepare("SELECT * FROM item_round_tags WHERE item_type='case_framework'").all(), tags);
    assert.ok(copy.prepare("SELECT 1 FROM case_legacy_answers WHERE case_id=1 AND answer='Legacy column'").get());
    assert.ok(copy.prepare("SELECT 1 FROM case_legacy_answers WHERE case_id=1 AND answer='Distinct metadata'").get());
    assert.ok(copy.prepare("SELECT 1 FROM case_legacy_answers WHERE case_id=1 AND answer='Legacy proof'").get());
  } finally { copy.close(); }
});

test("a failed legacy archive insert rolls back all migration content, DDL and completion markers", async () => {
  const legacy = new Database(path.join(directory, "failed-legacy-transaction.db"));
  legacy.pragma("foreign_keys=ON");
  legacy.exec(`CREATE TABLE case_framework_bank(id INTEGER PRIMARY KEY, understand TEXT, define TEXT);
    CREATE TABLE app_metadata(resource TEXT, record_id INTEGER, value TEXT, PRIMARY KEY(resource,record_id));
    CREATE TABLE case_legacy_answers(id INTEGER PRIMARY KEY, case_id INTEGER REFERENCES case_framework_bank(id), stage TEXT, source TEXT, answer TEXT, UNIQUE(case_id,stage,source,answer));
    INSERT INTO case_framework_bank VALUES(1,'First answer','Second answer');
    CREATE TRIGGER fail_archive BEFORE INSERT ON case_legacy_answers WHEN NEW.stage='define' BEGIN SELECT RAISE(FAIL,'injected migration failure'); END;`);
  try {
    await assert.rejects(preserveLegacyAnswers(legacy, directory), /injected migration failure/);
    assert.deepEqual(legacy.prepare("SELECT * FROM case_framework_bank").all(), [{ id: 1, understand: "First answer", define: "Second answer" }]);
    assert.deepEqual(legacy.prepare("SELECT * FROM case_legacy_answers").all(), []);
    assert.deepEqual(legacy.prepare("SELECT * FROM app_metadata").all(), []);
  } finally { legacy.close(); }
});

test("backup compatibility preserves unused legacy workspace columns without trusting arbitrary schema", async () => {
  const { copy } = await temporaryCopy();
  try {
    const legacyBackup = structuredClone(originalBackup);
    for (const row of legacyBackup.tables.workspaces) Object.assign(row, { interview_stage: "Earlier round", interview_date: "2024-05-01", interviewers: "Legacy text" });
    await createBackupService(copy, directory).restore(legacyBackup, generation(copy));
    assert.equal(copy.prepare("SELECT interviewers FROM workspaces WHERE id=1").get().interviewers, "Legacy text");
    // A current backup can also replace a database retaining unused old columns.
    await createBackupService(copy, directory).restore(originalBackup, generation(copy));
    assert.equal(copy.prepare("SELECT interview_stage FROM workspaces WHERE id=1").get().interview_stage, null);
    assert.equal(copy.prepare("SELECT count(*) n FROM story_bank").get().n, 2);
  } finally { copy.close(); }
});

test("reset is confirmed, backed up, atomic and creates exactly one empty opportunity", async () => {
  assert.equal((await request("/reset", { method: "POST" })).response.status, 400);
  const before = contents(exportDataset(db));
  const result = await request("/reset", { method: "POST", headers: { "X-Confirm-Replacement": "replace-all-workspaces" } });
  assert.equal(result.response.status, 200);
  const saved = new Database(result.value.recoveryPath, { readonly: true });
  assert.deepEqual(contents(exportDataset(saved)), before); saved.close();
  assert.equal(db.prepare("SELECT count(*) n FROM workspaces").get().n, 1);
  for (const table of TABLES.filter((name) => !["workspaces", "settings", "scheduling_machine", "app_metadata"].includes(name))) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  assert.doesNotThrow(() => validateBackup(db, exportDataset(db)));
});
