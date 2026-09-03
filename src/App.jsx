import { useEffect, useMemo, useRef, useState } from "react";
import {
  MODULES,
  SCHEMA_VERSION,
  STATUSES,
  createInitialData,
  createId,
  loadData,
  moduleReadiness,
  overallReadiness,
  saveData,
  loadWorkspaceRounds,
  createWorkspace,
  updateWorkspace,
  createInterviewRound,
  updateInterviewRound,
  deleteInterviewRound,
  uploadItemImage,
  deleteItemImage,
} from "./data";
import { FormattedTextarea, MarkdownContent } from "./markdown";

const TYPE_LABELS = {
  note: "Note",
  pitch: "Pitch",
  question: "Question & answer",
  story: "Story",
  incident: "Incident",
  knowledge: "Knowledge",
  translation: "Translation",
  research: "Research",
  "open-question": "Open question",
};

const ROUND_STAGE_TYPES = [
  ["recruiter_screen", "Recruiter screen"],
  ["hiring_manager", "Hiring manager"],
  ["technical_panel", "Technical panel"],
  ["onsite", "Onsite"],
  ["final", "Final"],
  ["offer", "Offer"],
  ["other", "Other"],
];
const ROUND_STATUSES = ["upcoming", "completed", "cancelled"];
const roundStageLabel = (stageType) => ROUND_STAGE_TYPES.find(([value]) => value === stageType)?.[1] || "Other";

const isSchedulingOverview = (item) => item.module === "scheduling-machine"
  && item.title === "Platform overview and scale"
  && item.type === "note";

function itemMarkdownSections(item) {
  const content = item.content || {};
  if (item.type === "story") return [
    ["Situation", content.situation],
    ["Task", content.task],
    ["Action", content.action ?? content.notes],
    ["Result", content.result],
  ];
  if (item.type === "incident") return [
    ["What broke", content.whatBroke ?? content.notes],
    ["How it was found", content.howFound],
    ["How it was fixed", content.howFixed],
    ["What changed afterward", content.whatChangedAfter],
  ];
  if (item.type === "translation") return [
    ["Scheduling Machine pattern", content.schedulingMachinePattern],
    ["Analogous Tempus problem", content.tempusProblem],
    ["What I would bring", content.whatIBring],
  ];
  if (item.type === "knowledge") return [
    ["Definition", content.definition ?? content.notes],
    ["Notes", content.definition == null ? "" : content.notes],
  ];
  if (isSchedulingOverview(item)) return [
    ["Overview", content.overview ?? content.notes],
    ...(content.architectureNotes || []).map((value, index) => [`Architecture note ${index + 1}`, value]),
    ...(content.ownershipStories || []).map((value, index) => [`Ownership story ${index + 1}`, value]),
    ["Scale metrics", content.scaleMetrics],
    ["Lessons learned", content.lessonsLearned],
  ];
  return [[null, content.notes]];
}

function primaryItemMarkdown(item) {
  return itemMarkdownSections(item).find(([, value]) => String(value || "").trim())?.[1] || "";
}

function ItemMarkdownContent({ item, emptyText = "No notes added yet." }) {
  const sections = itemMarkdownSections(item).filter(([, value]) => String(value || "").trim());
  if (!sections.length) return <p className="markdown-empty">{emptyText}</p>;
  return (
    <div className={`markdown-sections ${sections.length > 1 ? "multiple" : ""}`}>
      {sections.map(([label, value], index) => (
        <section key={`${label || "notes"}-${index}`}>
          {label && <b>{label}</b>}
          <MarkdownContent value={value} />
        </section>
      ))}
    </div>
  );
}

const makeItem = (moduleId) => {
  const timestamp = new Date().toISOString();
  return {
    id: createId(),
    type: moduleId === "data-platform-translation" ? "translation" : "note",
    module: moduleId,
    title: "Untitled prep item",
    tags: [],
    status: "not-started",
    priority: "medium",
    starred: false,
    sortOrder: Date.now(),
    createdAt: timestamp,
    updatedAt: timestamp,
    content: moduleId === "data-platform-translation"
      ? { notes: "", schedulingMachinePattern: "", tempusProblem: "", whatIBring: "" }
      : { notes: "" },
  };
};

function App() {
  const [data, setData] = useState(createInitialData);
  const [view, setView] = useState("home");
  const [query, setQuery] = useState("");
  const [saveState, setSaveState] = useState("Loading…");
  const [notice, setNotice] = useState("");
  const importRef = useRef(null);
  const hydrated = useRef(false);
  const modules = useMemo(() => data.settings.preparationModules || MODULES, [data.settings.preparationModules]);
  const activeWorkspace = data.workspaces?.find((workspace) => workspace.id === data.activeWorkspaceId) || data.workspaces?.[0] || null;

  useEffect(() => {
    let cancelled = false;
    loadData()
      .then((loaded) => {
        if (cancelled) return;
        hydrated.current = true;
        setData(loaded);
        setSaveState("Saved to SQLite");
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setSaveState("Load failed");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return undefined;
    setSaveState("Saving…");
    const timer = window.setTimeout(() => {
      saveData(data)
        .then(() => setSaveState("Saved to SQLite"))
        .catch((error) => {
          console.error(error);
          setSaveState("Save failed");
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [data]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const focusSearch = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector('[aria-label="Search all preparation content"]')?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const items = data.items.filter((item) => {
      const haystack = [item.title, item.type, ...(item.tags || []), ...Object.values(item.content || {})]
        .filter((value) => typeof value === "string")
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    }).map((item) => ({ ...item, kind: "item" }));
    const trees = data.drillTrees.filter((tree) => {
      const haystack = [tree.title, ...(tree.tags || []), ...tree.nodes.flatMap((node) => [node.question, node.myAnswer])]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    }).map((tree) => ({ ...tree, kind: "drill" }));
    return [...items, ...trees];
  }, [data, query]);

  const navigate = (nextView) => {
    setView(nextView);
    setQuery("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const updateItem = (id, patch) => {
    setData((current) => ({
      ...current,
      items: current.items.map((item) => item.id === id
        ? { ...item, ...patch, updatedAt: new Date().toISOString() }
        : item),
    }));
  };

  const moveItem = (id, direction) => {
    setData((current) => {
      const item = current.items.find((entry) => entry.id === id);
      if (!item) return current;
      const ordered = current.items.filter((entry) => entry.module === item.module).sort((a, b) => a.sortOrder - b.sortOrder);
      const index = ordered.findIndex((entry) => entry.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ordered.length) return current;
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      const sortOrders = new Map(ordered.map((entry, order) => [entry.id, order]));
      return {
        ...current,
        items: current.items.map((entry) => sortOrders.has(entry.id)
          ? { ...entry, sortOrder: sortOrders.get(entry.id), updatedAt: new Date().toISOString() }
          : entry),
      };
    });
  };

  const deleteItem = async (id) => {
    const item = data.items.find((entry) => entry.id === id);
    if (!item || !window.confirm(`Delete “${item.title}”?`)) return;
    try {
      await Promise.all((item.images || []).map((image) => deleteItemImage(image.id)));
    } catch (error) {
      console.error(error);
      setNotice("Item could not be deleted");
      return;
    }
    setData((current) => ({ ...current, items: current.items.filter((entry) => entry.id !== id) }));
    setNotice("Item deleted");
  };

  const duplicateItem = (item) => {
    const timestamp = new Date().toISOString();
    setData((current) => ({
      ...current,
      items: [...current.items, { ...item, id: createId(), title: `${item.title} copy`, images: [], sortOrder: Date.now(), createdAt: timestamp, updatedAt: timestamp }],
    }));
    setNotice("Item duplicated");
  };

  const addItem = (moduleId) => {
    const item = makeItem(moduleId);
    setData((current) => ({ ...current, items: [...current.items, item] }));
    window.setTimeout(() => document.getElementById(`item-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };

  const addImagesToItem = async (itemId, fileList) => {
    const files = [...fileList];
    if (!files.length) return;
    setSaveState("Saving…");
    try {
      await saveData(data);
      const uploaded = [];
      for (const file of files) uploaded.push(await uploadItemImage(itemId, file));
      setData((current) => ({
        ...current,
        items: current.items.map((item) => item.id === itemId ? { ...item, images: [...(item.images || []), ...uploaded] } : item),
      }));
      setSaveState("Saved to SQLite");
      setNotice(`${uploaded.length} image${uploaded.length === 1 ? "" : "s"} added`);
    } catch (error) {
      console.error(error);
      setSaveState("Save failed");
      setNotice(error.message || "Image upload failed");
    }
  };

  const removeImageFromItem = async (itemId, image) => {
    if (!window.confirm(`Delete “${image.filename}”?`)) return;
    try {
      await deleteItemImage(image.id);
      setData((current) => ({
        ...current,
        items: current.items.map((item) => item.id === itemId ? { ...item, images: (item.images || []).filter((entry) => entry.id !== image.id) } : item),
      }));
      setNotice("Image deleted");
    } catch (error) {
      console.error(error);
      setNotice(error.message || "Image delete failed");
    }
  };

  const saveNow = async (snapshot = data) => {
    setSaveState("Saving…");
    try {
      await saveData(snapshot);
      setSaveState("Saved to SQLite");
      setNotice("Preparation saved");
      return true;
    } catch (error) {
      console.error(error);
      setSaveState("Save failed");
      setNotice("Save failed");
      return false;
    }
  };

  const selectWorkspace = async (workspaceId) => {
    const workspace = data.workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace || workspaceId === data.activeWorkspaceId) return;
    setSaveState("Loading…");
    try {
      const rounds = await loadWorkspaceRounds(workspaceId);
      setData((current) => ({
        ...current,
        activeWorkspaceId: workspaceId,
        rounds,
        settings: { ...current.settings, companyName: workspace.companyName, roleTitle: workspace.roleTitle },
      }));
      setSaveState("Saved to SQLite");
      setNotice(`Switched to ${workspace.companyName}`);
    } catch (error) {
      console.error(error);
      setSaveState("Load failed");
      setNotice("Opportunity could not be loaded");
    }
  };

  const addWorkspace = async () => {
    try {
      const workspace = await createWorkspace({ companyName: "New opportunity", roleTitle: "" });
      setData((current) => ({
        ...current,
        workspaces: [...current.workspaces, workspace],
        activeWorkspaceId: workspace.id,
        rounds: [],
        settings: { ...current.settings, companyName: workspace.companyName, roleTitle: workspace.roleTitle },
      }));
      setNotice("Opportunity added");
    } catch (error) {
      console.error(error);
      setNotice("Opportunity could not be added");
    }
  };

  const saveWorkspaceDetails = async (values) => {
    if (!data.activeWorkspaceId) return false;
    try {
      const workspace = await updateWorkspace(data.activeWorkspaceId, values);
      setData((current) => ({
        ...current,
        workspaces: current.workspaces.map((entry) => entry.id === workspace.id ? workspace : entry),
        settings: { ...current.settings, companyName: workspace.companyName, roleTitle: workspace.roleTitle },
      }));
      setNotice("Opportunity saved");
      return true;
    } catch (error) {
      console.error(error);
      setNotice("Opportunity could not be saved");
      return false;
    }
  };

  const addRound = async (round) => {
    try {
      const created = await createInterviewRound(data.activeWorkspaceId, round);
      setData((current) => ({ ...current, rounds: [...current.rounds, created] }));
      setNotice("Interview round added");
      return created;
    } catch (error) {
      console.error(error);
      setNotice("Interview round could not be added");
      return null;
    }
  };

  const saveRound = async (round) => {
    try {
      const saved = await updateInterviewRound(data.activeWorkspaceId, round);
      setData((current) => ({ ...current, rounds: current.rounds.map((entry) => entry.id === saved.id ? saved : entry) }));
      setNotice("Interview round saved");
      return saved;
    } catch (error) {
      console.error(error);
      setNotice("Interview round could not be saved");
      return null;
    }
  };

  const removeRound = async (round) => {
    if (!window.confirm(`Delete “${round.label}”? Its drill trees will become general preparation.`)) return false;
    try {
      await deleteInterviewRound(data.activeWorkspaceId, round.id);
      setData((current) => ({
        ...current,
        rounds: current.rounds.filter((entry) => entry.id !== round.id),
        drillTrees: current.drillTrees.map((tree) => tree.roundId === round.id ? { ...tree, roundId: null } : tree),
      }));
      setNotice("Interview round deleted; its drill trees are now general prep");
      return true;
    } catch (error) {
      console.error(error);
      setNotice("Interview round could not be deleted");
      return false;
    }
  };

  const deletePreparationSection = async (sectionId) => {
    const section = (data.settings.preparationModules || []).find((entry) => entry.id === sectionId);
    if (section && !window.confirm(`Delete the “${section.label}” preparation section and all of its items?`)) return false;
    const nextData = {
      ...data,
      settings: { ...data.settings, preparationModules: (data.settings.preparationModules || []).filter((entry) => entry.id !== sectionId) },
      items: data.items.filter((item) => item.module !== sectionId),
      drillTrees: data.drillTrees.filter((tree) => tree.module !== sectionId),
    };
    const saved = await saveNow(nextData);
    if (saved) setData(nextData);
    return saved;
  };

  const reorderPreparationSections = async (preparationModules) => {
    const nextData = { ...data, settings: { ...data.settings, preparationModules } };
    const saved = await saveNow(nextData);
    if (saved) setData(nextData);
    return saved;
  };

  const updateTree = (treeId, updater) => {
    setData((current) => ({
      ...current,
      drillTrees: current.drillTrees.map((tree) => tree.id === treeId
        ? { ...updater(tree), updatedAt: new Date().toISOString() }
        : tree),
    }));
  };

  const addTree = (moduleId, roundId = null) => {
    const timestamp = new Date().toISOString();
    const tree = {
      id: createId(),
      module: moduleId,
      roundId,
      title: "Untitled drill tree",
      tags: [],
      priority: "high",
      starred: false,
      sortOrder: Date.now(),
      createdAt: timestamp,
      updatedAt: timestamp,
      nodes: [{ id: createId(), parentId: null, level: 0, question: "Root question", myAnswer: "", status: "not-started", sortOrder: 0 }],
    };
    setData((current) => ({ ...current, drillTrees: [...current.drillTrees, tree] }));
    setNotice("Drill tree added");
  };

  const deleteTree = (treeId) => {
    const tree = data.drillTrees.find((entry) => entry.id === treeId);
    if (!tree || !window.confirm(`Delete drill tree “${tree.title}”?`)) return;
    setData((current) => ({ ...current, drillTrees: current.drillTrees.filter((entry) => entry.id !== treeId) }));
    setNotice("Drill tree deleted");
  };

  const exportData = () => {
    const payload = { ...data, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `interview-prep-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Backup exported");
  };

  const importData = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.items) || !Array.isArray(parsed.drillTrees) || !parsed.settings) {
        throw new Error("This file is not a valid dashboard backup.");
      }
      const summary = `${parsed.items.length} items and ${parsed.drillTrees.length} drill trees`;
      if (!window.confirm(`Import ${summary}? This will replace the current dashboard after a backup is downloaded.`)) return;
      exportData();
      setData({
        ...parsed,
        workspaces: Array.isArray(parsed.workspaces) && parsed.workspaces.length ? parsed.workspaces : data.workspaces,
        activeWorkspaceId: parsed.activeWorkspaceId || data.activeWorkspaceId,
        rounds: Array.isArray(parsed.rounds) ? parsed.rounds : data.rounds,
        settings: {
          ...parsed.settings,
          preparationModules: parsed.settings.preparationModules || [...MODULES, ...(parsed.settings.customModules || [])],
        },
      });
      setNotice("Backup imported");
    } catch (error) {
      window.alert(error.message || "The selected backup could not be imported.");
    }
  };

  const module = modules.find((entry) => entry.id === view);

  return (
    <div className="app-shell">
      <Sidebar view={view} data={data} modules={modules} onNavigate={navigate} />
      <div className="workspace">
        <Header
          company={activeWorkspace?.companyName}
          query={query}
          setQuery={setQuery}
          saveState={saveState}
          onNavigate={navigate}
        />
        {query.trim() ? (
          <SearchResults query={query} results={searchResults} modules={modules} onNavigate={navigate} />
        ) : view === "home" ? (
          <Dashboard data={data} modules={modules} onNavigate={navigate} />
        ) : view === "quick-review" ? (
          <QuickReview data={data} modules={modules} updateItem={updateItem} updateTree={updateTree} saveNow={saveNow} onNavigate={navigate} />
        ) : view === "settings" ? (
          <Settings
            data={data}
            setData={setData}
            exportData={exportData}
            importData={() => importRef.current?.click()}
            resetData={() => {
              if (window.confirm("Reset the dashboard to its starter content? Export a backup first if you need the current data.")) {
                setData(createInitialData());
                setNotice("Dashboard reset");
              }
            }}
            deletePreparationSection={deletePreparationSection}
            reorderPreparationSections={reorderPreparationSections}
            selectWorkspace={selectWorkspace}
            addWorkspace={addWorkspace}
            saveWorkspaceDetails={saveWorkspaceDetails}
            addRound={addRound}
            saveRound={saveRound}
            removeRound={removeRound}
          />
        ) : module ? (
          <ModuleView
            module={module}
            data={data}
            updateItem={updateItem}
            moveItem={moveItem}
            deleteItem={deleteItem}
            duplicateItem={duplicateItem}
            addItem={addItem}
            saveNow={saveNow}
            addImagesToItem={addImagesToItem}
            removeImageFromItem={removeImageFromItem}
            updateTree={updateTree}
            addTree={addTree}
            deleteTree={deleteTree}
            saveRound={saveRound}
          />
        ) : null}
      </div>
      <input ref={importRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={importData} />
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

function Sidebar({ view, data, modules, onNavigate }) {
  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => onNavigate("home")} aria-label="Go to dashboard home">
        <span className="brand-mark">IP</span>
        <span><strong>Interview Prep</strong><small>Private workspace</small></span>
      </button>
      <nav aria-label="Primary navigation">
        <p className="nav-label">Overview</p>
        <button className={view === "home" ? "nav-item active" : "nav-item"} onClick={() => onNavigate("home")}>
          <span className="nav-icon">⌂</span><span>Dashboard</span>
        </button>
        <button className={view === "quick-review" ? "nav-item active" : "nav-item"} onClick={() => onNavigate("quick-review")}>
          <span className="nav-icon">★</span><span>Quick review</span>
        </button>
        <p className="nav-label">Preparation</p>
        {modules.map((module) => {
          const readiness = moduleReadiness(data, module.id);
          return (
            <button key={module.id} className={view === module.id ? "nav-item active" : "nav-item"} onClick={() => onNavigate(module.id)}>
              <span className="module-dot" style={{ background: module.color }}>{module.short}</span>
              <span className="nav-text">{module.label}</span>
              <span className="nav-progress">{readiness === null ? "—" : `${readiness}%`}</span>
            </button>
          );
        })}
      </nav>
      <button className={view === "settings" ? "nav-item sidebar-footer active" : "nav-item sidebar-footer"} onClick={() => onNavigate("settings")}>
        <span className="nav-icon">⚙</span><span>Settings & backup</span>
      </button>
    </aside>
  );
}

function Header({ company, query, setQuery, saveState, onNavigate }) {
  return (
    <header className="topbar">
      <label className="search-box">
        <span aria-hidden="true">⌕</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search questions, answers, tags, and notes…" aria-label="Search all preparation content" />
        <kbd>⌘ K</kbd>
      </label>
      <span className={`save-state ${saveState.endsWith("failed") ? "error" : ""}`}><i />{saveState}</span>
      <button className="company-chip" onClick={() => onNavigate("settings")}>{company || "Set company"}</button>
    </header>
  );
}

function Dashboard({ data, modules, onNavigate }) {
  const overall = overallReadiness(data, modules);
  const focus = useMemo(() => {
    const rank = (item) => {
      if (item.starred && item.status !== "confident") return 1;
      if (item.priority === "high" && item.status !== "confident") return 2;
      return item.status === "confident" ? 5 : 4;
    };
    return [...data.items]
      .filter((item) => item.status !== "confident")
      .sort((a, b) => rank(a) - rank(b) || new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 10);
  }, [data.items]);
  const workspace = data.workspaces?.find((entry) => entry.id === data.activeWorkspaceId);
  const rounds = [...(data.rounds || [])].sort((a, b) => a.sequenceOrder - b.sequenceOrder || a.id - b.id);
  const nextRound = rounds
    .filter((round) => round.status === "upcoming" && !Number.isNaN(new Date(round.scheduledDate).getTime()))
    .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate))[0] || null;
  const days = countdown(nextRound?.scheduledDate);

  return (
    <main className="page dashboard-page">
      <section className="hero-row">
        <div>
          <p className="eyebrow">{workspace?.roleTitle || "Interview preparation"}</p>
          <h1>Ready for the conversation,<br />not just the questions.</h1>
          <p className="hero-copy">Build depth, rehearse the follow-ups, and keep your strongest evidence close at hand.</p>
        </div>
        <div className="countdown-card">
          <span className="eyebrow">{nextRound?.label || "Next interview round"}</span>
          <strong>{days === null ? "No upcoming round" : days < 0 ? "Past due" : days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`}</strong>
          <small>{nextRound ? `${roundStageLabel(nextRound.stageType)} · ${formatDate(nextRound.scheduledDate)}` : "Add a scheduled round in Settings"}</small>
        </div>
      </section>

      <section className="overview-grid">
        <article className="readiness-card panel">
          <div className="panel-heading"><div><p className="eyebrow">Overall readiness</p><h2>Your preparation pulse</h2></div></div>
          <div className="readiness-content">
            <div className="readiness-ring" style={{ "--progress": `${overall ?? 0}%` }}><span><strong>{overall ?? 0}%</strong><small>ready</small></span></div>
            <div className="readiness-legend">
              <p><span className="legend-dot confident" />Confident <strong>{data.items.filter((item) => item.status === "confident").length}</strong></p>
              <p><span className="legend-dot reviewed" />Reviewed <strong>{data.items.filter((item) => item.status === "reviewed").length}</strong></p>
              <p><span className="legend-dot not-started" />Not started <strong>{data.items.filter((item) => item.status === "not-started").length}</strong></p>
            </div>
          </div>
        </article>
        <article className="panel focus-card">
          <div className="panel-heading"><div><p className="eyebrow">Focus today</p><h2>Highest-leverage work</h2></div><span className="count-pill">{focus.length}</span></div>
          <div className="focus-list">
            {focus.slice(0, 4).map((item) => {
              const module = modules.find((entry) => entry.id === item.module);
              return (
                <button key={item.id} onClick={() => onNavigate(item.module)}>
                  <span className="module-dot" style={{ background: module?.color }}>{module?.short}</span>
                  <div className="focus-copy"><strong>{item.title}</strong><small>{module?.label} · {item.status.replace("-", " ")}</small><MarkdownContent value={primaryItemMarkdown(item)} className="focus-snippet" /></div>
                  <span aria-hidden="true">→</span>
                </button>
              );
            })}
          </div>
        </article>
      </section>

      <section className="rounds-timeline panel">
        <div className="panel-heading"><div><p className="eyebrow">Interview plan</p><h2>Rounds timeline</h2></div><button className="text-button" onClick={() => onNavigate("settings")}>Manage rounds →</button></div>
        {rounds.length === 0 ? <p className="muted">No interview rounds added yet.</p> : (
          <ol>
            {rounds.map((round, index) => (
              <li key={round.id} className={`round-timeline-item ${round.status}`}>
                <span className="round-sequence">{index + 1}</span>
                <div><strong>{round.label}</strong><small>{roundStageLabel(round.stageType)} · {round.scheduledDate ? formatDate(round.scheduledDate) : "Date not set"}</small></div>
                <span className={`round-status ${round.status}`}>{round.status}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="modules-section">
        <div className="section-heading"><div><p className="eyebrow">Preparation sections</p><h2>Preparation map</h2></div><button className="text-button" onClick={() => onNavigate("quick-review")}>Open quick review →</button></div>
        <div className="module-grid">
          {modules.map((module, index) => {
            const progress = moduleReadiness(data, module.id);
            const count = data.items.filter((item) => item.module === module.id).length;
            return (
              <button className="module-card" key={module.id} onClick={() => onNavigate(module.id)}>
                <span className="module-number">0{index + 1}</span>
                <span className="module-dot large" style={{ background: module.color }}>{module.short}</span>
                <h3>{module.label}</h3>
                <p>{module.description}</p>
                <span className="progress-meta"><span>{count} item{count === 1 ? "" : "s"}</span><strong>{progress === null ? "Not started" : `${progress}%`}</strong></span>
                <span className="progress-track"><i style={{ width: `${progress ?? 0}%`, background: module.color }} /></span>
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function ModuleView({ module, data, updateItem, moveItem, deleteItem, duplicateItem, addItem, saveNow, addImagesToItem, removeImageFromItem, updateTree, addTree, deleteTree, saveRound }) {
  const items = data.items.filter((item) => item.module === module.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const [selectedRoundId, setSelectedRoundId] = useState(null);
  const isSimulation = module.id === "hiring-manager-simulation";
  const selectedRound = data.rounds.find((round) => round.id === selectedRoundId) || null;
  useEffect(() => {
    if (selectedRoundId != null && !data.rounds.some((round) => round.id === selectedRoundId)) setSelectedRoundId(null);
  }, [data.rounds, selectedRoundId]);
  const moduleTrees = data.drillTrees.filter((tree) => tree.module === module.id);
  const trees = isSimulation
    ? moduleTrees.filter((tree) => tree.roundId == null || (selectedRoundId != null && tree.roundId === selectedRoundId))
    : moduleTrees;
  const progress = moduleReadiness(data, module.id);
  return (
    <main className="page">
      <section className="module-header">
        <div className="module-dot hero-icon" style={{ background: module.color }}>{module.short}</div>
        <div><p className="eyebrow">Preparation module</p><h1>{module.label}</h1><p>{module.description}</p></div>
        <div className="module-score"><strong>{progress ?? 0}%</strong><span>readiness</span></div>
      </section>
      {isSimulation && (
        <section className="round-context-panel panel">
          <div><p className="eyebrow">Round context</p><h2>Simulation focus</h2><p>General preparation is always included alongside the selected interview round.</p></div>
          <label>Interview round<select value={selectedRoundId ?? ""} onChange={(event) => setSelectedRoundId(event.target.value ? Number(event.target.value) : null)}><option value="">General prep</option>{data.rounds.map((round) => <option value={round.id} key={round.id}>{round.label}</option>)}</select></label>
        </section>
      )}
      {isSimulation && selectedRound && <RoundPreparation round={selectedRound} saveRound={saveRound} />}
      <div className="section-heading content-heading"><div><p className="eyebrow">Working set</p><h2>Your preparation items</h2></div><button className="primary-button" onClick={() => addItem(module.id)}>＋ Add item</button></div>
      <section className="item-list">
        {items.length === 0 && <EmptyState onAdd={() => addItem(module.id)} />}
        {items.map((item, index) => <ItemEditor key={item.id} item={item} module={module} updateItem={updateItem} moveItem={moveItem} canMoveUp={index > 0} canMoveDown={index < items.length - 1} deleteItem={deleteItem} duplicateItem={duplicateItem} saveNow={saveNow} addImagesToItem={addImagesToItem} removeImageFromItem={removeImageFromItem} />)}
      </section>
      {(module.id === "hiring-manager-simulation" || trees.length > 0) && (
        <DrillSection module={module} trees={trees} updateTree={updateTree} addTree={addTree} deleteTree={deleteTree} roundId={isSimulation ? selectedRoundId : null} rounds={data.rounds} />
      )}
    </main>
  );
}

function RoundPreparation({ round, saveRound }) {
  const [draft, setDraft] = useState(round);
  useEffect(() => setDraft(round), [round]);
  return (
    <section className="round-preparation panel">
      <div className="section-heading"><div><p className="eyebrow">{round.label}</p><h2>Round-specific preparation</h2></div><button type="button" className="primary-button" onClick={() => saveRound(draft)}>Save round notes</button></div>
      <div className="round-preparation-grid">
        <FormattedTextarea label="Interviewer research" value={draft.interviewerNotes || ""} onChange={(value) => setDraft((current) => ({ ...current, interviewerNotes: value }))} placeholder="Background, communication style, mutual connections…" />
        <FormattedTextarea label="Questions to ask" value={draft.questionsToAsk || ""} onChange={(value) => setDraft((current) => ({ ...current, questionsToAsk: value }))} placeholder="Questions tailored to this round…" />
      </div>
    </section>
  );
}

function FormattedListEditor({ label, values = [], onChange, addLabel }) {
  const updateEntry = (index, value) => onChange(values.map((entry, entryIndex) => entryIndex === index ? value : entry));
  const removeEntry = (index) => onChange(values.filter((_, entryIndex) => entryIndex !== index));
  return (
    <section className="formatted-list-editor">
      <span className="formatted-field-label">{label}</span>
      {values.map((value, index) => (
        <div className="formatted-list-entry" key={`${label}-${index}`}>
          <FormattedTextarea label={`${label} ${index + 1}`} value={value} onChange={(nextValue) => updateEntry(index, nextValue)} />
          <button type="button" className="danger-link" onClick={() => removeEntry(index)}>Remove</button>
        </div>
      ))}
      <button type="button" className="add-formatted-entry" onClick={() => onChange([...values, ""])}>＋ {addLabel}</button>
    </section>
  );
}

function ItemLongTextFields({ item, setContent }) {
  const content = item.content || {};
  if (item.type === "story") return (
    <div className="long-text-stack">
      <FormattedTextarea label="Situation" value={content.situation || ""} onChange={(value) => setContent("situation", value)} />
      <FormattedTextarea label="Task" value={content.task || ""} onChange={(value) => setContent("task", value)} />
      <FormattedTextarea label="Action" value={content.action ?? content.notes ?? ""} onChange={(value) => setContent("action", value)} />
      <FormattedTextarea label="Result" value={content.result || ""} onChange={(value) => setContent("result", value)} />
    </div>
  );
  if (item.type === "incident") return (
    <div className="long-text-stack">
      <FormattedTextarea label="What broke" value={content.whatBroke ?? content.notes ?? ""} onChange={(value) => setContent("whatBroke", value)} />
      <FormattedTextarea label="How it was found" value={content.howFound || ""} onChange={(value) => setContent("howFound", value)} />
      <FormattedTextarea label="How it was fixed" value={content.howFixed || ""} onChange={(value) => setContent("howFixed", value)} />
      <FormattedTextarea label="What changed afterward" value={content.whatChangedAfter || ""} onChange={(value) => setContent("whatChangedAfter", value)} />
    </div>
  );
  if (item.type === "translation") return (
    <div className="translation-grid formatted-translation-grid">
      <FormattedTextarea label="Scheduling Machine pattern" value={content.schedulingMachinePattern || ""} onChange={(value) => setContent("schedulingMachinePattern", value)} />
      <FormattedTextarea label="Analogous Tempus problem" value={content.tempusProblem || ""} onChange={(value) => setContent("tempusProblem", value)} />
      <FormattedTextarea label="What I would bring" value={content.whatIBring || ""} onChange={(value) => setContent("whatIBring", value)} />
    </div>
  );
  if (item.type === "knowledge") return (
    <div className="long-text-stack">
      <FormattedTextarea label="Definition" value={content.definition ?? content.notes ?? ""} onChange={(value) => setContent("definition", value)} />
      <FormattedTextarea label="Notes" value={content.definition == null ? "" : content.notes || ""} onChange={(value) => setContent("notes", value)} />
    </div>
  );
  if (isSchedulingOverview(item)) return (
    <div className="long-text-stack">
      <FormattedTextarea label="Overview" value={content.overview ?? content.notes ?? ""} onChange={(value) => setContent("overview", value)} textareaClassName="main-textarea" />
      <FormattedListEditor label="Architecture note" values={content.architectureNotes || []} onChange={(value) => setContent("architectureNotes", value)} addLabel="Add architecture note" />
      <FormattedListEditor label="Ownership story" values={content.ownershipStories || []} onChange={(value) => setContent("ownershipStories", value)} addLabel="Add ownership story" />
      <FormattedTextarea label="Scale metrics" value={content.scaleMetrics || ""} onChange={(value) => setContent("scaleMetrics", value)} />
      <FormattedTextarea label="Lessons learned" value={content.lessonsLearned || ""} onChange={(value) => setContent("lessonsLearned", value)} />
    </div>
  );
  return <FormattedTextarea label="Notes / prepared answer" value={content.notes || ""} onChange={(value) => setContent("notes", value)} textareaClassName="main-textarea" placeholder="Capture the answer, evidence, trade-offs, and details you need on recall…" />;
}

function ItemEditor({ item, module, updateItem, moveItem, canMoveUp, canMoveDown, deleteItem, duplicateItem, saveNow, addImagesToItem, removeImageFromItem }) {
  const [open, setOpen] = useState(item.title === "Untitled prep item");
  const [tagInput, setTagInput] = useState(() => (item.tags || []).join(", "));
  const [previewImage, setPreviewImage] = useState(null);
  useEffect(() => {
    if (!previewImage) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => event.key === "Escape" && setPreviewImage(null);
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [previewImage]);
  const setContent = (key, value) => updateItem(item.id, { content: { ...item.content, [key]: value } });
  return (
    <article id={`item-${item.id}`} className={`item-card ${open ? "open" : ""}`}>
      <div className="item-summary">
        <button className="star-button" aria-label={item.starred ? "Unstar item" : "Star item"} onClick={() => updateItem(item.id, { starred: !item.starred })}>{item.starred ? "★" : "☆"}</button>
        <button className="item-title-button" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span><small>{TYPE_LABELS[item.type] || item.type}</small><strong>{item.title || "Untitled item"}</strong></span>
          <span className="tag-preview">{item.tags.slice(0, 2).map((tag) => <i key={tag}>#{tag}</i>)}</span>
        </button>
        <span className="item-order-buttons" aria-label={`Reorder ${item.title}`}>
          <button disabled={!canMoveUp} onClick={() => moveItem(item.id, -1)} aria-label={`Move ${item.title} up`}>↑</button>
          <button disabled={!canMoveDown} onClick={() => moveItem(item.id, 1)} aria-label={`Move ${item.title} down`}>↓</button>
        </span>
        <select className={`status-select ${item.status}`} value={item.status} onChange={(event) => updateItem(item.id, { status: event.target.value })} aria-label={`Status for ${item.title}`}>
          {STATUSES.map((status) => <option value={status.value} key={status.value}>{status.label}</option>)}
        </select>
        <button className="expand-button" onClick={() => setOpen(!open)} aria-label={open ? "Collapse item" : "Expand item"}>{open ? "⌃" : "⌄"}</button>
      </div>
      {open && (
        <div className="item-form">
          <div className="form-grid three">
            <label>Title<input value={item.title} onChange={(event) => updateItem(item.id, { title: event.target.value })} /></label>
            <label>Type<select value={item.type} onChange={(event) => updateItem(item.id, { type: event.target.value })}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label>Priority<select value={item.priority} onChange={(event) => updateItem(item.id, { priority: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          </div>
          <label>Tags<input value={tagInput} onChange={(event) => {
            const value = event.target.value;
            setTagInput(value);
            updateItem(item.id, { tags: value.split(",").map((tag) => tag.trim()).filter(Boolean) });
          }} placeholder="must-review, architecture, leadership" /></label>
          {item.type === "research" && (
            <div className="form-grid three">
              <label>Source title<input value={item.content.sourceTitle || ""} onChange={(event) => setContent("sourceTitle", event.target.value)} /></label>
              <label>Source URL<input type="url" value={item.content.sourceUrl || ""} onChange={(event) => setContent("sourceUrl", event.target.value)} /></label>
              <label>Claim type<select value={item.content.claimType || "fact"} onChange={(event) => setContent("claimType", event.target.value)}><option value="fact">Fact</option><option value="inference">Inference</option><option value="hypothesis">Hypothesis</option></select></label>
            </div>
          )}
          <ItemLongTextFields item={item} setContent={setContent} />
          <section className="item-images">
            <div className="item-images-heading"><span>Images</span><small>.jpg, .jpeg, .png, .gif, .svg, .heic · 12 MB maximum each</small></div>
            {(item.images || []).length > 0 && <div className="image-preview-grid">
              {(item.images || []).map((image) => (
                <figure key={image.id}>
                  <button type="button" className="image-preview-frame" onClick={() => setPreviewImage(image)} aria-label={`Preview ${image.filename}`}>
                    <img src={image.url} alt={image.filename} onError={(event) => {
                      event.currentTarget.hidden = true;
                      event.currentTarget.nextElementSibling.hidden = false;
                    }} />
                    <span className="image-preview-fallback" hidden>Preview unavailable for this format</span>
                    <span className="image-preview-hint">View</span>
                  </button>
                  <figcaption title={image.filename}>{image.filename}</figcaption>
                  <button className="danger-link" onClick={() => removeImageFromItem(item.id, image)}>Delete image</button>
                </figure>
              ))}
            </div>}
            <label className="image-upload-label">＋ Add images
              <input type="file" accept=".jpg,.jpeg,.png,.gif,.svg,.heic,image/jpeg,image/png,image/gif,image/svg+xml,image/heic" multiple onChange={(event) => {
                addImagesToItem(item.id, event.target.files);
                event.target.value = "";
              }} />
            </label>
          </section>
          <div className="item-actions">
            <span>Updated {new Date(item.updatedAt).toLocaleString()}</span>
            <button className="save-link" onClick={() => saveNow()}>Save</button>
            <button className="danger-link" onClick={() => deleteItem(item.id)}>Delete</button>
            <button onClick={() => duplicateItem(item)}>Duplicate</button>
          </div>
        </div>
      )}
      {previewImage && (
        <div className="image-lightbox-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPreviewImage(null)}>
          <section className="image-lightbox" role="dialog" aria-modal="true" aria-label={`Image preview: ${previewImage.filename}`}>
            <button type="button" className="image-lightbox-close" onClick={() => setPreviewImage(null)} aria-label="Close image preview">×</button>
            <div className="image-lightbox-canvas">
              <img src={previewImage.url} alt={previewImage.filename} />
            </div>
            <footer>
              <span title={previewImage.filename}>{previewImage.filename}</span>
              <a href={previewImage.url} target="_blank" rel="noreferrer">Open original ↗</a>
            </footer>
          </section>
        </div>
      )}
    </article>
  );
}

function DrillSection({ module, trees, updateTree, addTree, deleteTree, roundId = null, rounds = [] }) {
  const [practiceTree, setPracticeTree] = useState(null);
  return (
    <section className="drill-section">
      <div className="section-heading"><div><p className="eyebrow">Progressive drilling</p><h2>Follow-up depth</h2></div><button className="primary-button" onClick={() => addTree(module.id, roundId)}>＋ Add drill tree</button></div>
      {trees.length === 0 ? <p className="muted">No drill trees are assigned to this module yet.</p> : trees.map((tree) => (
        <article className="drill-card" key={tree.id}>
          <div className="drill-heading">
            <div><small>{tree.nodes.length} levels · {tree.roundId == null ? "General prep" : rounds.find((round) => round.id === tree.roundId)?.label || "Interview round"}</small><input className="drill-title-input" value={tree.title} onChange={(event) => updateTree(tree.id, (current) => ({ ...current, title: event.target.value }))} aria-label="Drill tree title" /></div>
            <div className="drill-actions"><button className="danger-link" onClick={() => deleteTree(tree.id)}>Delete</button><button className="secondary-button" onClick={() => setPracticeTree(tree)}>Practice tree →</button></div>
          </div>
          <div className="drill-nodes">
            {tree.nodes.map((node, index) => (
              <div className="drill-node" key={node.id} style={{ marginLeft: `${node.level * 28}px` }}>
                <span className="level-badge">L{node.level}</span>
                <label><span className="visually-hidden">Question level {node.level}</span><input value={node.question} onChange={(event) => updateTree(tree.id, (current) => ({ ...current, nodes: current.nodes.map((entry) => entry.id === node.id ? { ...entry, question: event.target.value } : entry) }))} /></label>
                <select value={node.status} onChange={(event) => updateTree(tree.id, (current) => ({ ...current, nodes: current.nodes.map((entry) => entry.id === node.id ? { ...entry, status: event.target.value } : entry) }))} aria-label={`Status for level ${index}`}>
                  {STATUSES.map((status) => <option value={status.value} key={status.value}>{status.label}</option>)}
                </select>
              </div>
            ))}
          </div>
          <button className="add-followup" onClick={() => updateTree(tree.id, (current) => ({
            ...current,
            nodes: [...current.nodes, {
              id: createId(),
              parentId: current.nodes.at(-1)?.id ?? null,
              level: current.nodes.length,
              question: "New follow-up question",
              myAnswer: "",
              status: "not-started",
              sortOrder: current.nodes.length,
            }],
          }))}>＋ Add follow-up level</button>
        </article>
      ))}
      {practiceTree && <PracticeDialog tree={practiceTree} close={() => setPracticeTree(null)} updateTree={updateTree} />}
    </section>
  );
}

function PracticeDialog({ tree, close, updateTree }) {
  const [revealed, setRevealed] = useState(0);
  const visible = tree.nodes.slice(0, revealed + 1);
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section className="practice-dialog" role="dialog" aria-modal="true" aria-labelledby="practice-title">
        <button className="dialog-close" onClick={close} aria-label="Close practice mode">×</button>
        <p className="eyebrow">Mock interview · Level {revealed} of {tree.nodes.length - 1}</p>
        <h2 id="practice-title">{tree.title}</h2>
        {visible.map((node) => (
          <div className="practice-question" key={node.id}>
            <small>{node.level === 0 ? "Root question" : `Follow-up ${node.level}`}</small>
            <h3>{node.question}</h3>
            <FormattedTextarea value={node.myAnswer} onChange={(value) => updateTree(tree.id, (current) => ({ ...current, nodes: current.nodes.map((entry) => entry.id === node.id ? { ...entry, myAnswer: value } : entry) }))} placeholder="Practice your answer here…" ariaLabel={`Answer for ${node.question}`} />
          </div>
        ))}
        <div className="dialog-actions">
          <button className="secondary-button" onClick={close}>Finish</button>
          {revealed < tree.nodes.length - 1 && <button className="primary-button" onClick={() => setRevealed((value) => value + 1)}>Reveal next follow-up</button>}
        </div>
      </section>
    </div>
  );
}

function SearchResults({ query, results, modules, onNavigate }) {
  return (
    <main className="page">
      <section className="simple-header"><p className="eyebrow">Global search</p><h1>Results for “{query}”</h1><p>{results.length} matching item{results.length === 1 ? "" : "s"}</p></section>
      <div className="search-results">
        {results.length === 0 && <div className="empty-state"><strong>No matches yet</strong><p>Try a title, phrase, tag, question, or acronym.</p></div>}
        {results.map((result) => {
          const module = modules.find((entry) => entry.id === result.module);
          return <button key={result.id} onClick={() => onNavigate(result.module)}><span className="module-dot" style={{ background: module?.color }}>{module?.short}</span><span><small>{module?.label} · {result.kind}</small><strong>{result.title}</strong></span><span>→</span></button>;
        })}
      </div>
    </main>
  );
}

function QuickReview({ data, modules, updateItem, updateTree, saveNow, onNavigate }) {
  const starredItems = data.items.filter((item) => item.starred);
  const starredTrees = data.drillTrees.filter((tree) => tree.starred);
  return (
    <main className="page quick-review-page">
      <section className="simple-header print-header"><p className="eyebrow">Day-of mode</p><h1>Quick review</h1><p>Your starred, highest-priority preparation in one calm view.</p><button className="primary-button no-print" onClick={() => window.print()}>Print / Save PDF</button></section>
      {modules.map((module) => {
        const items = starredItems.filter((item) => item.module === module.id);
        const trees = starredTrees.filter((tree) => tree.module === module.id);
        if (!items.length && !trees.length) return null;
        return (
          <section className="review-module" key={module.id}>
            <div className="review-module-heading"><span className="module-dot" style={{ background: module.color }}>{module.short}</span><h2>{module.label}</h2><button className="text-button no-print" onClick={() => onNavigate(module.id)}>Open module →</button></div>
            {items.map((item) => (
              <article className="review-item" key={item.id}>
                <small>{TYPE_LABELS[item.type] || item.type}</small><h3>{item.title}</h3>
                <ItemMarkdownContent item={item} />
                <FormattedTextarea className="quick-review-notes no-print" label="Notes / prepared answer" value={item.content.quickReviewNotes || ""} onChange={(value) => updateItem(item.id, { content: { ...item.content, quickReviewNotes: value } })} placeholder="Capture additional quick-review notes, reminders, or talking points…" />
                <div className="quick-review-print-notes print-only"><b>Notes / prepared answer</b><MarkdownContent value={item.content.quickReviewNotes || ""} /></div>
                <button className="quick-review-save no-print" onClick={() => saveNow()}>Save notes</button>
              </article>
            ))}
            {trees.map((tree) => (
              <article className="review-item" key={tree.id}>
                <small>Drill tree</small><h3>{tree.title}</h3><ol>{tree.nodes.map((node) => <li key={node.id}><b>{node.question}</b>{node.myAnswer && <MarkdownContent value={node.myAnswer} />}</li>)}</ol>
                <FormattedTextarea className="quick-review-notes no-print" label="Notes / prepared answer" value={tree.quickReviewNotes || ""} onChange={(value) => updateTree(tree.id, (current) => ({ ...current, quickReviewNotes: value }))} placeholder="Capture additional quick-review notes, reminders, or talking points…" />
                <div className="quick-review-print-notes print-only"><b>Notes / prepared answer</b><MarkdownContent value={tree.quickReviewNotes || ""} /></div>
                <button className="quick-review-save no-print" onClick={() => saveNow()}>Save notes</button>
              </article>
            ))}
          </section>
        );
      })}
    </main>
  );
}

const CUSTOM_MODULE_COLORS = ["#4f7b68", "#7b6455", "#65759a", "#8a647d", "#5c7b80", "#85733f"];

function Settings({ data, setData, exportData, importData, resetData, deletePreparationSection, reorderPreparationSections, selectWorkspace, addWorkspace, saveWorkspaceDetails, addRound, saveRound, removeRound }) {
  const activeWorkspace = data.workspaces.find((workspace) => workspace.id === data.activeWorkspaceId) || data.workspaces[0];
  const [opportunityDraft, setOpportunityDraft] = useState(() => ({ companyName: activeWorkspace?.companyName || "", roleTitle: activeWorkspace?.roleTitle || "" }));
  const [roundDrafts, setRoundDrafts] = useState(() => data.rounds || []);
  const [sectionDrafts, setSectionDrafts] = useState(() => data.settings.preparationModules || []);
  useEffect(() => {
    setOpportunityDraft({ companyName: activeWorkspace?.companyName || "", roleTitle: activeWorkspace?.roleTitle || "" });
  }, [activeWorkspace?.id, activeWorkspace?.companyName, activeWorkspace?.roleTitle]);
  useEffect(() => setRoundDrafts(data.rounds || []), [data.rounds]);
  const updateRoundDraft = (id, patch) => setRoundDrafts((current) => current.map((round) => round.id === id ? { ...round, ...patch } : round));
  const addRoundDraft = () => setRoundDrafts((current) => [...current, {
    id: `new-${createId()}`,
    workspaceId: data.activeWorkspaceId,
    label: "",
    stageType: "other",
    scheduledDate: "",
    interviewers: [],
    sequenceOrder: current.length + 1,
    status: "upcoming",
    interviewerNotes: "",
    questionsToAsk: "",
    outcomeNotes: "",
    isNew: true,
  }]);
  const saveRoundDraft = async (draft) => {
    if (!draft.label.trim()) return window.alert("Enter a label for the interview round before saving.");
    if (draft.isNew) await addRound({ ...draft, label: draft.label.trim(), id: undefined, isNew: undefined });
    else await saveRound({ ...draft, label: draft.label.trim() });
  };
  const deleteRoundDraft = async (draft) => {
    if (draft.isNew) {
      if (window.confirm("Delete this unsaved interview round?")) setRoundDrafts((current) => current.filter((round) => round.id !== draft.id));
      return;
    }
    await removeRound(draft);
  };
  const addSectionDraft = () => {
    setSectionDrafts((current) => [...current, {
      id: `custom-${createId()}`,
      label: "",
      short: "",
      color: CUSTOM_MODULE_COLORS[current.length % CUSTOM_MODULE_COLORS.length],
      description: "",
    }]);
  };
  const updateSectionDraft = (id, patch) => setSectionDrafts((current) => current.map((section) => section.id === id ? { ...section, ...patch } : section));
  const saveSectionDraft = async (draft) => {
    const label = draft.label.trim();
    if (!label) {
      window.alert("Enter a name for the preparation section before saving.");
      return;
    }
    const normalized = {
      ...draft,
      label,
      short: (draft.short || "").trim() || label.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase(),
      description: draft.description.trim() || `Prepare and organize material for ${label}.`,
    };
    const savedIds = new Set((data.settings.preparationModules || []).map((section) => section.id));
    const nextDrafts = sectionDrafts.map((section) => section.id === draft.id ? normalized : section);
    const nextModules = nextDrafts.filter((section) => savedIds.has(section.id) || section.id === draft.id);
    if (await reorderPreparationSections(nextModules)) setSectionDrafts(nextDrafts);
  };
  const deleteSectionDraft = async (draft) => {
    const isSaved = (data.settings.preparationModules || []).some((section) => section.id === draft.id);
    if (isSaved && !await deletePreparationSection(draft.id)) return;
    setSectionDrafts((current) => current.filter((section) => section.id !== draft.id));
  };
  const moveSectionDraft = async (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= sectionDrafts.length) return;
    const nextDrafts = [...sectionDrafts];
    [nextDrafts[index], nextDrafts[target]] = [nextDrafts[target], nextDrafts[index]];
    setSectionDrafts(nextDrafts);
    const savedIds = new Set((data.settings.preparationModules || []).map((section) => section.id));
    await reorderPreparationSections(nextDrafts.filter((section) => savedIds.has(section.id)));
  };
  return (
    <main className="page settings-page">
      <section className="simple-header"><p className="eyebrow">Workspace setup</p><h1>Settings & backup</h1><p>Keep interview details current and protect your local preparation data.</p></section>
      <section className="settings-panel panel opportunity-settings">
        <div className="settings-section-heading"><h2>Opportunity details</h2><p>Each workspace represents one company and role.</p></div>
        <div className="opportunity-picker">
          <label>Current opportunity
            <select value={data.activeWorkspaceId || ""} onChange={(event) => selectWorkspace(Number(event.target.value))}>
              {data.workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.companyName}{workspace.roleTitle ? ` — ${workspace.roleTitle}` : ""}</option>)}
            </select>
          </label>
          <button type="button" className="secondary-button" onClick={addWorkspace}>＋ New opportunity</button>
        </div>
        <div className="form-grid two">
          <label>Company<input value={opportunityDraft.companyName} onChange={(event) => setOpportunityDraft((current) => ({ ...current, companyName: event.target.value }))} /></label>
          <label>Role title<input value={opportunityDraft.roleTitle} onChange={(event) => setOpportunityDraft((current) => ({ ...current, roleTitle: event.target.value }))} placeholder="Product Manager, Data Platform" /></label>
        </div>
        <button type="button" className="primary-button" onClick={() => saveWorkspaceDetails(opportunityDraft)}>Save opportunity</button>
      </section>
      <section className="settings-panel panel rounds-settings">
        <div className="settings-section-heading"><h2>Interview rounds</h2><p>Plan and track every stage for this opportunity.</p></div>
        <div className="round-draft-list">
          {roundDrafts.length === 0 && <p className="muted">No interview rounds yet. Add the first round below.</p>}
          {roundDrafts.map((round) => (
            <article className="round-draft" key={round.id}>
              <div className="round-draft-heading">
                <strong>{round.label || "New interview round"}</strong>
                <span className={`round-status ${round.status}`}>{round.status}</span>
              </div>
              <div className="round-fields">
                <label>Round label<input value={round.label} onChange={(event) => updateRoundDraft(round.id, { label: event.target.value })} placeholder="Hiring Manager Interview" /></label>
                <label>Stage type<select value={round.stageType} onChange={(event) => updateRoundDraft(round.id, { stageType: event.target.value })}>{ROUND_STAGE_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                <label>Scheduled date<input type="datetime-local" value={round.scheduledDate} onChange={(event) => updateRoundDraft(round.id, { scheduledDate: event.target.value })} /></label>
                <label>Status<select value={round.status} onChange={(event) => updateRoundDraft(round.id, { status: event.target.value })}>{ROUND_STATUSES.map((status) => <option value={status} key={status}>{status}</option>)}</select></label>
                <label className="round-interviewers">Interviewers<input value={(round.interviewers || []).map((person) => typeof person === "string" ? person : person.name).filter(Boolean).join(", ")} onChange={(event) => updateRoundDraft(round.id, { interviewers: event.target.value.split(",").map((name, index) => ({ id: round.interviewers?.[index]?.id || createId(), name: name.trim() })).filter((person) => person.name) })} placeholder="Alex Rivera, Morgan Lee" /></label>
              </div>
              <div className="round-notes-grid">
                <FormattedTextarea label="Interviewer research" value={round.interviewerNotes || ""} onChange={(value) => updateRoundDraft(round.id, { interviewerNotes: value })} />
                <FormattedTextarea label="Questions to ask" value={round.questionsToAsk || ""} onChange={(value) => updateRoundDraft(round.id, { questionsToAsk: value })} />
                <FormattedTextarea label="Outcome notes" value={round.outcomeNotes || ""} onChange={(value) => updateRoundDraft(round.id, { outcomeNotes: value })} />
              </div>
              <div className="round-draft-actions"><button type="button" className="save-link" onClick={() => saveRoundDraft(round)}>Save</button><button type="button" className="danger-link" onClick={() => deleteRoundDraft(round)}>Delete</button></div>
            </article>
          ))}
        </div>
        <button type="button" className="add-preparation-button" onClick={addRoundDraft}><span>＋</span>Add interview round</button>
      </section>
      <section className="settings-panel panel preparation-settings">
        <div className="settings-section-heading">
          <div><h2>Add new preparation</h2><p>Create, edit, and reorder every preparation section shown in the sidebar and preparation map.</p></div>
        </div>
        <div className="preparation-draft-list">
          {sectionDrafts.length === 0 && <p className="muted">No custom preparation sections yet. Use the plus button to add one.</p>}
          {sectionDrafts.map((draft) => {
            const isSaved = (data.settings.preparationModules || []).some((section) => section.id === draft.id);
            return (
              <article className="preparation-draft" key={draft.id}>
                <span className="module-dot large" style={{ background: draft.color }}>{draft.short || "+"}</span>
                <div className="preparation-draft-fields">
                  <label>Section name<input value={draft.label} onChange={(event) => updateSectionDraft(draft.id, { label: event.target.value })} placeholder="Leadership stories" /></label>
                  <label>Description<input value={draft.description} onChange={(event) => updateSectionDraft(draft.id, { description: event.target.value })} placeholder="What you want to prepare in this section" /></label>
                </div>
                <div className="preparation-draft-actions">
                  <small>{isSaved ? "Saved entry" : "New entry"}</small>
                  <span className="preparation-order-buttons">
                    <button disabled={sectionDrafts.indexOf(draft) === 0} onClick={() => moveSectionDraft(sectionDrafts.indexOf(draft), -1)} aria-label={`Move ${draft.label || "new section"} up`}>↑</button>
                    <button disabled={sectionDrafts.indexOf(draft) === sectionDrafts.length - 1} onClick={() => moveSectionDraft(sectionDrafts.indexOf(draft), 1)} aria-label={`Move ${draft.label || "new section"} down`}>↓</button>
                  </span>
                  <button className="save-link" onClick={() => saveSectionDraft(draft)}>Save</button>
                  <button className="danger-link" onClick={() => deleteSectionDraft(draft)}>Delete</button>
                </div>
              </article>
            );
          })}
        </div>
        <button className="add-preparation-button" onClick={addSectionDraft}><span>＋</span>Add another preparation section</button>
      </section>
      <section className="settings-panel panel">
        <h2>Local data</h2><p>This dashboard stores data in a local SQLite database on this laptop. Export a backup regularly.</p>
        <div className="button-row"><button className="primary-button" onClick={exportData}>Export JSON backup</button><button className="secondary-button" onClick={importData}>Import JSON backup</button><button className="danger-button" onClick={resetData}>Reset dashboard</button></div>
        <small>Schema version {SCHEMA_VERSION} · {data.items.length} items · {data.drillTrees.length} drill tree{data.drillTrees.length === 1 ? "" : "s"}</small>
      </section>
    </main>
  );
}

function EmptyState({ onAdd }) {
  return <div className="empty-state"><strong>No preparation items yet</strong><p>Add the first item for this module.</p><button className="primary-button" onClick={onAdd}>Add item</button></div>;
}

function countdown(value) {
  if (!value) return null;
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return null;
  return Math.ceil((target - Date.now()) / 86400000);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date not set";
  return date.toLocaleString([], { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default App;
