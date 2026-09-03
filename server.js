import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, databasePath } from "./db.js";

const app = express();
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "0.0.0.0";
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";

app.use(cors());
app.use(express.json({ limit: "20mb" }));

const jsonColumns = {
  settings: new Set(["interviewers"]),
  story_bank: new Set(["tags", "used_for"]),
  question_bank: new Set(),
  scheduling_machine: new Set(["architecture_notes", "ownership_stories"]),
  reliability_incidents: new Set(["tags"]),
  translation_map: new Set(),
  knowledge_items: new Set(["tags"]),
  interview_rounds: new Set(["interviewers"]),
};

function parseJson(value) {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeRow(table, row) {
  if (!row) return row;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    jsonColumns[table]?.has(key) ? parseJson(value) : value,
  ]));
}

function readMetadata(resource, recordId) {
  const row = db.prepare("SELECT value FROM app_metadata WHERE resource = ? AND record_id = ?").get(resource, recordId);
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeMetadata(resource, recordId, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  db.prepare(`
    INSERT INTO app_metadata (resource, record_id, value) VALUES (?, ?, ?)
    ON CONFLICT(resource, record_id) DO UPDATE SET value = excluded.value
  `).run(resource, recordId, JSON.stringify(value));
}

function deleteMetadata(resource, recordId) {
  db.prepare("DELETE FROM app_metadata WHERE resource = ? AND record_id = ?").run(resource, recordId);
}

function deleteImages(resource, recordId) {
  db.prepare("DELETE FROM item_images WHERE resource = ? AND record_id = ?").run(resource, recordId);
}

function withMetadata(table, resource, row) {
  if (!row) return row;
  return { ...serializeRow(table, row), _ui: readMetadata(resource, row.id) };
}

function sanitizeBody(table, columns, body) {
  return Object.fromEntries(columns
    .filter((column) => Object.prototype.hasOwnProperty.call(body, column))
    .map((column) => [
      column,
      jsonColumns[table]?.has(column) ? JSON.stringify(Array.isArray(body[column]) ? body[column] : []) : body[column],
    ]));
}

function sendNotFound(res, label = "Record") {
  return res.status(404).json({ error: `${label} not found` });
}

function registerCrudRoute(route, table, columns) {
  app.get(`/api/${route}`, (_req, res) => {
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
    res.json(rows.map((row) => withMetadata(table, route, row)));
  });

  app.get(`/api/${route}/:id`, (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!row) return sendNotFound(res);
    return res.json(withMetadata(table, route, row));
  });

  app.post(`/api/${route}`, (req, res) => {
    const values = sanitizeBody(table, columns, req.body || {});
    const keys = Object.keys(values);
    const result = keys.length
      ? db.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((key) => values[key]))
      : db.prepare(`INSERT INTO ${table} DEFAULT VALUES`).run();
    writeMetadata(route, Number(result.lastInsertRowid), req.body?._ui);
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(result.lastInsertRowid);
    res.status(201).json(withMetadata(table, route, row));
  });

  app.put(`/api/${route}/:id`, (req, res) => {
    const existing = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!existing) return sendNotFound(res);
    const values = sanitizeBody(table, columns, req.body || {});
    const keys = Object.keys(values);
    if (keys.length) {
      db.prepare(`UPDATE ${table} SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = ?`)
        .run(...keys.map((key) => values[key]), req.params.id);
    }
    writeMetadata(route, Number(req.params.id), req.body?._ui);
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    return res.json(withMetadata(table, route, row));
  });

  app.delete(`/api/${route}/:id`, (req, res) => {
    const result = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
    if (!result.changes) return sendNotFound(res);
    deleteMetadata(route, Number(req.params.id));
    deleteImages(route, Number(req.params.id));
    return res.status(204).end();
  });
}

const settingsColumns = ["company_name", "role_title", "interview_date", "interviewers"];
app.get("/api/settings", (_req, res) => {
  res.json(withMetadata("settings", "settings", db.prepare("SELECT * FROM settings WHERE id = 1").get()));
});
app.put("/api/settings", (req, res) => {
  const values = sanitizeBody("settings", settingsColumns, req.body || {});
  const keys = Object.keys(values);
  if (keys.length) {
    db.prepare(`UPDATE settings SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = 1`)
      .run(...keys.map((key) => values[key]));
  }
  writeMetadata("settings", 1, req.body?._ui);
  res.json(withMetadata("settings", "settings", db.prepare("SELECT * FROM settings WHERE id = 1").get()));
});

const workspaceColumns = ["company_name", "role_title"];
const roundColumns = ["label", "stage_type", "scheduled_date", "interviewers", "sequence_order", "status", "interviewer_notes", "questions_to_ask", "outcome_notes"];

function serializeRound(row) {
  return serializeRow("interview_rounds", row);
}

app.get("/api/workspaces", (_req, res) => {
  res.json(db.prepare("SELECT id, company_name, role_title, created_at FROM workspaces ORDER BY created_at, id").all());
});

app.post("/api/workspaces", (req, res) => {
  const values = sanitizeBody("workspaces", workspaceColumns, req.body || {});
  const result = db.prepare("INSERT INTO workspaces (company_name, role_title) VALUES (?, ?)")
    .run(values.company_name || "Untitled company", values.role_title || "");
  res.status(201).json(db.prepare("SELECT id, company_name, role_title, created_at FROM workspaces WHERE id = ?").get(result.lastInsertRowid));
});

app.get("/api/workspaces/:id", (req, res) => {
  const workspace = db.prepare("SELECT id, company_name, role_title, created_at FROM workspaces WHERE id = ?").get(req.params.id);
  if (!workspace) return sendNotFound(res, "Workspace");
  return res.json(workspace);
});

app.put("/api/workspaces/:id", (req, res) => {
  if (!db.prepare("SELECT id FROM workspaces WHERE id = ?").get(req.params.id)) return sendNotFound(res, "Workspace");
  const values = sanitizeBody("workspaces", workspaceColumns, req.body || {});
  const keys = Object.keys(values);
  if (keys.length) {
    db.prepare(`UPDATE workspaces SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = ?`)
      .run(...keys.map((key) => values[key]), req.params.id);
  }
  return res.json(db.prepare("SELECT id, company_name, role_title, created_at FROM workspaces WHERE id = ?").get(req.params.id));
});

app.delete("/api/workspaces/:id", (req, res) => {
  const result = db.prepare("DELETE FROM workspaces WHERE id = ?").run(req.params.id);
  if (!result.changes) return sendNotFound(res, "Workspace");
  return res.status(204).end();
});

app.get("/api/workspaces/:workspaceId/rounds", (req, res) => {
  if (!db.prepare("SELECT id FROM workspaces WHERE id = ?").get(req.params.workspaceId)) return sendNotFound(res, "Workspace");
  const rounds = db.prepare("SELECT * FROM interview_rounds WHERE workspace_id = ? ORDER BY sequence_order, id").all(req.params.workspaceId);
  return res.json(rounds.map(serializeRound));
});

app.post("/api/workspaces/:workspaceId/rounds", (req, res) => {
  if (!db.prepare("SELECT id FROM workspaces WHERE id = ?").get(req.params.workspaceId)) return sendNotFound(res, "Workspace");
  const values = sanitizeBody("interview_rounds", roundColumns, req.body || {});
  const nextOrder = db.prepare("SELECT coalesce(max(sequence_order), 0) + 1 AS value FROM interview_rounds WHERE workspace_id = ?").get(req.params.workspaceId).value;
  const result = db.prepare(`
    INSERT INTO interview_rounds
      (workspace_id, label, stage_type, scheduled_date, interviewers, sequence_order, status, interviewer_notes, questions_to_ask, outcome_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.workspaceId,
    values.label || `Round ${nextOrder}`,
    values.stage_type || "other",
    values.scheduled_date || "",
    values.interviewers || "[]",
    values.sequence_order ?? nextOrder,
    values.status || "upcoming",
    values.interviewer_notes || "",
    values.questions_to_ask || "",
    values.outcome_notes || "",
  );
  return res.status(201).json(serializeRound(db.prepare("SELECT * FROM interview_rounds WHERE id = ?").get(result.lastInsertRowid)));
});

app.get("/api/workspaces/:workspaceId/rounds/:id", (req, res) => {
  const round = db.prepare("SELECT * FROM interview_rounds WHERE id = ? AND workspace_id = ?").get(req.params.id, req.params.workspaceId);
  if (!round) return sendNotFound(res, "Interview round");
  return res.json(serializeRound(round));
});

app.put("/api/workspaces/:workspaceId/rounds/:id", (req, res) => {
  if (!db.prepare("SELECT id FROM interview_rounds WHERE id = ? AND workspace_id = ?").get(req.params.id, req.params.workspaceId)) return sendNotFound(res, "Interview round");
  const values = sanitizeBody("interview_rounds", roundColumns, req.body || {});
  const keys = Object.keys(values);
  if (keys.length) {
    db.prepare(`UPDATE interview_rounds SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = ? AND workspace_id = ?`)
      .run(...keys.map((key) => values[key]), req.params.id, req.params.workspaceId);
  }
  return res.json(serializeRound(db.prepare("SELECT * FROM interview_rounds WHERE id = ?").get(req.params.id)));
});

app.delete("/api/workspaces/:workspaceId/rounds/:id", (req, res) => {
  const result = db.prepare("DELETE FROM interview_rounds WHERE id = ? AND workspace_id = ?").run(req.params.id, req.params.workspaceId);
  if (!result.changes) return sendNotFound(res, "Interview round");
  return res.status(204).end();
});

registerCrudRoute("story-bank", "story_bank", ["module", "title", "tags", "situation", "task", "action", "result", "used_for", "status"]);
registerCrudRoute("question-bank", "question_bank", ["module", "sub_topic", "question", "my_answer", "status"]);
registerCrudRoute("reliability-incidents", "reliability_incidents", ["title", "what_broke", "how_found", "how_fixed", "what_changed_after", "tags"]);
registerCrudRoute("translation-map", "translation_map", ["scheduling_machine_pattern", "tempus_problem", "what_i_bring"]);
registerCrudRoute("knowledge-items", "knowledge_items", ["module", "term", "definition", "notes", "tags"]);

const schedulingColumns = ["overview", "architecture_notes", "ownership_stories", "scale_metrics", "lessons_learned"];
app.get("/api/scheduling-machine", (_req, res) => {
  res.json(withMetadata("scheduling_machine", "scheduling-machine", db.prepare("SELECT * FROM scheduling_machine WHERE id = 1").get()));
});
app.put("/api/scheduling-machine", (req, res) => {
  const values = sanitizeBody("scheduling_machine", schedulingColumns, req.body || {});
  const keys = Object.keys(values);
  if (keys.length) {
    db.prepare(`UPDATE scheduling_machine SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = 1`)
      .run(...keys.map((key) => values[key]));
  }
  writeMetadata("scheduling-machine", 1, req.body?._ui);
  res.json(withMetadata("scheduling_machine", "scheduling-machine", db.prepare("SELECT * FROM scheduling_machine WHERE id = 1").get()));
});

function getDrillTree(id) {
  const tree = db.prepare("SELECT * FROM drill_trees WHERE id = ?").get(id);
  if (!tree) return null;
  return {
    ...tree,
    _ui: readMetadata("drill-trees", tree.id),
    followups: db.prepare("SELECT * FROM drill_followups WHERE drill_tree_id = ? ORDER BY level, id").all(id),
  };
}

app.get("/api/drill-trees", (_req, res) => {
  const hasRoundFilter = Object.prototype.hasOwnProperty.call(_req.query, "round_id");
  const requestedRoundId = Number(_req.query.round_id);
  const trees = hasRoundFilter
    ? Number.isInteger(requestedRoundId) && requestedRoundId > 0
      ? db.prepare("SELECT * FROM drill_trees WHERE round_id IS NULL OR round_id = ? ORDER BY id").all(requestedRoundId)
      : db.prepare("SELECT * FROM drill_trees WHERE round_id IS NULL ORDER BY id").all()
    : db.prepare("SELECT * FROM drill_trees ORDER BY id").all();
  const followups = db.prepare("SELECT * FROM drill_followups ORDER BY level, id").all();
  const grouped = followups.reduce((map, row) => {
    const rows = map.get(row.drill_tree_id) || [];
    rows.push(row);
    map.set(row.drill_tree_id, rows);
    return map;
  }, new Map());
  res.json(trees.map((tree) => ({ ...tree, _ui: readMetadata("drill-trees", tree.id), followups: grouped.get(tree.id) || [] })));
});

app.get("/api/drill-trees/:id", (req, res) => {
  const tree = getDrillTree(req.params.id);
  if (!tree) return sendNotFound(res, "Drill tree");
  return res.json(tree);
});

const writeDrillTree = db.transaction((id, body) => {
  writeMetadata("drill-trees", id, body._ui);
  if (["module", "root_question", "round_id"].some((key) => Object.prototype.hasOwnProperty.call(body, key))) {
    const values = sanitizeBody("drill_trees", ["module", "root_question", "round_id"], body);
    const keys = Object.keys(values);
    if (keys.length) {
      db.prepare(`UPDATE drill_trees SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = ?`)
        .run(...keys.map((key) => values[key]), id);
    }
  }

  if (Array.isArray(body.followups)) {
    const existingIds = new Set(db.prepare("SELECT id FROM drill_followups WHERE drill_tree_id = ?").all(id).map((row) => row.id));
    const retainedIds = new Set();
    const insert = db.prepare("INSERT INTO drill_followups (drill_tree_id, level, question, my_answer, status) VALUES (?, ?, ?, ?, ?)");
    const update = db.prepare("UPDATE drill_followups SET level = ?, question = ?, my_answer = ?, status = ? WHERE id = ? AND drill_tree_id = ?");

    for (const followup of body.followups) {
      if (Number.isInteger(followup.id) && existingIds.has(followup.id)) {
        update.run(followup.level ?? 1, followup.question ?? "", followup.my_answer ?? "", followup.status ?? "not-started", followup.id, id);
        retainedIds.add(followup.id);
      } else {
        const result = insert.run(id, followup.level ?? 1, followup.question ?? "", followup.my_answer ?? "", followup.status ?? "not-started");
        retainedIds.add(Number(result.lastInsertRowid));
      }
    }

    for (const existingId of existingIds) {
      if (!retainedIds.has(existingId)) db.prepare("DELETE FROM drill_followups WHERE id = ?").run(existingId);
    }
  }
});

app.post("/api/drill-trees", (req, res) => {
  const roundId = Number.isInteger(req.body?.round_id) ? req.body.round_id : null;
  const result = db.prepare("INSERT INTO drill_trees (module, root_question, round_id) VALUES (?, ?, ?)")
    .run(req.body?.module ?? "", req.body?.root_question ?? "", roundId);
  writeDrillTree(Number(result.lastInsertRowid), req.body || {});
  res.status(201).json(getDrillTree(result.lastInsertRowid));
});

app.put("/api/drill-trees/:id", (req, res) => {
  if (!db.prepare("SELECT id FROM drill_trees WHERE id = ?").get(req.params.id)) return sendNotFound(res, "Drill tree");
  writeDrillTree(Number(req.params.id), req.body || {});
  return res.json(getDrillTree(req.params.id));
});

app.delete("/api/drill-trees/:id", (req, res) => {
  const result = db.prepare("DELETE FROM drill_trees WHERE id = ?").run(req.params.id);
  if (!result.changes) return sendNotFound(res, "Drill tree");
  deleteMetadata("drill-trees", Number(req.params.id));
  return res.status(204).end();
});

const supportedImageTypes = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["gif", "image/gif"],
  ["svg", "image/svg+xml"],
  ["heic", "image/heic"],
]);
const imageOwnerTables = new Map([
  ["story-bank", "story_bank"],
  ["question-bank", "question_bank"],
  ["scheduling-machine", "scheduling_machine"],
  ["reliability-incidents", "reliability_incidents"],
  ["translation-map", "translation_map"],
  ["knowledge-items", "knowledge_items"],
]);

function imageMetadata(row) {
  return {
    id: row.id,
    resource: row.resource,
    record_id: row.record_id,
    filename: row.filename,
    mime_type: row.mime_type,
    url: `/api/item-images/${row.id}`,
  };
}

app.get("/api/item-images", (req, res) => {
  const resource = req.query.resource ? String(req.query.resource) : null;
  const recordId = req.query.record_id ? Number(req.query.record_id) : null;
  const rows = resource && Number.isInteger(recordId)
    ? db.prepare("SELECT id, resource, record_id, filename, mime_type FROM item_images WHERE resource = ? AND record_id = ? ORDER BY id").all(resource, recordId)
    : db.prepare("SELECT id, resource, record_id, filename, mime_type FROM item_images ORDER BY id").all();
  res.json(rows.map(imageMetadata));
});

app.post("/api/item-images", (req, res) => {
  const { resource, record_id: recordId, filename, data } = req.body || {};
  const extension = String(filename || "").split(".").pop()?.toLowerCase();
  const mimeType = supportedImageTypes.get(extension);
  const ownerTable = imageOwnerTables.get(resource);
  if (!ownerTable || !Number.isInteger(recordId) || !filename || !mimeType || typeof data !== "string") {
    return res.status(400).json({ error: "A valid owner, filename, and supported image are required" });
  }
  if (!db.prepare(`SELECT id FROM ${ownerTable} WHERE id = ?`).get(recordId)) return sendNotFound(res, "Preparation item");
  const imageBuffer = Buffer.from(data, "base64");
  if (!imageBuffer.length || imageBuffer.length > 12 * 1024 * 1024) {
    return res.status(400).json({ error: "Images must be between 1 byte and 12 MB" });
  }
  const result = db.prepare("INSERT INTO item_images (resource, record_id, filename, mime_type, data) VALUES (?, ?, ?, ?, ?)")
    .run(resource, recordId, path.basename(filename), mimeType, imageBuffer);
  const row = db.prepare("SELECT id, resource, record_id, filename, mime_type FROM item_images WHERE id = ?").get(result.lastInsertRowid);
  return res.status(201).json(imageMetadata(row));
});

app.get("/api/item-images/:id", (req, res) => {
  const row = db.prepare("SELECT filename, mime_type, data FROM item_images WHERE id = ?").get(req.params.id);
  if (!row) return sendNotFound(res, "Image");
  res.set("Content-Type", row.mime_type);
  res.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`);
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Security-Policy", "sandbox; default-src 'none'");
  return res.send(row.data);
});

app.delete("/api/item-images/:id", (req, res) => {
  const result = db.prepare("DELETE FROM item_images WHERE id = ?").run(req.params.id);
  if (!result.changes) return sendNotFound(res, "Image");
  return res.status(204).end();
});

app.get("/api/search", (req, res) => {
  const query = String(req.query.q || "").trim();
  if (!query) return res.json([]);
  const pattern = `%${query}%`;
  const rows = db.prepare(`
    SELECT 'settings' AS module, id, 'settings' AS kind, company_name AS title,
      substr(trim(coalesce(company_name, '') || ' ' || coalesce(role_title, '') || ' ' || coalesce(interviewers, '')), 1, 180) AS snippet
    FROM settings WHERE company_name LIKE ? OR role_title LIKE ? OR interview_date LIKE ? OR interviewers LIKE ?
    UNION ALL
    SELECT module, id, 'story' AS kind, title,
      substr(trim(coalesce(title, '') || ' ' || coalesce(situation, '') || ' ' || coalesce(task, '') || ' ' || coalesce(action, '') || ' ' || coalesce(result, '')), 1, 180)
    FROM story_bank WHERE module LIKE ? OR title LIKE ? OR tags LIKE ? OR situation LIKE ? OR task LIKE ? OR action LIKE ? OR result LIKE ? OR used_for LIKE ?
    UNION ALL
    SELECT module, id, 'question' AS kind, question AS title,
      substr(trim(coalesce(question, '') || ' ' || coalesce(my_answer, '')), 1, 180)
    FROM question_bank WHERE module LIKE ? OR sub_topic LIKE ? OR question LIKE ? OR my_answer LIKE ?
    UNION ALL
    SELECT module, id, 'drill' AS kind, root_question AS title,
      substr(coalesce(root_question, ''), 1, 180)
    FROM drill_trees WHERE module LIKE ? OR root_question LIKE ?
    UNION ALL
    SELECT dt.module, dt.id, 'drill' AS kind, dt.root_question AS title,
      substr(trim(coalesce(df.question, '') || ' ' || coalesce(df.my_answer, '')), 1, 180)
    FROM drill_followups df JOIN drill_trees dt ON dt.id = df.drill_tree_id
    WHERE df.question LIKE ? OR df.my_answer LIKE ?
    UNION ALL
    SELECT 'scheduling-machine', id, 'note', 'Scheduling Machine',
      substr(trim(coalesce(overview, '') || ' ' || coalesce(architecture_notes, '') || ' ' || coalesce(ownership_stories, '') || ' ' || coalesce(scale_metrics, '') || ' ' || coalesce(lessons_learned, '')), 1, 180)
    FROM scheduling_machine WHERE overview LIKE ? OR architecture_notes LIKE ? OR ownership_stories LIKE ? OR scale_metrics LIKE ? OR lessons_learned LIKE ?
    UNION ALL
    SELECT 'platform-reliability', id, 'incident', title,
      substr(trim(coalesce(title, '') || ' ' || coalesce(what_broke, '') || ' ' || coalesce(how_found, '') || ' ' || coalesce(how_fixed, '') || ' ' || coalesce(what_changed_after, '')), 1, 180)
    FROM reliability_incidents WHERE title LIKE ? OR what_broke LIKE ? OR how_found LIKE ? OR how_fixed LIKE ? OR what_changed_after LIKE ? OR tags LIKE ?
    UNION ALL
    SELECT 'data-platform-translation', id, 'translation', 'Scheduling Machine translation',
      substr(trim(coalesce(scheduling_machine_pattern, '') || ' ' || coalesce(tempus_problem, '') || ' ' || coalesce(what_i_bring, '')), 1, 180)
    FROM translation_map WHERE scheduling_machine_pattern LIKE ? OR tempus_problem LIKE ? OR what_i_bring LIKE ?
    UNION ALL
    SELECT module, id, 'knowledge', term,
      substr(trim(coalesce(term, '') || ' ' || coalesce(definition, '') || ' ' || coalesce(notes, '')), 1, 180)
    FROM knowledge_items WHERE module LIKE ? OR term LIKE ? OR definition LIKE ? OR notes LIKE ? OR tags LIKE ?
    LIMIT 100
  `).all(...Array(39).fill(pattern));
  return res.json(rows);
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

if (isProduction) {
  app.use(express.static(path.join(projectRoot, "dist")));
  app.use((_req, res) => res.sendFile(path.join(projectRoot, "dist", "index.html")));
  app.listen(port, host, () => console.log(`Interview Prep Dashboard listening on http://${host}:${port}\nSQLite: ${databasePath}`));
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: "spa" });
  app.use(vite.middlewares);
  app.listen(port, host, () => console.log(`Interview Prep Dashboard listening on http://${host}:${port}\nSQLite: ${databasePath}`));
}
