import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(projectRoot, "data");
fs.mkdirSync(dataDirectory, { recursive: true });

export const databasePath = path.join(dataDirectory, "interview-prep.db");
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
