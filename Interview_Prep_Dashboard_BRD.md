# Business Requirements Document
## Personal Interview Preparation Dashboard

**Prepared for:** Candidate (self)
**Date:** August 29, 2026
**Version:** 2.1 — implementation-ready local-laptop specification


**Changelog (v2.0):** Replaced the generic "Technical Interview Preparation" module and refined the module set to match the actual interview narrative: platform ownership (Scheduling Machine), platform reliability, internal-platform PM craft, and an explicit translation module bridging past platform experience to Tempus's data platform problems.

**Changelog (v2.1):** Standardized the product on a single local laptop. Standardized the content model, defined readiness calculations and focus logic, clarified offline architecture and JSON backup/restore, added data provenance and recovery requirements, narrowed the MVP sequence, and expanded acceptance criteria.

---

## 1. How to Use This Document

This BRD is written to be handed directly to an AI coding tool to generate a working application. It defines *what* to build and *why*, not the literal code. Section 16 contains a condensed, copy-paste-ready prompt that distills this document into a build spec if you want to skip straight to generation.

Assumptions made while drafting are called out explicitly in Section 14 — adjust anything that doesn't match your reality before generation.

---

## 2. Executive Summary

The candidate has an upcoming interview process — centered on an internal/data platform product management role at **Tempus** — and needs a single, fast, low-friction place to hold all preparation material. This project delivers a personal, browser-based **Interview Prep Dashboard**: one application with dedicated modules covering positioning, deep platform ownership (the "Scheduling Machine" background), technical PM craft, platform reliability, internal-platform PM skills, healthcare interoperability domain knowledge, an explicit bridge translating past platform experience into Tempus's problems, and a hiring-manager simulation built around progressive technical drilling.

The tool is optimized for two use modes:
1. **Deep prep** (days/weeks out) — building and refining content.
2. **Rapid recall** (hours/minutes out) — scanning key material quickly on the candidate's laptop.

---

## 3. Problem Statement

- Prep content lives in disconnected places (docs, sticky notes, memory), making review slow and incomplete.
- There's no single view of *readiness* across the different dimensions this interview will test (fit narrative, platform depth, technical PM craft, reliability thinking, internal-platform skills, domain knowledge, and the ability to translate past experience into this specific company's problems).
- This interview is likely to involve progressive technical drilling — surface answers won't hold up, so prep needs to go deep, not just wide.
- Last-minute review before or between interview rounds needs to be fast and calm, not a scavenger hunt through files.

---

## 4. Goals & Success Metrics

| Goal | Success Metric |
|---|---|
| Centralize all prep content | All interview-day prep content is available in the local app without opening external documents |
| Make any piece of content findable fast | In a five-task usability check, each target item is found via search/navigation in under 10 seconds |
| Make readiness visible | Per-module and overall readiness percentages follow the calculation in Section 8.10 and are visible on Home |
| Support day-of rapid review | The candidate can review all starred items in a single distraction-free view within 15–30 minutes |
| Survive progressive drilling | For priority drill trees, the candidate marks the root and at least two follow-up levels confident |
| Be reusable beyond this one interview | Content can be exported as versioned JSON, restored, and updated for future rounds or companies |

---

## 5. Users & Context of Use

- **Primary (only) user:** the candidate. No multi-user or collaboration needs.
- **Device:** a single laptop used for authoring, practice, and interview-day review.
- **Environment:** the application must continue working without internet access after it has been installed/built locally.

---

## 6. Scope

### 6.1 In Scope
- Single-page, single-user web dashboard with the 8 core content modules + a home/overview screen.
- Content authoring and editing directly in the app.
- Cross-module search, tagging, and progress tracking.
- A "drill tree" mechanic for progressive-depth Q&A practice (used most heavily in Hiring-Manager Simulation, but available across modules).
- Local data persistence (no account/login required).
- Laptop-first layout for common viewport widths of 1024px and above.
- Printable/PDF-ready view of starred content for a human-readable backup.
- Versioned JSON export/import for editable backup and recovery.

### 6.2 Out of Scope (v1)
- Multi-user accounts, sharing, or collaboration.
- Cloud sync across multiple devices.
- Live AI-powered mock interviewer (listed as Phase 2 stretch goal, Section 15).
- Calendar/email/ATS integrations.
- Video/audio recording or analysis.

---

## 7. Module Overview

| # | Module | Core Question It Answers | Priority |
|---|---|---|---|
| — | Dashboard Home | "Where do I stand, and what should I focus on today?" | Must |
| 1 | Positioning & Self-Introduction | "Why does my background make sense for this team?" | Must |
| 2 | Scheduling Machine | "Do I genuinely understand and own the technical platform I built?" | Must |
| 3 | Technical Product Manager Depth | "Can I go deep on APIs, caching, data, rules, integrations, transactions?" | Must |
| 4 | Platform Reliability | "Do I understand failures, integrity, observability, scalability, operations?" | Must |
| 5 | Internal Platform Product Manager | "Can I manage a product whose users are other teams?" | Must |
| 6 | Healthcare Interoperability | "Do I know Epic, HL7, FHIR, DICOM, and clinical workflows cold?" | Must |
| 7 | Data Platform Translation | "Can I translate my Scheduling Machine experience into Tempus's problems?" | Must |
| 8 | Hiring-Manager Simulation | "Can I hold up under progressive technical drilling?" | Must |

---

## 8. Functional Requirements

### 8.1 Dashboard Home
**Purpose:** Landing screen giving an at-a-glance view of readiness and where to focus next.

Features:
- Interview countdown (days/hours until interview date — user-set field).
- Company (Tempus), role title, interview stage/round, interviewer(s)/panel names.
- Overall readiness meter (aggregate % across all 8 modules).
- Per-module progress bars with quick-jump links.
- "Focus today" widget — follows the deterministic prioritization rules in Section 8.10.
- "Day-of quick review" mode — a condensed, distraction-free scroll through starred/high-priority content across all modules.

### 8.2 Positioning & Self-Introduction
**Purpose:** Own the fit narrative — why this specific background makes sense for this specific team.

Content fields:
- Elevator pitch in 3 lengths (30s / 60s / 2min variants).
- Career narrative / throughline connecting past experience (especially the Scheduling Machine platform) to what this team needs.
- Top 3–5 quantified achievements (STAR format: Situation, Task, Action, Result).
- "Why this team" and "why Tempus" answers.
- Unique differentiators / value proposition statement, phrased in terms of this team's likely gaps or needs.
- Each item editable, taggable, and assigned one standard status: `not-started`, `reviewed`, or `confident`.

### 8.3 Scheduling Machine
**Purpose:** Prove genuine, hands-on ownership of a real technical platform — not just PM-adjacent involvement.

Content fields:
- Platform overview: what it is/was, its purpose, scale (users, volume, criticality).
- Architecture deep-dive notes: core components, how the scheduling logic actually works, key data flows.
- Ownership stories: specific decisions made, trade-offs weighed, and why.
- Scale/impact metrics to have ready on recall (not looked up mid-answer).
- Technical depth Q&A bank — anticipated deep questions about the platform's internals, with prepared answers.
- "What I'd do differently" reflections — signals genuine ownership rather than a highlight reel.

### 8.4 Technical Product Manager Depth
**Purpose:** Demonstrate technical PM fluency across the specific domains this interview will probe.

Content fields, organized by sub-topic:
- **APIs** — design trade-offs, versioning, contracts.
- **Caching** — strategies, invalidation, consistency trade-offs.
- **Data** — modeling, quality, lineage.
- **Rules** — business rules/rules-engine thinking, configurability vs. complexity trade-offs.
- **Integrations** — third-party/system integration patterns, failure handling.
- **Transactions** — consistency, atomicity, idempotency in product decisions.
- For each sub-topic: key vocabulary, a short practice question set, and the candidate's relevant experience examples.
- PM framework reference (RICE, Kano, JTBD, North Star) kept as quick-reference.

### 8.5 Platform Reliability
**Purpose:** Show operational maturity — what it actually takes to run a reliable platform in production, not just ship features.

Content fields, organized by sub-topic:
- **Failures** — failure modes, incident response, blast-radius thinking.
- **Integrity** — data integrity, consistency guarantees.
- **Observability** — monitoring, alerting, logging philosophy.
- **Scalability** — scaling strategies, known bottlenecks, how they were addressed.
- **Operations** — on-call, runbooks, SLAs/SLOs, error budgets.
- Incident/postmortem-style case notes: what broke, how it was found, how it was fixed, what changed afterward.
- Reliability vocabulary reference (SLA/SLO/SLI, MTTR, error budget, etc.).

### 8.6 Internal Platform Product Manager
**Purpose:** Address the specific PM archetype of building for internal/other-team users rather than external customers.

Content fields:
- Internal-customer stories: examples of treating other teams genuinely as customers.
- Adoption/enablement strategies used (documentation, self-serve tooling, office hours, onboarding flows).
- Stakeholder management notes/framework — how competing internal demands were balanced.
- Metrics relevant to internal platforms (adoption rate, developer/team satisfaction, time-to-integrate).
- Practice question bank specific to this archetype (e.g., "how do you prioritize when your only users are other PMs/engineers?").

### 8.7 Healthcare Interoperability
**Purpose:** Domain depth on the specific standards and workflows named for this interview.

Content fields:
- Standards reference: **Epic** (as an EHR platform and its interop surfaces), **HL7** (v2/v3), **FHIR**, **DICOM** — short definitions, use cases, how they relate to each other.
- Clinical workflow notes: how scheduling, orders, and results fit into real clinical workflows.
- Regulatory/policy reference kept as supporting context: ONC Cures Act Final Rule, TEFCA, CMS Interoperability & Patient Access Rule, HIPAA, USCDI.
- Acronym glossary with search.
- "Problems I've solved" section: real interoperability challenges addressed, written as short case notes.

### 8.8 Data Platform Translation
**Purpose:** The bridge module — explicitly map lessons from Scheduling Machine onto Tempus's data platform problems. Likely the most strategically important module in the whole app.

Content fields:
- **Translation map**: a table of `Scheduling Machine pattern/lesson → Analogous Tempus data platform problem → What I'd bring`.
- Tempus-specific research notes (product areas, data platform challenges, publicly available context on Tempus's data infrastructure and precision-medicine focus).
- Research-note provenance: source URL/title, date retrieved, and classification as fact, inference, or hypothesis.
- Anticipated "how would you apply X here" questions with prepared answers.
- Open questions/hypotheses to validate with the interviewer (shows curiosity without overclaiming insider knowledge).

### 8.9 Hiring-Manager Simulation
**Purpose:** Rehearse the actual conversation style expected — progressive technical drilling, not single-shot Q&A.

Content fields:
- **Drill trees**: each entry has a root question plus 2–4 levels of follow-up questions that go progressively deeper, each with a prepared answer. This is the core mechanic for this module.
- Question bank also organized by category (behavioral, situational, curveball) for material that doesn't need a drill structure.
- Mock-interview mode: presents the root question, lets the candidate answer, then reveals the next drill-down level one at a time (simulating real follow-up pressure), with an optional timer.
- Weak-spot tracker: flags which drill branches haven't reached "confident" yet, feeding the Home screen's "focus today" widget.
- "Questions to ask them" list.
- Interviewer research notes: background, published work, mutual connections, communication style.

### 8.10 Cross-Cutting Features
- **Global search:** searches across all modules' content simultaneously.
- **Tagging:** consistent tag system (e.g., "must-review", "confident", sub-topic tags) usable across modules.
- **Global notes/scratchpad:** a catch-all for anything that doesn't fit a module yet.
- **Item management:** add, edit, delete, duplicate, and reorder repeatable items. Deletion requires confirmation and supports undo during the current session.
- **Progress tracking:** every readiness-bearing item uses `not-started`, `reviewed`, or `confident`.
- **Readiness calculation:** `not-started = 0`, `reviewed = 0.5`, and `confident = 1`. Empty template items are excluded. A module's percentage is the arithmetic mean of its non-empty readiness-bearing items; drill-tree root and follow-up nodes count separately. If a module has no non-empty items, show `Not started` rather than `0%`. Overall readiness is the equal-weighted mean of modules that contain at least one non-empty readiness-bearing item.
- **Focus Today ordering:** (1) starred items not yet confident, (2) high-priority items not yet confident, (3) drill branches not yet confident, then (4) other reviewed or not-started items, with most recently updated items first within each group. Show at most 10 items with a link to view all.
- **Search behavior:** case-insensitive substring search across title, text content, tags, questions, answers, glossary terms, and research sources. Results show module, type, title/snippet, status, and a direct link to the item. Blank queries show no results.
- **Printable view:** generate a clean print/PDF-ready view of starred content. This is for reading, not data recovery.
- **Data backup:** export all settings and content as versioned JSON; import validates the schema, previews counts, and requires confirmation before replacing current data. Invalid files must not alter stored data.
- **Laptop layout:** optimize for keyboard and mouse use at viewport widths of 1024px and above.

---

## 9. Information Architecture

```
/ (Dashboard Home)
├── /positioning
├── /scheduling-machine
├── /pm-depth
├── /platform-reliability
├── /internal-platform-pm
├── /healthcare-interoperability
├── /data-platform-translation
├── /hiring-manager-simulation
├── /notes              (global scratchpad)
└── /settings            (interview date, company, role, panel info)
```

**Navigation:** persistent sidebar with keyboard-accessible module links. Global search is always accessible from the top of every screen.

---

## 10. Data Model (normative)

Content must be stored as structured, schema-versioned data rather than hardcoded UI. All content types inherit the common metadata below so search, tagging, readiness, starring, sorting, and backup work consistently. Specialized fields live inside `content`.

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-08-29T12:00:00.000Z",
  "settings": {
    "companyName": "Tempus",
    "roleTitle": "",
    "interviewDate": "",
    "interviewStage": "",
    "interviewers": [
      { "id": "person-001", "name": "", "title": "", "notes": "" }
    ]
  },
  "items": [
    {
      "id": "item-001",
      "type": "story",
      "module": "positioning",
      "title": "",
      "tags": [],
      "status": "not-started",
      "priority": "medium",
      "starred": false,
      "sortOrder": 0,
      "createdAt": "2026-08-29T12:00:00.000Z",
      "updatedAt": "2026-08-29T12:00:00.000Z",
      "content": {
        "situation": "",
        "task": "",
        "action": "",
        "result": "",
        "usedFor": []
      }
    }
  ],
  "drillTrees": [
    {
      "id": "drill-001",
      "module": "hiring-manager-simulation",
      "title": "",
      "tags": [],
      "priority": "high",
      "starred": true,
      "sortOrder": 0,
      "createdAt": "2026-08-29T12:00:00.000Z",
      "updatedAt": "2026-08-29T12:00:00.000Z",
      "nodes": [
        {
          "id": "node-001",
          "parentId": null,
          "level": 0,
          "question": "",
          "myAnswer": "",
          "status": "not-started",
          "sortOrder": 0
        }
      ]
    }
  ]
}
```

Valid `module` values are the eight module route identifiers from Section 9. Valid item `type` values include `story`, `pitch`, `note`, `question`, `incident`, `translation`, `knowledge`, `metric`, `glossary`, `research`, and `open-question`; implementations may add types without changing the common metadata contract. Drill trees may belong to any module.

Research items add `sourceTitle`, `sourceUrl`, `retrievedAt`, and `claimType` (`fact | inference | hypothesis`) inside `content`. Translation items add `schedulingMachinePattern`, `tempusProblem`, and `whatIBring`. Incident and STAR items retain their named structured fields inside `content`.

On load, validate the stored schema. If parsing or validation fails, preserve the unreadable payload as a downloadable recovery file, start with an empty valid dataset only after user confirmation, and show a clear error. Future schema changes must include an explicit migration from prior versions.

---

## 11. UI/UX Requirements

- **Priority: speed of scanning under pressure** over visual flourish — this will be used minutes before a high-stakes conversation.
- Clean, card/tab-based layout; generous whitespace; high contrast text.
- Progress indicators (bars or rings) should be visible without clicking in.
- Drill-tree items should visually show depth (e.g., indentation or a small tree/branch indicator) so the candidate can see at a glance how deep their prep goes on each topic.
- Star/flag mechanic for "must review before interview" items, surfaced on the Home screen.
- Calm, professional visual tone (this is a personal tool, not a marketing site) — muted palette is fine.
- No unnecessary animation or friction between the candidate and their content.
- Forms must identify required fields, preserve unsaved edits where practical, and provide clear empty, success, and error states.
- All interactive controls must be reachable by keyboard with a visible focus indicator; semantic headings and form labels are required.

---

## 12. Technical / Architecture Requirements

Use one defined architecture for v1:

- Vite + React application, runnable locally on the candidate's laptop.
- No backend, login, analytics, remote fonts, CDN assets, or third-party runtime calls.
- All JavaScript, CSS, fonts, icons, and other runtime assets must be included in the local build so the application works when the network is disabled.
- Persist the schema from Section 10 in browser `localStorage`, using a namespaced key that includes the schema version.
- Autosave after edits using a short debounce; display saved/saving/error state.
- Provide versioned JSON export/import in v1. Create a backup before a confirmed import replaces existing data.
- Keep storage access behind a small repository/service interface so a future persistence mechanism can replace `localStorage` without rewriting module UI.
- No deployment or cross-device access is required.

Non-functional requirements:
- **Performance:** initial local load under 2 seconds on the target laptop; search results update within 200 ms for up to 5,000 items.
- **Privacy:** all content stays local to the device; nothing sent to third parties (this is personal career/interview data).
- **Offline capability:** after dependencies are installed and the production build is created, all v1 functions work with the laptop's network disabled.
- **Accessibility:** target WCAG 2.2 AA for contrast, keyboard navigation, visible focus, labels, and semantic structure.
- **Data safety:** storage failures are visible to the user; invalid imports never overwrite valid data; JSON backup and restore are documented in the UI.

---

## 13. Acceptance Criteria

- [ ] All 8 content modules + Home are present and navigable.
- [ ] Content in every module is editable by the user (not hardcoded placeholder text only).
- [ ] Global search returns results from all modules.
- [ ] Search follows the fields, result metadata, blank-query, and case-insensitivity rules in Section 8.10 and responds within 200 ms for 5,000 items.
- [ ] Users can add, edit, delete with confirmation/undo, duplicate, and reorder repeatable items.
- [ ] Tags, priority, star state, and status are available consistently on all readiness-bearing items.
- [ ] Progress/status tracking works per item and rolls up to module and overall %.
- [ ] Readiness calculations match the weights, empty-module behavior, drill-node handling, and equal module weighting in Section 8.10.
- [ ] Focus Today displays no more than 10 items in the specified deterministic order and links to the source item.
- [ ] Day-of Quick Review presents all starred items in a distraction-free view grouped by module.
- [ ] Drill trees function: root question + follow-up levels, each independently tracked to "confident".
- [ ] Mock-interview mode in Hiring-Manager Simulation surfaces a root question then reveals follow-ups progressively (with optional timer).
- [ ] Translation map (Data Platform Translation module) supports adding/editing rows of pattern → problem → contribution.
- [ ] Data persists across a page refresh (local storage working).
- [ ] Autosave state and storage errors are visible; stored data is schema-versioned and validated on load.
- [ ] JSON export contains all settings and content; a valid export can restore the same data after confirmation.
- [ ] An invalid JSON/schema import shows an error and leaves current data unchanged.
- [ ] A printable/PDF-ready view of starred content is available and distinct from JSON data export.
- [ ] All v1 functions work from the production build with the laptop's network disabled.
- [ ] Primary workflows are usable at 1024×768 and larger without horizontal page scrolling, excluding intentionally scrollable tables.
- [ ] Module navigation, global search, item editing, dialogs, and mock-interview controls are keyboard-operable with visible focus.

---

## 14. Assumptions & Constraints

- Assumed target: an **internal/data platform Product Manager** role at **Tempus**, where the candidate's prior ownership of a platform referred to as "**Scheduling Machine**" is the central proof point of technical depth.
- Assumed the interview format includes **progressive technical drilling** (interviewer starts broad, drills deeper based on answers) — the drill-tree mechanic in Section 8.9/10 is built specifically for this.
- Assumed single-user, no-login, browser-based tool — no need for accounts or cloud sync in v1.
- Assumed the application and all content remain on one laptop; cross-device access is excluded.
- Assumed the candidate will populate real content (platform details, stories, translation map, domain notes) after the shell is built — this BRD specifies *structure*, not the actual answers.
- Assumed content should be editable in-app rather than requiring a code edit to update — treat all "content" as data, not hardcoded UI.

---

## 15. Phasing

**MVP foundation (build and validate first):** application shell and navigation; the common item editor; all eight module views using the shared content model; local persistence and schema validation; JSON backup/restore; global search; readiness calculation; Focus Today; starred quick-review/print view; and drill-tree editing/practice. Specialized fields may initially use shared structured editors as long as every required content type can be captured and edited.

**MVP refinement:** specialized editors for STAR stories, incidents, translation rows, glossary/research items, and settings; timer polish; reordering; keyboard/accessibility pass; production offline verification; and the complete acceptance test suite in Section 13.

**Phase 2 (optional, later):**
- AI-powered mock interviewer chat mode that can perform progressive drilling dynamically through a securely configured model API. This changes the local-only privacy model and therefore requires explicit consent, secure server-side credential handling, and a clear disclosure of what content leaves the laptop.
- Spaced-repetition mode for question banks and drill trees.
- Optional encrypted multi-device cloud sync, only if the single-laptop constraint changes.
- Visual (not just text) architecture diagrams for the Scheduling Machine and Data Platform Translation modules.

---

## 16. Appendix A: Ready-to-Use AI Build Prompt

Copy-paste this to generate the MVP:

```
Build a single-page React web app: a personal interview-prep dashboard for a Tempus interview.

Modules (each its own view, navigable via sidebar/tabs):
1. Home — countdown to interview date, company/role/interviewer fields, overall + per-module progress bars, "focus today" widget of starred/low-confidence items.
2. Positioning & Self-Introduction — elevator pitch (30s/60s/2min), career narrative, top achievements (STAR format), "why this team"/"why Tempus", differentiators.
3. Scheduling Machine — platform overview, architecture deep-dive notes, ownership stories, scale/impact metrics, technical depth Q&A bank, "what I'd do differently" reflections.
4. Technical Product Manager Depth — sub-topic sections for APIs, caching, data, rules, integrations, transactions, each with vocabulary, practice questions, and experience examples; PM framework quick-reference.
5. Platform Reliability — sub-topic sections for failures, integrity, observability, scalability, operations; incident/postmortem case notes; reliability vocabulary reference.
6. Internal Platform Product Manager — internal-customer stories, adoption/enablement strategies, stakeholder management notes, internal-platform metrics, practice question bank.
7. Healthcare Interoperability — standards reference (Epic, HL7, FHIR, DICOM), clinical workflow notes, regulatory reference (ONC, TEFCA, CMS, HIPAA, USCDI), acronym glossary, "problems I've solved" notes.
8. Data Platform Translation — translation map table (Scheduling Machine pattern → Tempus problem → what I'd bring), Tempus research notes, anticipated application questions, open questions to ask.
9. Hiring-Manager Simulation — drill trees (root question + 2-4 levels of follow-ups, each independently tracked), general question bank by category, mock-interview mode that reveals follow-ups progressively with optional timer, weak-spot tracker, "questions to ask them", interviewer research notes.

Cross-cutting requirements:
- Global search across all modules.
- Tagging system usable everywhere.
- Every item has common metadata: id, type, module, title, tags, status, priority, starred, sortOrder, createdAt, and updatedAt, plus type-specific content.
- Users can add, edit, delete with confirmation/undo, duplicate, and reorder repeatable items.
- Per-item status is not-started/reviewed/confident. Calculate readiness as 0/0.5/1, exclude empty templates, count drill nodes separately, and equal-weight non-empty modules in the overall score.
- Focus Today orders starred non-confident items, then high-priority non-confident items, then weak drill branches, then other incomplete items; show at most 10.
- Drill trees show depth visually (indentation or tree indicator) and track status per level.
- All content is user-editable and stored as schema-versioned JSON in localStorage with autosave and visible save/error state.
- Provide validated JSON export/import with preview, confirmation, and protection against invalid files overwriting current data.
- Laptop-only layout optimized for keyboard and mouse at 1024px and wider.
- Clean, calm, high-contrast UI optimized for fast scanning under time pressure.
- Provide a distraction-free quick-review and print/PDF-ready view of starred content, separate from JSON backup.
- Research notes include source title/URL, retrieval date, and fact/inference/hypothesis classification.
- All controls are keyboard-accessible with visible focus and labeled form fields.

Use Vite + React with a storage repository abstraction over localStorage. Bundle all runtime assets locally: no backend, analytics, CDN dependencies, remote fonts, or third-party runtime calls. After the production build is created, every v1 function must work with the laptop's network disabled.
```

---

*End of document.*
