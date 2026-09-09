import Database from "better-sqlite3";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CASE_FRAMEWORK_STAGES } from "./caseFramework.js";

export const FORMAT = "interview-dashboard-complete";
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
export const TABLES = ["settings", "workspaces", "prep_sections", "interview_rounds", "story_bank", "case_framework_bank", "question_bank", "drill_trees", "drill_followups", "scheduling_machine", "reliability_incidents", "translation_map", "knowledge_items", "app_metadata", "item_round_tags", "item_images", "case_legacy_answers"];
export const RESOURCE_TABLES = {
  settings: "settings", workspaces: "workspaces", rounds: "interview_rounds",
  "story-bank": "story_bank", "case-framework": "case_framework_bank", "question-bank": "question_bank",
  "drill-trees": "drill_trees", "scheduling-machine": "scheduling_machine",
  "reliability-incidents": "reliability_incidents", "translation-map": "translation_map",
  "knowledge-items": "knowledge_items", "item-images": "item_images",
};
const TAG_TABLES = { story: "story_bank", case_framework: "case_framework_bank", question: "question_bank", reliability_incident: "reliability_incidents", translation_map: "translation_map", knowledge_item: "knowledge_items" };
const OPTIONAL_WORKSPACE_COLUMNS = ["interview_stage", "interview_date", "interviewers"];
function ensureLegacyWorkspaceColumns(db, tables) {
  const columns = new Set(db.prepare("PRAGMA table_info(workspaces)").all().map((c) => c.name));
  for (const key of OPTIONAL_WORKSPACE_COLUMNS) if (!columns.has(key) && tables.workspaces.some((row) => Object.hasOwn(row, key))) db.exec(`ALTER TABLE workspaces ADD COLUMN ${key} TEXT`);
}
export class DataError extends Error {
  constructor(message, status = 400, details = {}) { super(message); this.status = status; Object.assign(this, details); }
}

// SQLite's online backup API includes committed WAL pages. Verify the resulting file
// before permitting any destructive work; an ordinary file copy is never sufficient.
export async function recoveryBackup(db, directory, reason) {
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, `${reason}-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.db`);
  await db.backup(filename);
  const copy = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    if (copy.pragma("quick_check", { simple: true }) !== "ok") throw new Error("Recovery backup verification failed");
  } finally { copy.close(); }
  return filename;
}

export async function preserveLegacyAnswers(db, directory, backup = recoveryBackup) {
  const oldKeys = ["understand", "define", "solve", "prove"];
  const columns = new Set(db.prepare("PRAGMA table_info(case_framework_bank)").all().map((c) => c.name));
  const metadata = db.prepare("SELECT record_id, value FROM app_metadata WHERE resource = 'case-framework'").all();
  const legacy = [];
  for (const row of db.prepare("SELECT * FROM case_framework_bank").all()) {
    for (const key of oldKeys) if (typeof row[key] === "string") legacy.push([row.id, key, "Database column", row[key]]);
  }
  for (const row of metadata) {
    let value;
    try { value = JSON.parse(row.value); } catch { continue; }
    for (const key of oldKeys) if (typeof value?.content?.[key] === "string") legacy.push([row.record_id, key, "Application metadata", value.content[key]]);
  }
  const hasOldColumns = oldKeys.some((key) => columns.has(key));
  const done = db.prepare("SELECT 1 FROM app_metadata WHERE resource = 'migration' AND record_id = 3 AND value = ?").get("case-legacy-preservation-v1");
  if (done && !hasOldColumns) return;
  if (hasOldColumns || legacy.length) await backup(db, directory, "before-case-legacy-migration");
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS case_legacy_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES case_framework_bank(id) ON DELETE CASCADE,
      stage TEXT NOT NULL, source TEXT NOT NULL, answer TEXT NOT NULL,
      UNIQUE(case_id, stage, source, answer)
    )`);
    for (const { key } of CASE_FRAMEWORK_STAGES) if (!columns.has(key)) db.exec(`ALTER TABLE case_framework_bank ADD COLUMN ${key} TEXT`);
    const insert = db.prepare("INSERT OR IGNORE INTO case_legacy_answers (case_id, stage, source, answer) VALUES (?, ?, ?, ?)");
    for (const values of legacy) insert.run(...values);
    for (const key of oldKeys) if (columns.has(key)) db.exec(`ALTER TABLE case_framework_bank DROP COLUMN ${key}`);
    // Keep original metadata verbatim too. The archive is read-only and cannot be
    // lost when a later editor save replaces the item's UI metadata.
    db.prepare("INSERT INTO app_metadata (resource, record_id, value) VALUES ('migration', 3, ?) ON CONFLICT(resource, record_id) DO UPDATE SET value = excluded.value").run("case-legacy-preservation-v1");
  })();
}

export function initializeRevisions(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS dataset_state (id INTEGER PRIMARY KEY CHECK(id = 1), generation TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS record_versions (resource TEXT NOT NULL, record_id INTEGER NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(resource, record_id));`);
  db.prepare("INSERT OR IGNORE INTO dataset_state VALUES (1, ?)").run(randomUUID());
  const bump = (resource, id) => `INSERT INTO record_versions(resource, record_id, revision) VALUES (${resource}, ${id}, 1) ON CONFLICT(resource, record_id) DO UPDATE SET revision = revision + 1;`;
  const trigger = (table, suffix, statements) => {
    for (const event of ["INSERT", "UPDATE", "DELETE"]) {
      const ref = event === "DELETE" ? "OLD" : "NEW";
      db.exec(`CREATE TRIGGER IF NOT EXISTS rev_${table}_${suffix}_${event} AFTER ${event} ON ${table} BEGIN ${statements(ref, event)} END;`);
    }
  };
  for (const [resource, table] of Object.entries(RESOURCE_TABLES)) {
    db.prepare(`INSERT OR IGNORE INTO record_versions SELECT ?, id, 1 FROM ${table}`).run(resource);
    trigger(table, "record", (ref) => bump(`'${resource}'`, `${ref}.id`));
  }
  db.exec("INSERT OR IGNORE INTO record_versions SELECT 'prep-sections', id, 1 FROM workspaces");
  trigger("prep_sections", "sections", (ref) => bump("'prep-sections'", `${ref}.workspace_id`));
  trigger("app_metadata", "owner", (ref) => bump(`${ref}.resource`, `${ref}.record_id`));
  trigger("drill_followups", "owner", (ref) => bump("'drill-trees'", `${ref}.drill_tree_id`));
  trigger("case_legacy_answers", "owner", (ref) => bump("'case-framework'", `${ref}.case_id`));
  trigger("item_images", "owner", (ref) => bump(`${ref}.resource`, `${ref}.record_id`));
  const resourceCase = (ref) => `CASE ${ref}.item_type ${Object.entries(TAG_TABLES).map(([type, table]) => `WHEN '${type}' THEN '${Object.keys(RESOURCE_TABLES).find((r) => RESOURCE_TABLES[r] === table)}'`).join(" ")} END`;
  trigger("item_round_tags", "owner", (ref) => bump(resourceCase(ref), `${ref}.item_id`));
}

export const generation = (db) => db.prepare("SELECT generation FROM dataset_state WHERE id = 1").get().generation;
export const revision = (db, resource, id) => db.prepare("SELECT revision FROM record_versions WHERE resource = ? AND record_id = ?").get(resource, id)?.revision || 0;
export function checkWrite(db, token, resource, id, expected, creating = false) {
  if (token !== generation(db)) throw new DataError("The dataset was replaced. Keep or download your draft, then load the restored data.", 409, { code: "DATASET_CHANGED" });
  if (!creating && (!Number.isSafeInteger(expected) || expected !== revision(db, resource, id))) {
    throw new DataError("This record changed in another tab. Compare the saved version before choosing how to continue.", 409, { code: "REVISION_CONFLICT", resource, recordId: id, revision: revision(db, resource, id) });
  }
}

export function exportDataset(db) {
  return db.transaction(() => ({
    format: FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(),
    tables: Object.fromEntries(TABLES.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all().map((row) => table === "item_images" ? { ...row, data: row.data.toString("base64") } : row)])),
    sequences: db.prepare("SELECT name, seq FROM sqlite_sequence").all().filter((row) => TABLES.includes(row.name)),
  }))();
}

function insertTables(db, tables, onTable = () => {}) {
  for (const table of TABLES) {
    for (const row of tables[table]) {
      const keys = Object.keys(row);
      db.prepare(`INSERT INTO ${table} (${keys.map((key) => `"${key}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
        .run(...keys.map((key) => table === "item_images" && key === "data" ? Buffer.from(row[key], "base64") : row[key]));
    }
    onTable(table);
  }
}

export function validateBackup(db, input) {
  const fail = (message) => { throw new DataError(message); };
  if (input?.schemaVersion || input?.items) fail("This is an older browser-state export, not a complete backup. It may omit workspaces, rounds, hidden items and image bytes. Keep it for manual recovery; automatic replacement is not supported.");
  if (input?.format !== FORMAT || input?.version !== BACKUP_VERSION) fail("Unsupported backup format or version");
  if (typeof input.exportedAt !== "string" || !Number.isFinite(Date.parse(input.exportedAt))) fail("Invalid export timestamp");
  if (!input.tables || typeof input.tables !== "object" || Array.isArray(input.tables) || Object.keys(input.tables).length !== TABLES.length) fail("Backup must contain every dataset table");
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_BACKUP_BYTES) fail("Backup exceeds the 256 MB import limit");
  for (const table of TABLES) {
    if (!Array.isArray(input.tables[table])) fail(`Missing table: ${table}`);
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    for (const row of input.tables[table]) {
      if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some((key) => !columns.some((c) => c.name === key) && !(table === "workspaces" && OPTIONAL_WORKSPACE_COLUMNS.includes(key)))) fail(`Invalid ${table} record`);
      if (table === "workspaces") for (const key of OPTIONAL_WORKSPACE_COLUMNS) if (row[key] != null && typeof row[key] !== "string") fail(`Invalid type: workspaces.${key}`);
      for (const c of columns) {
        const value = row[c.name];
        if (value === undefined && table === "workspaces" && OPTIONAL_WORKSPACE_COLUMNS.includes(c.name)) continue;
        if (value === undefined) fail(`Missing ${table}.${c.name}`);
        if (value === null) { if (c.notnull || c.pk) fail(`Required ${table}.${c.name}`); continue; }
        if (c.type === "INTEGER" ? !Number.isSafeInteger(value) : typeof value !== "string") fail(`Invalid type: ${table}.${c.name}`);
        if ((c.name === "id" || c.name.endsWith("_id")) && c.type === "INTEGER" && value <= 0) fail(`Invalid identifier: ${table}.${c.name}`);
      }
      if (table === "app_metadata" && row.resource !== "migration") {
        try { const value = JSON.parse(row.value); if (!value || typeof value !== "object" || Array.isArray(value)) fail("Metadata must be a JSON object"); } catch { fail("Invalid metadata JSON"); }
      }
      for (const key of ["tags", "used_for", "interviewers", "architecture_notes", "ownership_stories"]) if (row[key] != null && row[key] !== "" && !(table === "workspaces" && key === "interviewers")) {
        try { if (!Array.isArray(JSON.parse(row[key]))) fail(`Invalid JSON array: ${table}.${key}`); } catch { fail(`Invalid JSON array: ${table}.${key}`); }
      }
      if (table === "item_images") {
        const bytes = Buffer.from(row.data, "base64");
        if (!bytes.length || bytes.length > 12 * 1024 * 1024 || bytes.toString("base64") !== row.data) fail("Invalid image base64 or size (maximum 12 MB per image)");
        const types = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", svg: "image/svg+xml", heic: "image/heic" };
        if (!row.filename || row.filename !== path.basename(row.filename) || types[row.filename.split(".").pop().toLowerCase()] !== row.mime_type) fail("Invalid image filename or MIME type");
        const signatures = {
          "image/png": () => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
          "image/jpeg": () => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
          "image/gif": () => ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii")),
          "image/svg+xml": () => /<svg(?:\s|>)/i.test(bytes.toString("utf8")),
          "image/heic": () => bytes.subarray(4, 8).toString("ascii") === "ftyp" && /hei[csx]|mif1/.test(bytes.subarray(8, 40).toString("ascii")),
        };
        if (!signatures[row.mime_type]?.()) fail("Image bytes do not match their MIME type");
      }
    }
  }
  for (const table of ["settings", "scheduling_machine"]) if (input.tables[table].length !== 1 || input.tables[table][0].id !== 1) fail(`Backup requires ${table} singleton`);
  if (!input.tables.workspaces.length) fail("Backup requires at least one workspace");
  const identifiers = Object.fromEntries(TABLES.map((table) => [table, new Set(input.tables[table].map((row) => row.id))]));
  const has = (table, id) => identifiers[table]?.has(id);
  for (const tag of input.tables.item_round_tags) if (!has(TAG_TABLES[tag.item_type], tag.item_id)) fail("Invalid round-tag item reference");
  for (const row of [...input.tables.item_images, ...input.tables.app_metadata.filter((r) => r.resource !== "migration")]) if (!has(RESOURCE_TABLES[row.resource], row.record_id)) fail(`Invalid ${row.resource} owner reference`);
  for (const row of input.tables.app_metadata.filter((r) => r.resource === "settings")) {
    const active = JSON.parse(row.value).activeWorkspaceId;
    if (active != null && !has("workspaces", active)) fail("Invalid active workspace reference");
  }
  for (const [id, marker] of [[1, "workspace-interview-rounds-v1"], [2, "workspace-prep-sections-v1"], [3, "case-legacy-preservation-v1"]]) {
    if (!input.tables.app_metadata.some((row) => row.resource === "migration" && row.record_id === id && row.value === marker)) fail(`Missing or unsupported migration marker ${id}`);
  }
  if (!Array.isArray(input.sequences)) fail("Missing identifier sequences");
  const names = new Set();
  for (const row of input.sequences) {
    if (!row || typeof row !== "object" || !TABLES.includes(row.name) || names.has(row.name) || !Number.isSafeInteger(row.seq) || row.seq < input.tables[row.name].reduce((max, r) => Math.max(max, r.id || 0), 0)) fail("Invalid identifier sequence");
    names.add(row.name);
  }
  // Reuse SQLite's own CHECK, UNIQUE, NOT NULL and FK rules in an isolated
  // validation database. No statements touch the live dataset in this phase.
  const candidate = new Database(":memory:");
  try {
    candidate.pragma("foreign_keys = ON");
    for (const table of TABLES) candidate.exec(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql);
    ensureLegacyWorkspaceColumns(candidate, input.tables);
    candidate.transaction(() => insertTables(candidate, input.tables))();
    if (candidate.pragma("foreign_key_check").length) fail("Invalid foreign key reference");
  } catch (error) { fail(`Backup validation failed: ${error.message}`); }
  finally { candidate.close(); }
  return { counts: Object.fromEntries(TABLES.map((table) => [table, input.tables[table].length])), imageBytes: input.tables.item_images.reduce((n, row) => n + Buffer.from(row.data, "base64").length, 0) };
}

export function createBackupService(db, directory, { backup = recoveryBackup, onTable } = {}) {
  let replacing = false;
  return {
    get replacing() { return replacing; },
    async restore(input, token) {
      if (replacing) throw new DataError("A restore is already in progress", 409);
      checkWrite(db, token, "", 0, 0, true);
      validateBackup(db, input);
      replacing = true;
      try {
        let recoveryPath;
        try { recoveryPath = await backup(db, directory, "before-restore"); }
        catch (error) { throw new DataError(`Recovery backup could not be created or verified. No data was replaced: ${error.message}`, 503); }
        db.transaction(() => {
          checkWrite(db, token, "", 0, 0, true);
          ensureLegacyWorkspaceColumns(db, input.tables);
          for (const table of [...TABLES].reverse()) db.exec(`DELETE FROM ${table}`);
          insertTables(db, input.tables, onTable);
          db.exec("DELETE FROM sqlite_sequence");
          for (const row of input.sequences) db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)").run(row.name, row.seq);
          if (db.pragma("foreign_key_check").length) throw new Error("Restored relationships failed validation");
          db.prepare("UPDATE dataset_state SET generation = ? WHERE id = 1").run(randomUUID());
        }).immediate();
        return { generation: generation(db), recoveryPath };
      } finally { replacing = false; }
    },
  };
}
