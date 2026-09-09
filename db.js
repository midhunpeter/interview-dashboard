import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeRevisions, preserveLegacyAnswers } from "./reliability.js";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = process.env.DATABASE_PATH ? path.dirname(path.resolve(process.env.DATABASE_PATH)) : path.join(projectRoot, "data");
fs.mkdirSync(dataDirectory, { recursive: true });

export const databasePath = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(dataDirectory, "interview-prep.db");
export const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    company_name TEXT DEFAULT 'Tempus',
    role_title TEXT,
    interview_date TEXT,
    interviewers TEXT
  );

  CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT,
    role_title TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS prep_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    module_key TEXT NOT NULL,
    label TEXT NOT NULL,
    short TEXT,
    color TEXT,
    description TEXT,
    sequence_order INTEGER NOT NULL DEFAULT 0,
    is_builtin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(workspace_id, module_key)
  );

  CREATE INDEX IF NOT EXISTS idx_prep_sections_workspace ON prep_sections(workspace_id, sequence_order);

  CREATE TABLE IF NOT EXISTS interview_rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
    label TEXT,
    stage_type TEXT,
    scheduled_date TEXT,
    interviewers TEXT,
    sequence_order INTEGER,
    status TEXT DEFAULT 'upcoming',
    interviewer_notes TEXT,
    questions_to_ask TEXT,
    outcome_notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS item_round_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_type TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    round_id INTEGER NOT NULL REFERENCES interview_rounds(id) ON DELETE CASCADE,
    UNIQUE(item_type, item_id, round_id)
  );

  CREATE INDEX IF NOT EXISTS idx_item_round_tags_lookup ON item_round_tags(item_type, item_id);
  CREATE INDEX IF NOT EXISTS idx_item_round_tags_round ON item_round_tags(round_id);

  CREATE TABLE IF NOT EXISTS story_bank (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module TEXT,
    title TEXT,
    tags TEXT,
    situation TEXT,
    task TEXT,
    action TEXT,
    result TEXT,
    used_for TEXT,
    status TEXT DEFAULT 'not-started'
  );

  CREATE TABLE IF NOT EXISTS case_framework_bank (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
    module TEXT,
    title TEXT,
    tags TEXT,
    clarify TEXT,
    user_goal TEXT,
    pain_points TEXT,
    solutions TEXT,
    prioritize TEXT,
    success TEXT,
    risks_wrap TEXT,
    used_for TEXT,
    status TEXT DEFAULT 'not-started',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS question_bank (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module TEXT,
    sub_topic TEXT,
    question TEXT,
    my_answer TEXT,
    status TEXT DEFAULT 'not-started'
  );

  CREATE TABLE IF NOT EXISTS drill_trees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module TEXT,
    root_question TEXT
  );

  CREATE TABLE IF NOT EXISTS drill_followups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drill_tree_id INTEGER REFERENCES drill_trees(id) ON DELETE CASCADE,
    level INTEGER,
    question TEXT,
    my_answer TEXT,
    status TEXT DEFAULT 'not-started'
  );

  CREATE TABLE IF NOT EXISTS scheduling_machine (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    overview TEXT,
    architecture_notes TEXT,
    ownership_stories TEXT,
    scale_metrics TEXT,
    lessons_learned TEXT
  );

  CREATE TABLE IF NOT EXISTS reliability_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    what_broke TEXT,
    how_found TEXT,
    how_fixed TEXT,
    what_changed_after TEXT,
    tags TEXT
  );

  CREATE TABLE IF NOT EXISTS translation_map (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scheduling_machine_pattern TEXT,
    tempus_problem TEXT,
    what_i_bring TEXT
  );

  CREATE TABLE IF NOT EXISTS knowledge_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module TEXT,
    term TEXT,
    definition TEXT,
    notes TEXT,
    tags TEXT
  );

  CREATE TABLE IF NOT EXISTS app_metadata (
    resource TEXT NOT NULL,
    record_id INTEGER NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (resource, record_id)
  );

  CREATE TABLE IF NOT EXISTS item_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource TEXT NOT NULL,
    record_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    data BLOB NOT NULL
  );

  CREATE INDEX IF NOT EXISTS item_images_owner_idx ON item_images (resource, record_id);
`);

db.prepare(`
  INSERT OR IGNORE INTO settings (id, company_name, role_title, interview_date, interviewers)
  VALUES (1, 'Tempus', '', '', '[]')
`).run();

db.prepare(`
  INSERT OR IGNORE INTO scheduling_machine
    (id, overview, architecture_notes, ownership_stories, scale_metrics, lessons_learned)
  VALUES (1, '', '[]', '[]', '', '')
`).run();

const tableColumns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));

await preserveLegacyAnswers(db, process.env.RECOVERY_DIRECTORY || path.join(dataDirectory, "recovery"));

if (!tableColumns("drill_trees").has("round_id")) {
  db.exec("ALTER TABLE drill_trees ADD COLUMN round_id INTEGER REFERENCES interview_rounds(id) ON DELETE SET NULL");
}

const inferStageType = (label = "") => {
  const value = label.toLowerCase();
  if (value.includes("recruit")) return "recruiter_screen";
  if (value.includes("hiring") || value.includes("manager")) return "hiring_manager";
  if (value.includes("technical") || value.includes("panel")) return "technical_panel";
  if (value.includes("onsite") || value.includes("on-site")) return "onsite";
  if (value.includes("final")) return "final";
  if (value.includes("offer")) return "offer";
  return "other";
};

const migrationKey = "workspace-interview-rounds-v1";
const migrationComplete = db.prepare("SELECT 1 FROM app_metadata WHERE resource = 'migration' AND record_id = 1 AND value = ?").get(migrationKey);

if (!migrationComplete) {
  db.transaction(() => {
    const workspaceColumns = tableColumns("workspaces");
    if (workspaceColumns.has("interview_stage") || workspaceColumns.has("interview_date") || workspaceColumns.has("interviewers")) {
      const stageColumn = workspaceColumns.has("interview_stage") ? "interview_stage" : "NULL AS interview_stage";
      const dateColumn = workspaceColumns.has("interview_date") ? "interview_date" : "NULL AS interview_date";
      const interviewersColumn = workspaceColumns.has("interviewers") ? "interviewers" : "NULL AS interviewers";
      const legacyWorkspaces = db.prepare(`SELECT id, ${stageColumn}, ${dateColumn}, ${interviewersColumn} FROM workspaces`).all();
      const insertRound = db.prepare(`
        INSERT INTO interview_rounds (workspace_id, label, stage_type, scheduled_date, interviewers, sequence_order, status)
        VALUES (?, ?, ?, ?, ?, 1, 'upcoming')
      `);
      for (const workspace of legacyWorkspaces) {
        if (![workspace.interview_stage, workspace.interview_date, workspace.interviewers].some((value) => value != null && String(value).trim())) continue;
        const label = workspace.interview_stage || "Round 1";
        insertRound.run(workspace.id, label, inferStageType(label), workspace.interview_date || "", workspace.interviewers || "[]");
      }
    }

    let workspace = db.prepare("SELECT * FROM workspaces ORDER BY id LIMIT 1").get();
    if (!workspace) {
      const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get();
      const result = db.prepare("INSERT INTO workspaces (company_name, role_title) VALUES (?, ?)")
        .run(settings?.company_name || "Tempus", settings?.role_title || "");
      workspace = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(result.lastInsertRowid);

      let settingsUi = {};
      const metadata = db.prepare("SELECT value FROM app_metadata WHERE resource = 'settings' AND record_id = 1").get();
      try { settingsUi = metadata ? JSON.parse(metadata.value) : {}; } catch { settingsUi = {}; }
      const label = settingsUi.interviewStage || "Round 1";
      const hasLegacyRound = settings?.interview_date || (settings?.interviewers && settings.interviewers !== "[]") || settingsUi.interviewStage;
      if (hasLegacyRound) {
        db.prepare(`
          INSERT INTO interview_rounds (workspace_id, label, stage_type, scheduled_date, interviewers, sequence_order, status)
          VALUES (?, ?, ?, ?, ?, 1, 'upcoming')
        `).run(workspace.id, label, inferStageType(label), settings?.interview_date || "", settings?.interviewers || "[]");
      }
    }

    db.prepare(`
      INSERT INTO app_metadata (resource, record_id, value) VALUES ('migration', 1, ?)
      ON CONFLICT(resource, record_id) DO UPDATE SET value = excluded.value
    `).run(migrationKey);
  })();
}

initializeRevisions(db);

const legacyPrepSectionsMigrationKey = "workspace-prep-sections-v1";
const legacyPrepSectionsMigrationComplete = db.prepare("SELECT 1 FROM app_metadata WHERE resource = 'migration' AND record_id = 2 AND value = ?").get(legacyPrepSectionsMigrationKey);

if (!legacyPrepSectionsMigrationComplete) {
  db.transaction(() => {
    const defaultWorkspace = db.prepare("SELECT id FROM workspaces ORDER BY id LIMIT 1").get();
    const legacyBuiltins = [
      { id: "positioning", label: "Positioning", short: "PO", color: "#9e6a50", description: "Build a crisp story for why your background fits this team." },
      { id: "scheduling-machine", label: "Scheduling Machine", short: "SM", color: "#6c7f6b", description: "Show genuine technical ownership, decisions, scale, and lessons." },
      { id: "pm-depth", label: "Technical PM Depth", short: "TP", color: "#5d7397", description: "Prepare for deep questions on APIs, data, rules, and integrations." },
      { id: "platform-reliability", label: "Platform Reliability", short: "PR", color: "#8c6c87", description: "Practice operational maturity, integrity, and observability." },
      { id: "internal-platform-pm", label: "Internal Platform PM", short: "IP", color: "#82714d", description: "Frame other teams as customers and prove adoption thinking." },
      { id: "healthcare-interoperability", label: "Healthcare Interop", short: "HI", color: "#477a75", description: "Review standards, workflows, regulation, and domain examples." },
      { id: "data-platform-translation", label: "Data Platform Translation", short: "DT", color: "#936251", description: "Map Scheduling Machine lessons to Tempus platform problems." },
      { id: "hiring-manager-simulation", label: "HM Simulation", short: "HM", color: "#606a88", description: "Rehearse progressive technical drilling and follow-up pressure." },
    ];
    const builtinKeys = new Set(legacyBuiltins.map((section) => section.id));
    const settingsMetadataRow = db.prepare("SELECT value FROM app_metadata WHERE resource = 'settings' AND record_id = 1").get();
    let settingsMetadata = {};
    try { settingsMetadata = settingsMetadataRow ? JSON.parse(settingsMetadataRow.value) : {}; } catch { settingsMetadata = {}; }
    const legacySections = Array.isArray(settingsMetadata.preparationModules) && settingsMetadata.preparationModules.length
      ? settingsMetadata.preparationModules
      : legacyBuiltins;

    if (defaultWorkspace && db.prepare("SELECT count(*) AS count FROM prep_sections").get().count === 0) {
      const insertSection = db.prepare(`
        INSERT OR IGNORE INTO prep_sections
          (workspace_id, module_key, label, short, color, description, sequence_order, is_builtin)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      legacySections.forEach((section, index) => insertSection.run(
        defaultWorkspace.id,
        section.id,
        section.label || "Untitled section",
        section.short || "",
        section.color || "#4f7b68",
        section.description || "",
        index,
        builtinKeys.has(section.id) ? 1 : 0,
      ));
    }

    if (Object.prototype.hasOwnProperty.call(settingsMetadata, "preparationModules") || Object.prototype.hasOwnProperty.call(settingsMetadata, "customModules")) {
      delete settingsMetadata.preparationModules;
      delete settingsMetadata.customModules;
      db.prepare("UPDATE app_metadata SET value = ? WHERE resource = 'settings' AND record_id = 1").run(JSON.stringify(settingsMetadata));
    }
    db.prepare(`
      INSERT INTO app_metadata (resource, record_id, value) VALUES ('migration', 2, ?)
      ON CONFLICT(resource, record_id) DO UPDATE SET value = excluded.value
    `).run(legacyPrepSectionsMigrationKey);
  })();
}
