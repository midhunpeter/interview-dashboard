import path from "node:path";
import { checkWrite, createBackupService, DataError, exportDataset, generation, RESOURCE_TABLES, revision, validateBackup } from "./reliability.js";

function identity(req) {
  const parts = req.path.split("/").filter(Boolean).slice(1);
  if (parts[0] === "workspaces" && parts[2] === "rounds") return { resource: "rounds", id: Number(parts[3]) };
  if (parts[0] === "prep-sections") return { resource: "prep-sections", id: Number(req.query.workspace_id) };
  return { resource: parts[0], id: Number(parts[1] || (["settings", "scheduling-machine"].includes(parts[0]) ? 1 : NaN)) };
}

// All current write handlers are synchronous SQLite operations. Register them
// inside a single IMMEDIATE transaction and defer their HTTP response until commit.
// This also makes metadata/followup/tag/image cleanup atomic with version checks.
export function installReliability(app, db, databasePath) {
  const service = createBackupService(db, process.env.RECOVERY_DIRECTORY || path.join(path.dirname(databasePath), "recovery"));
  app.use("/api", (req, res, next) => {
    res.set("X-Dataset-Generation", generation(db));
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/api/backup", (_req, res) => res.json(exportDataset(db)));
  app.post("/api/backup/preview", (req, res) => res.json(validateBackup(db, req.body)));
  app.post("/api/backup/restore", async (req, res) => {
    if (req.get("X-Confirm-Replacement") !== "replace-all-workspaces") throw new DataError("Explicit confirmation to replace all workspaces is required");
    const result = await service.restore(req.body, req.get("X-Dataset-Generation"));
    res.set("X-Dataset-Generation", result.generation).json(result);
  });
  app.post("/api/reset", async (req, res) => {
    if (req.get("X-Confirm-Replacement") !== "replace-all-workspaces") throw new DataError("Explicit confirmation to reset all workspaces is required");
    const empty = exportDataset(db);
    for (const table of Object.keys(empty.tables)) if (!["settings", "scheduling_machine", "workspaces", "app_metadata"].includes(table)) empty.tables[table] = [];
    empty.tables.workspaces = [{ ...empty.tables.workspaces[0], company_name: "New opportunity", role_title: "" }];
    for (const key of ["interview_stage", "interview_date", "interviewers"]) if (Object.hasOwn(empty.tables.workspaces[0], key)) empty.tables.workspaces[0][key] = null;
    empty.tables.app_metadata = empty.tables.app_metadata.filter((row) => row.resource === "migration");
    for (const table of ["settings", "scheduling_machine"]) for (const key of Object.keys(empty.tables[table][0])) if (key !== "id") empty.tables[table][0][key] = ["interviewers", "architecture_notes", "ownership_stories"].includes(key) ? "[]" : "";
    const result = await service.restore(empty, req.get("X-Dataset-Generation"));
    res.set("X-Dataset-Generation", result.generation).json(result);
  });

  app.use((req, res, next) => {
    const send = res.json.bind(res);
    res.json = (body) => {
      const { resource, id } = identity(req);
      if (RESOURCE_TABLES[resource] || resource === "prep-sections" || resource === "prep-items") {
        const decorate = (row) => {
          if (!row || row.error || row.id == null) return row;
          const recordResource = resource === "prep-items" ? row.itemType === "story" ? "story-bank" : "case-framework" : resource;
          return { ...row, _revision: revision(db, recordResource, resource === "prep-sections" ? id : row.id) };
        };
        body = Array.isArray(body) ? body.map(decorate) : decorate(body);
        if (Number.isSafeInteger(id)) res.set("X-Record-Revision", String(revision(db, resource, id)));
      }
      return send(body);
    };
    next();
  });
  const writes = {};
  for (const method of ["post", "put", "delete"]) {
    writes[method] = (route, handler) => app[method](route, (req, res, next) => {
      try {
        if (service.replacing) throw new DataError("A restore is in progress. Your draft has not been saved; retry after it completes.", 409, { code: "RESTORE_IN_PROGRESS" });
        const { resource, id } = identity(req);
        let imageOwner;
        const reply = { statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
        db.transaction(() => {
          checkWrite(db, req.get("X-Dataset-Generation"), resource, id, req.get("If-Match") == null ? null : Number(req.get("If-Match")), method === "post");
          if (resource === "item-images") {
            imageOwner = method === "post" ? { resource: req.body?.resource, record_id: req.body?.record_id } : db.prepare("SELECT resource,record_id FROM item_images WHERE id=?").get(id);
            if (imageOwner && RESOURCE_TABLES[imageOwner.resource] && Number.isSafeInteger(imageOwner.record_id)) checkWrite(db, req.get("X-Dataset-Generation"), imageOwner.resource, imageOwner.record_id, req.get("If-Match-Owner") == null ? null : Number(req.get("If-Match-Owner")));
          }
          handler(req, reply);
          if (reply.statusCode >= 400) throw new DataError(reply.body?.error || "Write failed", reply.statusCode);
        }).immediate();
        res.status(reply.statusCode);
        if (imageOwner) {
          res.set("X-Owner-Path", imageOwner.resource === "scheduling-machine" ? "/scheduling-machine" : `/${imageOwner.resource}/${imageOwner.record_id}`);
          res.set("X-Owner-Revision", String(revision(db, imageOwner.resource, imageOwner.record_id)));
        }
        return reply.body === undefined ? res.end() : res.json(reply.body);
      } catch (error) { next(error); }
    });
  }
  return writes;
}
