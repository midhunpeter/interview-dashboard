import { CASE_FRAMEWORK_STAGES } from "../caseFramework.js";

export const SCHEMA_VERSION = 1;

export const MODULES = [
  { id: "positioning", label: "Positioning", short: "PO", color: "#9e6a50", description: "Build a crisp story for why your background fits this team." },
  { id: "scheduling-machine", label: "Scheduling Machine", short: "SM", color: "#6c7f6b", description: "Show genuine technical ownership, decisions, scale, and lessons." },
  { id: "pm-depth", label: "Technical PM Depth", short: "TP", color: "#5d7397", description: "Prepare for deep questions on APIs, data, rules, and integrations." },
  { id: "platform-reliability", label: "Platform Reliability", short: "PR", color: "#8c6c87", description: "Practice operational maturity, integrity, and observability." },
  { id: "internal-platform-pm", label: "Internal Platform PM", short: "IP", color: "#82714d", description: "Frame other teams as customers and prove adoption thinking." },
  { id: "healthcare-interoperability", label: "Healthcare Interop", short: "HI", color: "#477a75", description: "Review standards, workflows, regulation, and domain examples." },
  { id: "data-platform-translation", label: "Data Platform Translation", short: "DT", color: "#936251", description: "Map Scheduling Machine lessons to Tempus platform problems." },
  { id: "hiring-manager-simulation", label: "HM Simulation", short: "HM", color: "#606a88", description: "Rehearse progressive technical drilling and follow-up pressure." },
];

export const STATUSES = [
  { value: "not-started", label: "Not started", weight: 0 },
  { value: "reviewed", label: "Reviewed", weight: 0.5 },
  { value: "confident", label: "Confident", weight: 1 },
];

const now = () => new Date().toISOString();
export const createId = () => globalThis.crypto?.randomUUID?.()
  || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const seedItem = (module, title, type = "note", priority = "medium", starred = false, content = {}) => ({
  id: createId(),
  type,
  module,
  title,
  tags: [],
  status: "not-started",
  priority,
  starred,
  sortOrder: 0,
  createdAt: now(),
  updatedAt: now(),
  roundIds: [],
  content: { notes: "", ...content },
});

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
      preparationModules: MODULES.map((module) => ({ ...module })),
    },
    items: [
      seedItem("positioning", "30-second introduction", "pitch", "high", true),
      seedItem("positioning", "Why Tempus and why this team?", "question", "high", true),
      seedItem("scheduling-machine", "Platform overview and scale", "note", "high", true),
      seedItem("scheduling-machine", "A decision I would make differently", "story", "medium"),
      seedItem("pm-depth", "API contracts and versioning", "question", "high"),
      seedItem("pm-depth", "Caching and invalidation trade-offs", "question", "medium"),
      seedItem("platform-reliability", "Production incident case note", "incident", "high", true),
      seedItem("internal-platform-pm", "Internal customer adoption story", "story", "high"),
      seedItem("healthcare-interoperability", "FHIR, HL7 v2, and DICOM relationship", "knowledge", "high"),
      seedItem("data-platform-translation", "Scheduling constraints → data platform rules", "translation", "high", true, {
        schedulingMachinePattern: "",
        tempusProblem: "",
        whatIBring: "",
      }),
      seedItem("hiring-manager-simulation", "Questions to ask the hiring manager", "open-question", "high", true),
    ],
    drillTrees: [
      {
        id: createId(),
        module: "hiring-manager-simulation",
        roundId: null,
        title: "Walk me through the Scheduling Machine",
        tags: ["must-review"],
        priority: "high",
        starred: true,
        sortOrder: 0,
        createdAt: now(),
        updatedAt: now(),
        nodes: [
          { id: createId(), parentId: null, level: 0, question: "What was the Scheduling Machine?", myAnswer: "", status: "not-started", sortOrder: 0 },
          { id: createId(), parentId: null, level: 1, question: "How did the core scheduling logic work?", myAnswer: "", status: "not-started", sortOrder: 1 },
          { id: createId(), parentId: null, level: 2, question: "Where did consistency or failure handling get difficult?", myAnswer: "", status: "not-started", sortOrder: 2 },
        ],
      },
    ],
  };
}

const itemIdentities = new Map();
const treeIdentities = new Map();
const followupIdentities = new Map();
let saveQueue = Promise.resolve();
let initialLoadPromise;

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

const timestamp = () => new Date().toISOString();
const baseItem = (resource, row, fields) => {
  const ui = row._ui || {};
  return {
    id: `${resource}:${row.id}`,
    type: "note",
    module: "positioning",
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
  };
};

function rememberItem(item, resource, dbId) {
  itemIdentities.set(item.id, { resource, dbId });
  return item;
}

function rowsToItems({ stories, caseFrameworks = [], questions, scheduling, incidents, translations, knowledge, images }) {
  const items = [
    ...stories.map((row) => rememberItem(baseItem("story-bank", row, {
      type: "story",
      itemType: "story",
      module: row.module || "positioning",
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
      module: row.module || "positioning",
      title: row.title || "Untitled case framework",
      tags: row.tags || [],
      usedFor: row.used_for || [],
      status: row.status || "not-started",
      createdAt: row.created_at || timestamp(),
      content: Object.fromEntries(CASE_FRAMEWORK_STAGES.map(({ key }) => [key, row[key] || ""])),
    }), "case-framework", row.id)),
    ...questions.map((row) => rememberItem(baseItem("question-bank", row, {
      type: "question",
      module: row.module || "positioning",
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
      module: row.module || "positioning",
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
  return {
    id: treeId,
    module: row.module || "hiring-manager-simulation",
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
}

async function loadDatabaseData() {
  itemIdentities.clear();
  treeIdentities.clear();
  followupIdentities.clear();
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
  const [prepItems, roundsResponse, questions, trees, scheduling, incidents, translations, knowledge, images] = await Promise.all([
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
      preparationModules: settings._ui?.preparationModules || [
        ...MODULES.map((module) => ({ ...module })),
        ...(settings._ui?.customModules || []),
      ],
    },
    items: rowsToItems({ stories, caseFrameworks, questions, scheduling, incidents, translations, knowledge, images }),
    drillTrees: trees.map(rowToTree),
  };

  const schedulingHasContent = [
    scheduling.overview,
    ...(scheduling.architecture_notes || []),
    ...(scheduling.ownership_stories || []),
    scheduling.scale_metrics,
    scheduling.lessons_learned,
  ].some((value) => typeof value === "string" && value.trim());
  const hasStoredPreparation = stories.length || questions.length || trees.length || incidents.length
    || caseFrameworks.length || translations.length || knowledge.length || schedulingHasContent;
  if (!hasStoredPreparation) {
    const initial = createInitialData();
    await saveData(initial);
    return initial;
  }
  return data;
}

export function loadData() {
  if (!initialLoadPromise) initialLoadPromise = loadDatabaseData();
  return initialLoadPromise;
}

export async function loadRoundFilteredContent(roundId = null, workspaceId = null) {
  itemIdentities.clear();
  treeIdentities.clear();
  followupIdentities.clear();
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
  if (item.module === "scheduling-machine" && item.title === "Platform overview and scale" && item.type === "note") return "scheduling-machine";
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

async function persistItems(items) {
  const currentIds = new Set(items.map((item) => item.id));
  for (const [clientId, identity] of [...itemIdentities]) {
    if (!currentIds.has(clientId)) {
      await deleteItemResource(identity);
      itemIdentities.delete(clientId);
    }
  }

  for (const item of items) {
    const desiredResource = resourceForItem(item);
    let identity = itemIdentities.get(item.id);
    if (identity && identity.resource !== desiredResource) {
      await deleteItemResource(identity);
      itemIdentities.delete(item.id);
      identity = null;
    }
    const body = itemPayload(item, desiredResource);
    if (identity) {
      const path = desiredResource === "scheduling-machine" ? "/scheduling-machine" : `/${desiredResource}/${identity.dbId}`;
      await api(path, { method: "PUT", body });
    } else if (desiredResource === "scheduling-machine") {
      await api("/scheduling-machine", { method: "PUT", body });
      itemIdentities.set(item.id, { resource: desiredResource, dbId: 1 });
    } else {
      const created = await api(`/${desiredResource}`, { method: "POST", body });
      itemIdentities.set(item.id, { resource: desiredResource, dbId: created.id });
    }
  }
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

async function persistTrees(trees) {
  const currentIds = new Set(trees.map((tree) => tree.id));
  for (const [clientId, dbId] of [...treeIdentities]) {
    if (!currentIds.has(clientId)) {
      await api(`/drill-trees/${dbId}`, { method: "DELETE" });
      treeIdentities.delete(clientId);
      for (const key of [...followupIdentities.keys()]) if (key.startsWith(`${clientId}:`)) followupIdentities.delete(key);
    }
  }
  for (const tree of trees) {
    const dbId = treeIdentities.get(tree.id);
    const response = dbId
      ? await api(`/drill-trees/${dbId}`, { method: "PUT", body: drillPayload(tree) })
      : await api("/drill-trees", { method: "POST", body: drillPayload(tree) });
    if (!dbId) treeIdentities.set(tree.id, response.id);
    rememberFollowupResponses(tree, response);
  }
}

async function persistData(data) {
  await api("/settings", { method: "PUT", body: {
    _ui: {
      activeWorkspaceId: data.activeWorkspaceId,
      preparationModules: data.settings.preparationModules || MODULES,
    },
  } });
  await persistItems(data.items || []);
  await persistTrees(data.drillTrees || []);
}

export function saveData(data) {
  const run = saveQueue.catch(() => undefined).then(() => persistData(data));
  saveQueue = run;
  return run;
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
  return api("/item-images", { method: "POST", body: {
    resource: identity.resource,
    record_id: identity.dbId,
    filename: file.name,
    data: await readImageAsBase64(file),
  } });
}

export function deleteItemImage(imageId) {
  return api(`/item-images/${imageId}`, { method: "DELETE" });
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

export function overallReadiness(data, modules = MODULES) {
  const scores = modules.map((module) => moduleReadiness(data, module.id)).filter((score) => score !== null);
  if (!scores.length) return null;
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}
