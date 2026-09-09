import { CASE_FRAMEWORK_STAGES } from "../caseFramework.js";

export const SCHEMA_VERSION = 1;

export const STATUSES = [
  { value: "not-started", label: "Not started", weight: 0 },
  { value: "reviewed", label: "Reviewed", weight: 0.5 },
  { value: "confident", label: "Confident", weight: 1 },
];

export const createId = () => globalThis.crypto?.randomUUID?.()
  || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export function createInitialData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    workspaces: [{ id: 1, companyName: "Tempus", roleTitle: "", createdAt: "" }],
    activeWorkspaceId: 1,
    rounds: [],
    settings: {
      companyName: "Tempus",
      roleTitle: "",
      interviewDate: "",
      interviewStage: "Hiring manager interview",
      interviewers: [],
      preparationModules: [],
    },
    items: [],
    drillTrees: [],
  };
}

const itemIdentities = new Map();
const treeIdentities = new Map();
const followupIdentities = new Map();
const imageOwners = new Map();
const versions = new Map();
const baselines = new Map();
const pending = new Map();
let datasetGeneration;
let epoch = 0;
let running;
let blocked;
let initialLoadPromise;

function hasPendingPath(path) {
  return [...pending.values()].some((job) => {
    if (job.path === path) return true;
    if (job.kind === "item") {
      const identity = itemIdentities.get(job.value.id);
      return identity && path === (identity.resource === "scheduling-machine" ? "/scheduling-machine" : `/${identity.resource}/${identity.dbId}`);
    }
    return job.kind === "tree" && path === `/drill-trees/${treeIdentities.get(job.value.id)}`;
  });
}

async function api(path, options = {}) {
  const requestEpoch = epoch;
  const method = options.method || "GET";
  const writing = method !== "GET" && !path.endsWith("/preview");
  if (writing && blocked) throw blocked;
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers };
  if (writing) {
    headers["X-Dataset-Generation"] = datasetGeneration;
    if (method === "PUT" || method === "DELETE") headers["If-Match"] = String(versions.get(path) ?? -1);
    if (options.ownerPath) headers["If-Match-Owner"] = String(versions.get(options.ownerPath) ?? -1);
  }
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (requestEpoch !== epoch) throw new Error("Ignored a response from an earlier dataset");
  const token = response.headers.get("X-Dataset-Generation");
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  const responseRevision = response.headers.get("X-Record-Revision");
  if (responseRevision != null) options.onRevision?.(Number(responseRevision));
  if (!response.ok) {
    const error = Object.assign(new Error(payload.error || `Request failed (${response.status})`), payload, { path, options, status: response.status,
      comparisonPath: options.ownerPath && payload.resource !== "item-images" ? options.ownerPath : path,
    });
    if (response.status === 409) publishConflict(error);
    throw error;
  }
  if (!options.allowGenerationChange && datasetGeneration && token && token !== datasetGeneration) {
    const error = Object.assign(new Error("The dataset was replaced. Your unsaved draft is still available below."), { code: "DATASET_CHANGED", path, options, status: 409 });
    publishConflict(error);
    throw error;
  }
  if (!datasetGeneration) datasetGeneration = token;
  if (options.track !== false) {
    const ownerPath = response.headers.get("X-Owner-Path");
    if (ownerPath) versions.set(ownerPath, Number(response.headers.get("X-Owner-Revision")));
    const recordVersion = response.headers.get("X-Record-Revision");
    if (recordVersion != null && (writing || !hasPendingPath(path))) versions.set(path, Number(recordVersion));
    const base = path.split("?")[0];
    for (const row of Array.isArray(payload) ? payload : [payload]) {
      if (row?._revision == null) continue;
      if (base === "/item-images" && row.resource) imageOwners.set(row.id, row.resource === "scheduling-machine" ? "/scheduling-machine" : `/${row.resource}/${row.record_id}`);
      const resource = base === "/prep-items" ? row.itemType === "story" ? "/story-bank" : "/case-framework" : base;
      const rowPath = base === "/prep-sections" || ["/settings", "/scheduling-machine"].includes(base) || /\/\d+$/.test(base) ? path : `${resource}/${row.id}`;
      if (writing || !hasPendingPath(rowPath)) versions.set(rowPath, row._revision);
    }
  }
  return payload;
}

function publishConflict(error) {
  blocked = error;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("data-conflict", { detail: error }));
}

export const getUnsavedDrafts = () => ({ capturedAt: timestamp(), operations: [...pending.values()], conflict: blocked ? { path: blocked.path, method: blocked.options.method, draft: blocked.options.body } : null });
export async function latestConflictVersion(error) {
  if (error.code === "DATASET_CHANGED") return { message: "All workspaces were replaced. Download your draft before loading the new dataset. Retrying a pre-restore write is not allowed." };
  const path = error.path === "/convert-item" ? `/${error.options.body.source}/${error.options.body.id}` : error.comparisonPath || error.path;
  try { return await api(path, { track: false, onRevision: (value) => { error.latestRevision = value; } }); }
  catch (failure) { if (failure.status === 404) return { deleted: true, message: "This record was deleted by another client." }; throw failure; }
}

const timestamp = () => new Date().toISOString();
const baseItem = (resource, row, fields) => {
  const ui = row._ui || {};
  return {
    id: `${resource}:${row.id}`,
    type: "note",
    module: "",
    title: "Untitled prep item",
    tags: [],
    status: "not-started",
    priority: "medium",
    starred: false,
    sortOrder: row.id,
    createdAt: timestamp(),
    updatedAt: timestamp(),
    content: { notes: "" },
    ...fields,
    ...ui,
    content: { ...(ui.content || {}), ...(fields.content || { notes: "" }) },
    id: `${resource}:${row.id}`,
    roundIds: Array.isArray(row.roundIds) ? row.roundIds : [],
    legacyAnswers: row.legacyAnswers?.length ? row.legacyAnswers : ui.legacyAnswers || [],
  };
};

function rememberItem(item, resource, dbId) {
  itemIdentities.set(item.id, { resource, dbId });
  if (!pending.has(`item:${item.id}`)) baselines.set(`item:${item.id}`, itemPayload(item, resource));
  return item;
}

function rowsToItems({ stories, caseFrameworks = [], questions, scheduling, incidents, translations, knowledge, images }) {
  const items = [
    ...stories.map((row) => rememberItem(baseItem("story-bank", row, {
      type: "story",
      itemType: "story",
      module: row.module || "",
      title: row.title || "Untitled story",
      tags: row.tags || [],
      usedFor: row.used_for || [],
      status: row.status || "not-started",
      content: {
        situation: row.situation || "",
        task: row.task || "",
        action: row.action || "",
        result: row.result || "",
      },
    }), "story-bank", row.id)),
    ...caseFrameworks.map((row) => rememberItem(baseItem("case-framework", row, {
      type: "case-framework",
      itemType: "case_framework",
      workspaceId: row.workspace_id,
      module: row.module || "",
      title: row.title || "Untitled case framework",
      tags: row.tags || [],
      usedFor: row.used_for || [],
      status: row.status || "not-started",
      createdAt: row.created_at || timestamp(),
      content: Object.fromEntries(CASE_FRAMEWORK_STAGES.map(({ key }) => [key, row[key] || ""])),
    }), "case-framework", row.id)),
    ...questions.map((row) => rememberItem(baseItem("question-bank", row, {
      type: "question",
      module: row.module || "",
      title: row.question || "Untitled question",
      status: row.status || "not-started",
      content: { notes: row.my_answer || "" },
    }), "question-bank", row.id)),
    ...incidents.map((row) => rememberItem(baseItem("reliability-incidents", row, {
      type: "incident",
      module: "platform-reliability",
      title: row.title || "Untitled incident",
      tags: row.tags || [],
      content: {
        whatBroke: row.what_broke || "",
        howFound: row.how_found || "",
        howFixed: row.how_fixed || "",
        whatChangedAfter: row.what_changed_after || "",
      },
    }), "reliability-incidents", row.id)),
    ...translations.map((row) => rememberItem(baseItem("translation-map", row, {
      type: "translation",
      module: "data-platform-translation",
      title: "Scheduling Machine translation",
      content: {
        notes: "",
        schedulingMachinePattern: row.scheduling_machine_pattern || "",
        tempusProblem: row.tempus_problem || "",
        whatIBring: row.what_i_bring || "",
      },
    }), "translation-map", row.id)),
    ...knowledge.map((row) => rememberItem(baseItem("knowledge-items", row, {
      type: "knowledge",
      module: row.module || "",
      title: row.term || "Untitled knowledge item",
      tags: row.tags || [],
      content: { definition: row.definition || "", notes: row.notes || "" },
    }), "knowledge-items", row.id)),
  ];

  items.push(rememberItem(baseItem("scheduling-machine", scheduling, {
    module: "scheduling-machine",
    title: "Platform overview and scale",
    priority: "high",
    starred: true,
    content: {
      overview: scheduling.overview || "",
      architectureNotes: scheduling.architecture_notes || [],
      ownershipStories: scheduling.ownership_stories || [],
      scaleMetrics: scheduling.scale_metrics || "",
      lessonsLearned: scheduling.lessons_learned || "",
    },
  }), "scheduling-machine", 1));
  const imagesByOwner = images.reduce((map, image) => {
    const key = `${image.resource}:${image.record_id}`;
    map.set(key, [...(map.get(key) || []), image]);
    return map;
  }, new Map());
  for (const item of items) {
    const identity = itemIdentities.get(item.id);
    item.images = identity ? imagesByOwner.get(`${identity.resource}:${identity.dbId}`) || [] : [];
  }
  return items;
}

function rowToTree(row) {
  const treeId = `drill-trees:${row.id}`;
  const rootId = `${treeId}:root`;
  const ui = row._ui || {};
  const rootNode = ui.rootNode || {};
  const nodes = [{
    id: rootId,
    parentId: null,
    level: 0,
    question: rootNode.question || row.root_question || "Root question",
    myAnswer: rootNode.myAnswer || "",
    status: rootNode.status || "not-started",
    sortOrder: 0,
  }];
  for (const followup of row.followups || []) {
    const nodeId = `${treeId}:followup:${followup.id}`;
    followupIdentities.set(`${treeId}:${nodeId}`, followup.id);
    nodes.push({
      id: nodeId,
      parentId: nodes.at(-1)?.id || rootId,
      level: followup.level ?? nodes.length,
      question: followup.question || "",
      myAnswer: followup.my_answer || "",
      status: followup.status || "not-started",
      sortOrder: followup.level ?? nodes.length,
    });
  }
  treeIdentities.set(treeId, row.id);
  const tree = {
    id: treeId,
    module: row.module || "",
    roundId: row.round_id ?? null,
    title: ui.title || row.root_question || "Untitled drill tree",
    tags: ui.tags || [],
    priority: ui.priority || "high",
    starred: ui.starred ?? true,
    sortOrder: ui.sortOrder ?? row.id,
    createdAt: ui.createdAt || timestamp(),
    updatedAt: ui.updatedAt || timestamp(),
    quickReviewNotes: ui.quickReviewNotes || "",
    nodes,
  };
  if (!pending.has(`tree:${treeId}`)) baselines.set(`tree:${treeId}`, drillPayload(tree));
  return tree;
}

async function loadDatabaseData() {
  const [settings, workspacesResponse] = await Promise.all([
    api("/settings"),
    api("/workspaces"),
  ]);
  const workspaces = workspacesResponse.map((workspace) => ({
    id: workspace.id,
    companyName: workspace.company_name || "Untitled company",
    roleTitle: workspace.role_title || "",
    createdAt: workspace.created_at || "",
  }));
  const requestedWorkspaceId = Number(settings._ui?.activeWorkspaceId);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === requestedWorkspaceId) || workspaces[0] || null;
  const [prepSectionsResponse, prepItems, roundsResponse, questions, trees, scheduling, incidents, translations, knowledge, images] = await Promise.all([
    activeWorkspace ? api(`/prep-sections?workspace_id=${activeWorkspace.id}`) : Promise.resolve([]),
    activeWorkspace ? api(`/prep-items?workspace_id=${activeWorkspace.id}`) : Promise.resolve([]),
    activeWorkspace ? api(`/workspaces/${activeWorkspace.id}/rounds`) : Promise.resolve([]),
    api("/question-bank"),
    api("/drill-trees"),
    api("/scheduling-machine"),
    api("/reliability-incidents"),
    api("/translation-map"),
    api("/knowledge-items"),
    api("/item-images"),
  ]);
  const stories = prepItems.filter((item) => item.itemType === "story");
  const caseFrameworks = prepItems.filter((item) => item.itemType === "case_framework");
  const rounds = roundsResponse.map(roundFromApi);
  const data = {
    schemaVersion: SCHEMA_VERSION,
    workspaces,
    activeWorkspaceId: activeWorkspace?.id ?? null,
    rounds,
    settings: {
      companyName: activeWorkspace?.companyName || "Tempus",
      roleTitle: activeWorkspace?.roleTitle || "",
      interviewDate: "",
      interviewStage: "",
      interviewers: [],
      preparationModules: prepSectionsResponse.map(prepSectionFromApi),
    },
    items: rowsToItems({ stories, caseFrameworks, questions, scheduling, incidents, translations, knowledge, images }),
    drillTrees: trees.map(rowToTree),
  };

  if (!pending.has("settings")) baselines.set("settings", { _ui: { activeWorkspaceId: data.activeWorkspaceId } });
  const sectionsKey = `sections:${data.activeWorkspaceId}`;
  if (!pending.has(sectionsKey)) baselines.set(sectionsKey, { sections: data.settings.preparationModules });
  return data;
}

export function loadData() {
  if (!initialLoadPromise) initialLoadPromise = loadDatabaseData();
  return initialLoadPromise;
}

export async function loadRoundFilteredContent(roundId = null, workspaceId = null) {
  const roundQuery = Number.isInteger(roundId) && roundId > 0 ? `&round_id=${roundId}` : "";
  const query = Number.isInteger(roundId) && roundId > 0 ? `?round_id=${roundId}` : "";
  const [prepItems, questions, trees, scheduling, incidents, translations, knowledge, images] = await Promise.all([
    api(`/prep-items?workspace_id=${workspaceId}${roundQuery}`),
    api(`/question-bank${query}`),
    api(`/drill-trees${query}`),
    api("/scheduling-machine"),
    api(`/reliability-incidents${query}`),
    api(`/translation-map${query}`),
    api(`/knowledge-items${query}`),
    api("/item-images"),
  ]);
  const stories = prepItems.filter((item) => item.itemType === "story");
  const caseFrameworks = prepItems.filter((item) => item.itemType === "case_framework");
  return {
    items: rowsToItems({ stories, caseFrameworks, questions, scheduling, incidents, translations, knowledge, images }),
    drillTrees: trees.map(rowToTree),
  };
}

function resourceForItem(item) {
  if (itemIdentities.get(item.id)?.resource === "scheduling-machine") return "scheduling-machine";
  if (item.type === "story") return "story-bank";
  if (item.type === "case-framework") return "case-framework";
  if (item.type === "question" || item.type === "pitch" || item.type === "open-question") return "question-bank";
  if (item.type === "incident") return "reliability-incidents";
  if (item.type === "translation") return "translation-map";
  return "knowledge-items";
}

function itemPayload(item, resource) {
  const notes = item.content?.notes || "";
  const _ui = {
    type: item.type,
    module: item.module,
    title: item.title,
    tags: item.tags || [],
    status: item.status,
    priority: item.priority,
    starred: item.starred,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    content: item.content || { notes: "" },
    ...(item.legacyAnswers?.length ? { legacyAnswers: item.legacyAnswers } : {}),
  };
  if (resource === "story-bank") return {
    module: item.module,
    title: item.title,
    tags: item.tags || [],
    situation: item.content?.situation || "",
    task: item.content?.task || "",
    action: item.content?.action ?? notes,
    result: item.content?.result || "",
    used_for: item.usedFor || [],
    status: item.status,
    roundIds: item.roundIds || [],
    _ui,
  };
  if (resource === "case-framework") return {
    workspace_id: item.workspaceId,
    module: item.module,
    title: item.title,
    tags: item.tags || [],
    ...Object.fromEntries(CASE_FRAMEWORK_STAGES.map(({ key }) => [key, item.content?.[key] || ""])),
    used_for: item.usedFor || [],
    status: item.status,
    roundIds: item.roundIds || [],
    _ui,
  };
  if (resource === "question-bank") return { module: item.module, sub_topic: item.title, question: item.title, my_answer: notes, status: item.status, roundIds: item.roundIds || [], _ui };
  if (resource === "reliability-incidents") return {
    title: item.title,
    what_broke: item.content?.whatBroke ?? notes,
    how_found: item.content?.howFound || "",
    how_fixed: item.content?.howFixed || "",
    what_changed_after: item.content?.whatChangedAfter || "",
    tags: item.tags || [],
    roundIds: item.roundIds || [],
    _ui,
  };
  if (resource === "translation-map") return {
    scheduling_machine_pattern: item.content?.schedulingMachinePattern || "",
    tempus_problem: item.content?.tempusProblem || "",
    what_i_bring: item.content?.whatIBring || "",
    roundIds: item.roundIds || [],
    _ui,
  };
  if (resource === "scheduling-machine") return {
    overview: item.content?.overview ?? notes,
    architecture_notes: item.content?.architectureNotes || [],
    ownership_stories: item.content?.ownershipStories || [],
    scale_metrics: item.content?.scaleMetrics || "",
    lessons_learned: item.content?.lessonsLearned || "",
    _ui,
  };
  return {
    module: item.module,
    term: item.title,
    definition: item.content?.definition ?? notes,
    notes: item.content?.definition == null ? "" : notes,
    tags: item.tags || [],
    roundIds: item.roundIds || [],
    _ui,
  };
}

async function deleteItemResource({ resource, dbId }) {
  if (resource === "scheduling-machine") return api("/scheduling-machine", { method: "PUT", body: { overview: "", architecture_notes: [], ownership_stories: [], scale_metrics: "", lessons_learned: "" } });
  return api(`/${resource}/${dbId}`, { method: "DELETE" });
}

function drillPayload(tree) {
  return {
    module: tree.module,
    round_id: tree.roundId ?? null,
    root_question: tree.title || tree.nodes[0]?.question || "Root question",
    _ui: {
      title: tree.title,
      tags: tree.tags || [],
      priority: tree.priority,
      starred: tree.starred,
      sortOrder: tree.sortOrder,
      createdAt: tree.createdAt,
      updatedAt: tree.updatedAt,
      quickReviewNotes: tree.quickReviewNotes || "",
      rootNode: tree.nodes[0] || null,
    },
    followups: tree.nodes.slice(1).map((node) => ({
      id: followupIdentities.get(`${tree.id}:${node.id}`),
      level: node.level,
      question: node.question,
      my_answer: node.myAnswer,
      status: node.status,
    })),
  };
}

function rememberFollowupResponses(tree, response) {
  tree.nodes.slice(1).forEach((node, index) => {
    const persisted = response.followups?.[index];
    if (persisted) followupIdentities.set(`${tree.id}:${node.id}`, persisted.id);
  });
}

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function changedFields(before, after) {
  if (!before) return after;
  return Object.fromEntries(Object.entries(after).filter(([key, value]) => !equal(before[key], value)).map(([key, value]) => [key,
    key === "_ui" ? Object.fromEntries(Object.entries(value).filter(([field, v]) => !equal(before._ui?.[field], v)).map(([field, v]) => [field, field === "content" ? changedFields(before._ui?.content, v) : v])) : value,
  ]));
}

function enqueue(key, job, payload) {
  if (pending.get(key)?.deleted) return;
  // A newer snapshot replaces only this identity's queued draft. Hidden items
  // remain in this map; absence from a view never means deletion.
  if (!equal(baselines.get(key), payload) || pending.has(key)) pending.set(key, { ...job, payload });
}

export function queueItemDeletion(item) { pending.set(`item:${item.id}`, { kind: "item", value: item, deleted: true }); }
export function queueTreeDeletion(tree) { pending.set(`tree:${tree.id}`, { kind: "tree", value: tree, deleted: true }); }

async function persistJob(key, job) {
  if (job.kind === "item") {
    const item = job.value;
    const identity = itemIdentities.get(item.id);
    if (job.deleted) {
      if (identity) await deleteItemResource(identity);
      itemIdentities.delete(item.id);
      baselines.delete(key);
      return;
    }
    const resource = resourceForItem(item);
    const body = itemPayload(item, resource);
    let response;
    if (identity && identity.resource !== resource) {
      const oldPath = `/${identity.resource}/${identity.dbId}`;
      response = await api("/convert-item", { method: "POST", body: { source: identity.resource, id: identity.dbId, expectedRevision: versions.get(oldPath), target: resource, item: body } });
      itemIdentities.set(item.id, { resource, dbId: response.id });
      versions.set(`/${resource}/${response.id}`, response._revision);
      if (item.images?.length) await api(`/item-images?resource=${resource}&record_id=${response.id}`);
    } else if (identity) {
      const delta = changedFields(baselines.get(key), body);
      if (Object.keys(delta).length) response = await api(resource === "scheduling-machine" ? "/scheduling-machine" : `/${resource}/${identity.dbId}`, { method: "PUT", body: delta });
    } else {
      response = await api(`/${resource}`, { method: "POST", body });
      itemIdentities.set(item.id, { resource, dbId: response.id });
    }
    baselines.set(key, body);
  } else if (job.kind === "tree") {
    const tree = job.value;
    const id = treeIdentities.get(tree.id);
    if (job.deleted) {
      if (id) await api(`/drill-trees/${id}`, { method: "DELETE" });
      treeIdentities.delete(tree.id);
      baselines.delete(key);
      return;
    }
    const body = drillPayload(tree);
    const delta = changedFields(baselines.get(key), body);
    if (!id || Object.keys(delta).length) {
      const response = await api(id ? `/drill-trees/${id}` : "/drill-trees", { method: id ? "PUT" : "POST", body: id ? delta : body });
      treeIdentities.set(tree.id, response.id);
      rememberFollowupResponses(tree, response);
    }
    baselines.set(key, drillPayload(tree));
  } else {
    const delta = changedFields(baselines.get(key), job.payload);
    if (Object.keys(delta).length) await api(job.path, { method: "PUT", body: delta });
    baselines.set(key, job.payload);
  }
}

async function drain() {
  if (blocked) throw blocked;
  if (running) return running;
  const operationEpoch = epoch;
  running = (async () => {
    // Yield once so running is assigned even when there are no pending jobs.
    await Promise.resolve();
    while (pending.size) {
      const [key, job] = pending.entries().next().value;
      if (operationEpoch !== epoch) throw new Error("Save queue invalidated by dataset replacement");
      try { await persistJob(key, job); }
      catch (error) { error.jobKey = key; if (error.status === 409) publishConflict(error); throw error; }
      if (pending.get(key) === job) pending.delete(key);
    }
  })();
  try { await running; } finally { running = undefined; }
}

export function saveData(data) {
  enqueue("settings", { kind: "settings", path: "/settings" }, { _ui: { activeWorkspaceId: data.activeWorkspaceId } });
  if (Number.isInteger(data.activeWorkspaceId)) enqueue(`sections:${data.activeWorkspaceId}`, { kind: "sections", path: `/prep-sections?workspace_id=${data.activeWorkspaceId}` }, { sections: data.settings.preparationModules || [] });
  for (const item of data.items || []) enqueue(`item:${item.id}`, { kind: "item", value: structuredClone(item) }, itemPayload(item, resourceForItem(item)));
  for (const tree of data.drillTrees || []) enqueue(`tree:${tree.id}`, { kind: "tree", value: structuredClone(tree) }, drillPayload(tree));
  return drain();
}

export async function resolveDataConflict(choice, latest) {
  const error = blocked;
  if (!error) return;
  if (error.code === "DATASET_CHANGED") {
    if (choice !== "saved") throw new Error("Pre-restore writes cannot be retried against the new dataset");
    return reloadCanonicalData();
  }
  if (choice === "saved") {
    if (error.jobKey) pending.delete(error.jobKey);
  } else {
    const version = (Array.isArray(latest) ? latest[0]?._revision : latest?._revision) ?? error.latestRevision;
    // Empty section lists still have a revision header, fetched explicitly below.
    if (version != null) {
      if (error.path === "/convert-item") {
        versions.set(`/${error.options.body.source}/${error.options.body.id}`, version);
        error.options.body.expectedRevision = version;
      } else versions.set(error.comparisonPath || error.path, version);
    }
    else await api(error.path);
  }
  blocked = undefined;
  if (choice !== "saved" && !error.jobKey) await api(error.path, error.options);
  await drain();
  return reloadCanonicalData();
}

export async function reloadCanonicalData() {
  epoch += 1;
  itemIdentities.clear(); treeIdentities.clear(); followupIdentities.clear(); imageOwners.clear();
  versions.clear(); baselines.clear(); pending.clear(); blocked = undefined;
  datasetGeneration = undefined;
  initialLoadPromise = undefined;
  return loadData();
}

export const exportBackup = () => api("/backup");
export const previewBackup = (backup) => api("/backup/preview", { method: "POST", body: backup });
export async function restoreBackup(backup) {
  await drain();
  const result = await api("/backup/restore", { method: "POST", body: backup, headers: { "X-Confirm-Replacement": "replace-all-workspaces" }, allowGenerationChange: true });
  return { ...result, data: await reloadCanonicalData() };
}
export async function resetDataset() {
  await drain();
  const result = await api("/reset", { method: "POST", headers: { "X-Confirm-Replacement": "replace-all-workspaces" }, allowGenerationChange: true });
  return { ...result, data: await reloadCanonicalData() };
}

function roundFromApi(round) {
  return {
    id: round.id,
    workspaceId: round.workspace_id,
    label: round.label || "Untitled round",
    stageType: round.stage_type || "other",
    scheduledDate: round.scheduled_date || "",
    interviewers: round.interviewers || [],
    sequenceOrder: round.sequence_order ?? 0,
    status: round.status || "upcoming",
    interviewerNotes: round.interviewer_notes || "",
    questionsToAsk: round.questions_to_ask || "",
    outcomeNotes: round.outcome_notes || "",
    createdAt: round.created_at || "",
  };
}

function prepSectionFromApi(section) {
  return {
    id: section.id,
    label: section.label || "Untitled section",
    short: section.short || "",
    color: section.color || "#4f7b68",
    description: section.description || "",
    isBuiltin: Boolean(section.is_builtin),
  };
}

export async function loadPrepSections(workspaceId) {
  const sections = (await api(`/prep-sections?workspace_id=${workspaceId}`)).map(prepSectionFromApi);
  if (!pending.has(`sections:${workspaceId}`)) baselines.set(`sections:${workspaceId}`, { sections });
  return sections;
}

const roundToApi = (round) => ({
  label: round.label,
  stage_type: round.stageType,
  scheduled_date: round.scheduledDate,
  interviewers: round.interviewers || [],
  sequence_order: round.sequenceOrder,
  status: round.status,
  interviewer_notes: round.interviewerNotes || "",
  questions_to_ask: round.questionsToAsk || "",
  outcome_notes: round.outcomeNotes || "",
});

export async function loadWorkspaceRounds(workspaceId) {
  return (await api(`/workspaces/${workspaceId}/rounds`)).map(roundFromApi);
}

export async function createWorkspace(values) {
  const workspace = await api("/workspaces", { method: "POST", body: {
    company_name: values.companyName,
    role_title: values.roleTitle,
  } });
  return { id: workspace.id, companyName: workspace.company_name, roleTitle: workspace.role_title || "", createdAt: workspace.created_at || "" };
}

export async function updateWorkspace(workspaceId, values) {
  const workspace = await api(`/workspaces/${workspaceId}`, { method: "PUT", body: {
    company_name: values.companyName,
    role_title: values.roleTitle,
  } });
  return { id: workspace.id, companyName: workspace.company_name, roleTitle: workspace.role_title || "", createdAt: workspace.created_at || "" };
}

export async function createInterviewRound(workspaceId, round) {
  return roundFromApi(await api(`/workspaces/${workspaceId}/rounds`, { method: "POST", body: roundToApi(round) }));
}

export async function updateInterviewRound(workspaceId, round) {
  return roundFromApi(await api(`/workspaces/${workspaceId}/rounds/${round.id}`, { method: "PUT", body: roundToApi(round) }));
}

export function deleteInterviewRound(workspaceId, roundId) {
  return api(`/workspaces/${workspaceId}/rounds/${roundId}`, { method: "DELETE" });
}

export async function searchData(query) {
  if (!query.trim()) return [];
  return api(`/search?q=${encodeURIComponent(query.trim())}`);
}

function readImageAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.onerror = () => reject(reader.error || new Error("The image could not be read"));
    reader.readAsDataURL(file);
  });
}

export async function uploadItemImage(itemId, file) {
  const identity = itemIdentities.get(itemId);
  if (!identity) throw new Error("Save the preparation item before adding images");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["jpg", "jpeg", "png", "gif", "svg", "heic"].includes(extension)) {
    throw new Error("Supported image types: .jpg, .jpeg, .png, .gif, .svg, and .heic");
  }
  if (file.size > 12 * 1024 * 1024) throw new Error("Images must be 12 MB or smaller");
  return api("/item-images", { method: "POST", ownerPath: identity.resource === "scheduling-machine" ? "/scheduling-machine" : `/${identity.resource}/${identity.dbId}`, body: {
    resource: identity.resource,
    record_id: identity.dbId,
    filename: file.name,
    data: await readImageAsBase64(file),
  } });
}

export function deleteItemImage(imageId) {
  return api(`/item-images/${imageId}`, { method: "DELETE", ownerPath: imageOwners.get(imageId) });
}

export function statusWeight(status) {
  return STATUSES.find((entry) => entry.value === status)?.weight ?? 0;
}

export function isNonEmptyItem(item) {
  const values = [item.title, ...Object.values(item.content || {})];
  return values.some((value) => typeof value === "string" && value.trim().length > 0);
}

export function moduleReadiness(data, moduleId) {
  const itemScores = data.items
    .filter((item) => item.module === moduleId && isNonEmptyItem(item))
    .map((item) => statusWeight(item.status));
  const nodeScores = data.drillTrees
    .filter((tree) => tree.module === moduleId)
    .flatMap((tree) => tree.nodes)
    .filter((node) => node.question.trim() || node.myAnswer.trim())
    .map((node) => statusWeight(node.status));
  const scores = [...itemScores, ...nodeScores];
  if (!scores.length) return null;
  return Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100);
}

export function overallReadiness(data, modules = []) {
  const scores = modules.map((module) => moduleReadiness(data, module.id)).filter((score) => score !== null);
  if (!scores.length) return null;
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}
