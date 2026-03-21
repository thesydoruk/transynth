# Product UX and Information Architecture Roadmap

## Purpose

This document defines a practical roadmap to improve navigation, page structure, and user flow across the web UI.
It is a working implementation plan for internal use.

## Project Constraints

- The primary UX target is Fallout 4 mod localization, even if the platform keeps multi-game support in its routing model.
- Core work is game-scoped: users usually enter a game context first, then import, translate, review, and release within that context.
- The product must work in both single-user and multi-user modes without fragmenting the navigation model.
- Background jobs are central to the product experience: uploads, extraction, imports, Nexus downloads, LLM runs, and exports must be treated as first-class UI states.
- Documentation and UI terminology must stay synchronized when navigation or labels change.

## Product Direction

- Shift from feature-first navigation to task-first navigation.
- Reduce cognitive load by emphasizing one primary action per page.
- Make next steps obvious after each major action.
- Keep the translation editor stable and optimize it incrementally.

## Current Problems to Solve

- Navigation is organized by technical modules rather than user goals.
- Important actions are mixed with secondary actions on the same level.
- Many pages do not communicate clear next steps.
- Empty states and transitional states are inconsistent.
- Cross-page terminology is not fully standardized.
- The current game context is not visible enough across cross-page workflows.
- The home overview is not explicit enough if it is reachable mainly through brand navigation.
- Several low-frequency but important tools were consolidated under Settings, but their taxonomy is still too technical for non-admin users.
- Dashboard, review, coherence, imports, and editor workflows do not yet form a clear drill-down chain.
- Background job visibility is fragmented between page-local progress, health views, and hidden system state.

## Design Principles

- Task-first: every screen should answer "What should I do now?"
- Progressive disclosure: advanced actions should be visible but not dominant.
- Operational clarity: risky actions must state exact consequences.
- Consistency: same interaction patterns for tables, actions, and status.
- Translator speed first: optimize frequent workflows before edge cases.
- Keyboard-first: preserve and strengthen fast navigation for heavy editor users.
- Context persistence: game, mod, language, and queue intent should survive navigation whenever possible.
- Drill-down continuity: overview pages must open directly into filtered work views.

## Target Navigation Model

The target model should be hybrid, not purely global.

Level 1: global frame

- Home: overview, health summary, recent activity, next actions.
- Game switcher: current game context visible at all times.
- Settings and account: system-level configuration, providers, QA rules, user management.

Level 2: game workspace

- Hub: per-game overview with imported mods, active jobs, and recommended next actions.
- Discover: Nexus browsing, download state, mod details, and handoff into import.
- Import: unified intake for archives, plugins, CSV, EET, reimport, and extraction/import progress.
- Translate: mod list, mod editor, INNR editor, and special content editors.
- Quality: review queue, coherence work, glossary enforcement, and QA-driven correction flows.
- Release: diff and reimport, export readiness, TMX exchange entry points, and final packaging.

Level 3: advanced and administrative surfaces

- Settings tabs for QA rules, TradAuto, TMX maintenance, activity, provider configuration, and system operations.
- Role-aware visibility so translators see work surfaces first, while admins and reviewers get broader control surfaces.

## Current Surface to Target Mapping

- Games and game hub pages should become the entry point for context selection, not just a technical list of games.
- Nexus pages should belong to Discover and feed directly into Import.
- Imports should remain a unified job surface for archives, plugins, CSV, and EET.
- Mods and Mod Editor should remain the core Translate workspace.
- INNR and Book or HTML editing should stay attached to the editor flow as special-purpose editing tools.
- Glossary, Review Queue, and Coherence should form a connected Quality cluster instead of isolated utilities.
- Diff and reimport, export, and TMX should be presented as release-stage decisions, even if some admin entry points remain in Settings.
- Users, provider configuration, QA rules, TradAuto, activity, and ops should live under an explicit Admin or Settings taxonomy.

## Page Composition Standard

Each major page should follow a shared composition:

- Header with page goal and one primary CTA.
- Compact status strip with current state summary.
- Main work area (table/editor/list) as the visual priority.
- Secondary actions moved into overflow panels or side controls.
- Clear empty state with direct next action.
- Last activity or last result summary where the page is driven by background jobs.

## Workflow Rules for This Product

- Import must always lead to an obvious next step: inspect, reimport, open mod, or fix failure.
- Quality pages must always provide a direct path back into the editor with the correct filters or target row.
- Release pages must explain whether the user is exporting, diffing a new version, or exchanging TM data.
- Admin pages must separate system configuration from daily translator operations.
- Any workflow that spans multiple minutes must expose status, progress, and recovery guidance.

## LLM and AI Pipeline UX Strategy

The product has a full dual-provider LLM pipeline (OpenAI + Ollama with fallback), a 6-method TM waterfall, TradAuto pattern rules, and glossary injection. These are not isolated features but a layered automation stack that should be visible to users as a coherent pipeline.

Current gap: automation runs are triggered from inside the editor or Settings, but there is no global view of AI activity, job progress, or cache utilization.

Principles:

- LLM, TM, and TradAuto should appear as a unified automation tier, not separate scattered features.
- The cost and throughput of an AI run must be visible before and during the run, not only in backend logs.
- AI results that need human validation should flow automatically into the review queue.

Change now:

- ✅ Surface a provider health or readiness indicator in the Settings LLM tab — `LlmTab` now renders `llmReadiness` level/checks/issues from `GET /api/settings`.
- ✅ Make LLM batch translate progress visible at the global job level, not only inside the editor — LLM batch jobs are persisted to the `llm_jobs` DB table and visible in the unified job center on Home and Imports pages.
- ✅ After a batch LLM run completes, show a direct action to open the review queue for those strings — a banner with a `/review-queue?modId=…` deep-link appears after batch translate completion.
- ✅ Show TM cache statistics (entries, coverage) in a useful summary rather than only a raw number — `GET /api/tmx/stats` returns totalStrings, translatedStrings, coverage %, and a by-status breakdown; TmxPage shows a stats strip on load.

Do not change now:

- The batch translate trigger from the editor toolbar.
- The TM waterfall method hierarchy or matching logic.
- The TradAuto rule management surface until the Settings taxonomy is resolved.

LLM Configuration:

- LLM provider settings are currently read-only in the UI and must be set via environment variables.
- This is acceptable for now but should be reconsidered if the product moves to multi-tenant or hot-reload configuration support.

## Known UX Debts

These are specific gaps documented or discovered during development that are not yet addressed in any phase.

Editor:

- ~~No max-length visual indicator in the detail panel for strings with configurable length QA rules.~~ ✅ Resolved: `activeMaxLength` derived from QA rules is computed in `useEditorQueries` and rendered in `DetailPanel`.
- ~~Placeholder tokens are not highlighted inline in the translation textarea, though QA catches mismatches.~~ ✅ Resolved: `DetailPanel` now renders an inline highlight overlay for placeholder-like tokens using the same token patterns as backend placeholder protection.
- No page size selector in the editor grid; fixed at 100 rows per page. ✅ Resolved: pagination row now includes a 25 / 50 / 100 / 200 rows-per-page selector in `ModEditorPage`.
- ~~No direct link from the Dashboard QA summary to a filtered editor view showing only failing strings.~~ ✅ Resolved: Dashboard QA breakdown now provides drill-down into `ModEditor` with `qaOnly=1`.

Activity log:

- ~~No filter by date range, user, or mod.~~ ✅ Resolved: ActivityPage supports action, mod, date-from, and date-to filters wired to backend.
- ~~Cannot be exported as CSV from the UI; requires direct database query.~~ ✅ Resolved: `GET /api/activity/csv` returns filtered CSV; ActivityPage has an Export CSV button.

Coherence:

- ~~Bulk-apply of one translation across all conflict groups requires per-group action; no single-pass resolve.~~ ✅ Resolved: `POST /api/coherence/resolve-all` auto-applies the plurality-winner translation to every group; CoherencePage has a "Resolve All (Auto)" button with confirmation.

Review queue:

- ~~Does not show the display name of the translator who last modified a string.~~ ✅ Resolved: `translations.user_id` column added; review queue query joins users; translator display name shown in the Translator column.

Settings tabs:

- Some tabs (TradAuto, TMX) are workflow tools, not configuration. Their presence in Settings reduces discoverability.
- Activity log is in Settings even though it is a team-facing accountability surface.
- LLM tab is purely read-only, which is useful for debugging but provides no guidance when misconfigured.

Dashboard:

- ~~QA issue list has no click-through to a filtered editor session.~~ ✅ Resolved: same as the Known UX Debt entry above — Dashboard QA rows drill down to `ModEditor` with `qaOnly=1`.
- No indication of which mods have pending LLM jobs or active import jobs.

## Onboarding and First-Run Experience

The product has no guided first-run path. New users must understand Docker setup, provider configuration, game selection, and import before doing any translation work.

For now:

- Ensure all empty states on critical pages include concrete next actions, not generic placeholder text.
- Ensure the Settings LLM tab surfaces configuration status clearly when a provider is missing or unreachable.
- Ensure the Games page communicates what to do if no game is configured.

Longer term:

- A setup checklist displayed on first login covering game, provider, and first import would reduce friction significantly.
- An onboarding flow does not need to be a wizard; a persistent checklist card on the Home or Hub page is sufficient.

## Settings Taxonomy

Current Settings tabs: General, LLM, QA Rules, TradAuto, TMX, Activity, Data, Users.

Problems:

- TradAuto and TMX are workflow tools, not settings. Housing them in Settings buries them for active translators.
- Activity is an accountability surface that belongs closer to team-facing areas.
- General is used for language preferences, which are frequent actions for multi-language teams.

Target split:

- Configuration settings: General, LLM, QA Rules, Users.
- Workflow tools that belong outside Settings: TradAuto should be accessible from the Quality or Translate section; TMX should be accessible from the Release section.
- Activity should be accessible directly from the Admin or team-management section.

Transition rule: do not move TradAuto or TMX out of Settings until they have a proper target location in the new IA. Keep them in Settings with improved grouping in the interim.

## Translation Editor Strategy

The translation editor should be improved, but not rebuilt.

Change now:

- Improve focus and context around current row.
- Strengthen queue navigation for untranslated/fuzzy/QA items.
- Clarify save lifecycle states (saving, saved, failed).
- Surface next best action without changing core workflow.
- Preserve tight integration with TM suggestions, QA issues, and revision history.
- Improve discoverability of special editors for BOOK, HTML-like content, and INNR-driven naming content.

Do not change now:

- Fundamental layout structure users already rely on.
- Established hotkeys and editing sequence.
- Existing status semantics unless required by quality issues.
- The current split between main editor work and special-purpose editing tools.

## Role-Aware UX Rules

- Admin users need fast access to import, export, configuration, and user management.
- Translators need immediate access to game workspace, editor, glossary, and import status.
- Reviewers need the shortest path to Review Queue, Coherence, QA-heavy editor views, and approval actions.
- Navigation should hide irrelevant actions by role, but page layout should remain structurally familiar across roles.

## Roadmap Phases

Priority scale used in this roadmap:

- P0 Critical: blocks core workflow reliability, comprehension, or safe operation.
- P1 High: strongly improves daily translator and reviewer throughput.
- P2 Medium: meaningful UX quality improvements with lower immediate impact.
- P3 Low: useful polish or expansion work after core workflow stability.

Recommended phase priority order:

- P0: Phase 0, Phase 3.
- P1: Phase 1, Phase 4, Phase 6.
- P2: Phase 2, Phase 5.
- P3: Phase 7 (multi-user and team operations only).

Queue policy:

- Single-user translator workflow improvements come first.
- Multi-user and team-operation improvements are intentionally scheduled last.

### Phase 0: Baseline and Safety (1 sprint, Priority P0)

- Freeze structural redesign until baseline metrics are captured.
- Define terminology glossary for consistent labels in UI.
- Capture current user journeys for import, translate, and release.
- Add lightweight instrumentation for key workflow timings.
- Audit current route-to-navigation mismatches between UI and documentation.
- Identify where current pages are game-scoped, global, or settings-scoped.

Exit criteria:

- Baseline metrics documented.
- Shared terminology approved.
- Current-state IA map approved.

### Phase 1: Navigation IA Refactor (1 sprint, Priority P1)

- Implement task-first top-level navigation model.
- Add an explicit Home or Overview entry instead of relying on brand navigation.
- Introduce a persistent current-game indicator or switcher in the main frame.
- Re-group pages into Discover, Import, Translate, Quality, Release, and Admin according to context.
- Move low-frequency pages into Settings tabs or an Advanced area without hiding critical workflow entry points.
- Preserve route compatibility while updating menu structure.

Exit criteria:

- New navigation is live.
- No functional regressions in route access.
- Users can identify their current game and current workflow stage from the shell alone.

### Phase 2: Shared Page Shell (1 sprint, Priority P2)

- Introduce a consistent page shell pattern:
  header, status strip, primary CTA, main area, secondary actions.
- Apply shell to Home or Game Hub, Imports, and one Admin page first.
- Standardize empty states and loading states.
- Standardize success, warning, and recovery banners for background-job-driven pages.

Exit criteria:

- Pattern is implemented and reused.
- At least three pages migrated.
- One migrated page must be game-scoped and one must be system-scoped.

### Phase 3: Imports UX Hardening (1 sprint, Priority P0)

- Keep upload and extraction progress visible and understandable.
- Add clear state transitions from upload to extraction to ready/imported.
- Improve failure messages and recovery guidance.
- Keep risky actions guarded by clear confirmation text.
- Connect Nexus download flow and import flow as one continuous intake experience.
- ✅ Introduce a shared job center pattern for imports, downloads, and long-running operations. Home and Imports pages merge backend import jobs, live Nexus download queue, and app-level LLM/export operations in unified job lists. LLM batch jobs are persisted to the `llm_jobs` DB table and survive page reloads; completed/failed history is loaded from `GET /api/ops` on every poll cycle.

Exit criteria:

- Import flow is comprehensible without internal knowledge.
- Error states provide actionable recovery steps.
- Users can tell whether a file is uploaded, extracting, importing, failed, or ready without opening logs.

### Phase 4: Translation Editor Optimization (1-2 sprints, Priority P1) — 🔄 In Progress

- Improve row focus behavior and context readability.
- Optimize review queues and navigation shortcuts.
- ✅ Clarify state feedback for save and validation outcomes — `saveIndicator` (`saving / saved / idle`) implemented in `useEditorMutations`; shown in `DetailPanel`.
- ✅ Internal architecture refactoring — `ModEditorPage` (~1300 → ~310 lines): 11 sub-components under `components/`, 5 custom hooks (`useThemeObserver`, `useEditorQueries`, `useEditorMutations`, `useAutosave`, `useEditorKeyboard`) under `hooks/`, 5 one-function utilities under `utils/`; keyboard shortcut hook uses ref-pattern, eliminating 3 `exhaustive-deps` lint warnings.
- Remove or demote secondary actions that interrupt editing flow.
- ✅ Add better drill-down paths from Dashboard, Review Queue, and Coherence into filtered editor sessions — Dashboard QA ✅, ReviewQueuePage rows link to editor with `?status=` ✅, CoherencePage VariantCard entries now include per-string ↗ links to `/games/:gameId/mods/:modId?status=…&signature=…` ✅.
- ✅ `ModEditorPage` now reads `?signature=` from URL search params, enabling pre-filtered views from coherence and other drill-down sources.
- Improve discoverability and consistency of special editors without moving them out of the translation workflow.

Exit criteria:

- Faster operator throughput on daily translation tasks.
- Reduced context switching in editor sessions.
- Review and coherence work can return users to the exact correction surface with minimal navigation.

### Phase 5: Release Workflow Coherence (1 sprint, Priority P2)

- Align export and diff/reimport flow under Release.
- Add final pre-release checklist presentation.
- Make post-import and pre-release next actions explicit.
- Clarify when TMX belongs to release workflow versus administrative maintenance.
- Surface activity and audit visibility where team handoff matters.

Exit criteria:

- Release path is linear and predictable.
- Fewer manual back-and-forth steps between pages.
- Export, diff, and handoff decisions are understandable without technical knowledge of the pipeline.

### Phase 6: AI Pipeline Visibility and Known Debt Reduction (1-2 sprints, Priority P1)

- ✅ Add provider health indicator to Settings LLM tab — readiness badge/checks/issues are exposed in `Settings -> LLM` via `llmReadiness`.
- ✅ Add post-batch-translate action card that links directly to the review queue for those strings — a banner with a `/review-queue?modId=…` link appears after batch translate completion in the editor.
- ✅ Add Dashboard QA click-through to filtered editor sessions — Dashboard QA breakdown rows now include direct drill-down to `ModEditor` with `qaOnly=1`.
- ✅ Add max-length visual indicator in editor detail panel for strings with length QA rules — `activeMaxLength` computed from QA rules matching current row's `signature` and `path`; rendered in `DetailPanel`.
- ✅ Add onboarding checklist on Home or Game Hub for first-time setup — `SetupChecklist` card on HomePage shows LLM readiness, first mod import, and first translation run; auto-hides when all items are satisfied.

Exit criteria:

- AI job status is visible without opening the editor or reading logs.
- The five highest-priority known UX debts listed in this document are resolved.

### Phase 7: Multi-user and Team Operations (1 sprint, Priority P3)

- ✅ Activity log filters: date range, user, mod. ActivityPage now supports action, mod (entity), date-from, and date-to filters. Backend `getActivityLog` / `getActivityCount` accept `entityType`, `entityId`, `dateFrom`, `dateTo` params.
- ✅ Activity log CSV export from the UI. `GET /api/activity/csv` returns a filtered CSV download (max 10 000 rows); ActivityPage has an Export CSV button.
- Settings taxonomy for team operations and admin-only surfaces.
- Evaluate role-aware navigation visibility and empty states after single-user IA is stable.

Exit criteria:

- Team operations are discoverable without impacting single-user translation speed.
- Multi-user specific surfaces are grouped consistently and do not fragment core translator flows.

## Backlog of Concrete UX Improvements

- ✅ One primary CTA per major page. Add/create action buttons on TradAutoPage, QARulesPage, GlossaryPage, ImportsPage, and TmxPage now use `--accent` (brand amber) for visual primary hierarchy.
- ✅ Explicit Home or Overview navigation entry. Main nav now includes a dedicated `Home` link instead of relying on brand navigation only.
- ✅ Persistent current game and language context in the app shell. AppNav now shows the current game workspace (persisted from game-scoped routes) plus the current source/target content language pair.
- ✅ Per-game hub cards for Imports, Mods, Review, and Release. `GameHubPage` now exposes workflow cards for Import, Translate, Quality, and Release, with per-game counters plus a secondary Discover entry.
- ✅ Overflow menu for secondary actions in dense row UIs. Shared `OverflowMenu` component; TradAutoPage and QARulesPage rows keep Edit inline and collapse Delete into overflow `⋯` menu.
- ✅ Unified status badge system and color semantics. `StatusBadge` used in all status-display contexts; CoherencePage VariantCard replaced raw status text with `<StatusBadge>`.
- ✅ Consistent danger confirmation modal pattern. Shared `ConfirmModal` replaces `window.confirm` in TradAutoPage and QARulesPage.
- ✅ Better wording for destructive operation outcomes. Toast notification appears after rule deletion in TradAutoPage and QARulesPage.
- ✅ Unified job center for uploads, Nexus downloads, imports, exports, and LLM operations. Home and Imports now show unified job views combining import jobs, Nexus downloads, and app-level LLM/export jobs.
- ✅ Deep links from overview and quality pages into pre-filtered editor views. ReviewQueuePage rows link to editor with `?status=` parameter; CoherencePage VariantCard entries include per-string links.
- ✅ Role-aware navigation visibility and empty states. `/users` nav link and Settings Users tab gated to `admin` role.
- ✅ Settings taxonomy that separates translators' tools from admin-only configuration. Settings tab bar shows separator before admin tabs; Users tab only for admin in multi-user mode.
- ✅ Better surfacing of INNR and Book or HTML editors when relevant content exists. EditorToolbar shows a BOOK button when the mod has BOOK records.
- ✅ Activity log filters by mod, user, and date range. ActivityPage: action, mod, date-from, date-to filters, all wired to backend.
- ✅ Activity log CSV export from the UI. Downloads filtered result via `/api/activity/csv`.
- ✅ Persistent queue intent such as untranslated, TM, auto, or QA backlog across navigation. ModEditorPage stores `{ status, qaOnly, signature }` in `localStorage` and restores on next visit.
- ✅ Queue-focused navigation controls in translation workflows. Visible “Next untranslated (N)” button in EditorToolbar.
- ✅ Deterministic empty states with immediate action buttons. Rolled out on core workflow pages (Imports, Review Queue, Game Mods search, Coherence, and Diff) with direct next-step CTAs.
- ✅ Placeholder token highlighting inline in the translation textarea. DetailPanel now highlights placeholder-like tokens inline while QA still enforces mismatch detection.
- ✅ Max-length visual indicator in the editor detail panel.
- ✅ Optional page size selector in the editor grid. Pagination row now includes a 25†50†100†200 rows/page select.
- ✅ Dashboard QA breakdown click-through to filtered editor. Dashboard QA rows drill down to `ModEditor` with `qaOnly=1`.
- ✅ LLM provider health or readiness status in Settings.
- ✅ Post-LLM-run action prompt linking directly to review queue. After batch translate completion, a banner appears with a direct link to `/review-queue?modId={{modId}}`.
- ✅ Onboarding checklist for first-time users. `SetupChecklist` on HomePage tracks LLM readiness, first import, and first translation run.
- ✅ Translator display name in the review queue row. `translations.user_id` column added; review queue query joins users; Translator column shown in the table.

## Prioritized Backlog

P0 Critical:

- ✅ Unified job center for uploads, Nexus downloads, imports, exports, and LLM operations. Home and Imports now show unified job views combining import jobs, Nexus downloads, and app-level LLM/export jobs. LLM batch jobs are persisted to DB (`llm_jobs` table) and survive page reloads.
- ✅ Dashboard QA breakdown click-through to filtered editor.
- ✅ LLM provider health or readiness status in Settings.
- ✅ Max-length visual indicator in the editor detail panel.

P1 High:

- ✅ Explicit Home or Overview navigation entry. Main nav now includes a dedicated `Home` link instead of relying on brand navigation only.
- ✅ Persistent current game and language context in the app shell. The shell now persists the last game-scoped route and surfaces current game plus content-language pair directly in AppNav.
- ✅ Per-game hub cards for Imports, Mods, Review, and Release. GameHub now acts as a real workflow hub with dedicated cards for Import, Translate, Quality, and Release.
- ✅ Deep links from quality pages into pre-filtered editor views. ReviewQueuePage rows now link to editor with `?status={{row.status}}` parameter.
- ✅ Placeholder token highlighting inline in the translation textarea. DetailPanel now highlights placeholder-like tokens inside the editor field while keeping QA mismatch validation unchanged.

P2 Medium:

- ✅ One primary CTA per major page. Add/create action buttons on TradAutoPage, QARulesPage, GlossaryPage, ImportsPage, and TmxPage now use `--accent` (amber brand color) for visual hierarchy.
- ✅ Overflow menu for secondary actions in dense row UIs. Shared `OverflowMenu` component extracted; TradAutoPage and QARulesPage rows now keep Edit inline and collapse Delete into an overflow `⋯` menu.
- ✅ Unified status badge system and color semantics. `StatusBadge` is now used in all status-display contexts; CoherencePage `VariantCard` replaced raw status text with `<StatusBadge>`.
- ✅ Consistent danger confirmation modal pattern. Shared `ConfirmModal` component replaces all `window.confirm` calls in TradAutoPage and QARulesPage.
- ✅ Better wording for destructive operation outcomes. Toast notification appears after rule deletion in TradAutoPage and QARulesPage.
- ✅ Better surfacing of INNR and Book or HTML editors when relevant content exists. EditorToolbar now shows a BOOK button when the mod contains BOOK records.
- ✅ Queue-focused navigation controls in translation workflows. EditorToolbar now includes a visible "Next untranslated (N)" button when untranslated strings remain.
- ✅ Deterministic empty states with immediate action buttons. Core workflow pages now expose action-first empty states with direct next-step buttons.
- ✅ Onboarding checklist for first-time users. `SetupChecklist` on HomePage tracks LLM readiness, first import, and first translation run; auto-hides when all items are satisfied.

P3 Low:

- ✅ Optional page size selector in the editor grid. Pagination row now includes a 25 / 50 / 100 / 200 rows-per-page dropdown.
- ✅ Role-aware navigation visibility and empty states. `/users` nav link and Settings Users tab are now gated to `admin` role (not just multiUser mode).
- ✅ Settings taxonomy that separates translators' tools from admin-only configuration. SettingsPage tab bar shows a visual separator before admin tabs; Users tab only rendered for admin role in multi-user mode.
- ✅ Activity log filters by mod, user, and date range. ActivityPage: action, mod (entity), date-from, and date-to filters wired to backend.
- ✅ Activity log CSV export from the UI. Export CSV button downloads filtered log via `/api/activity/csv`.
- ✅ Translator display name in the review queue row. `translations.user_id` column added; review queue query joins users; Translator column shown in the table.
- ✅ Persistent queue intent such as untranslated, TM, auto, or QA backlog across navigation. ModEditorPage stores `{ status, qaOnly, signature }` in `localStorage[editor-intent-{modId}]` and restores on next visit (URL param always takes priority).

## Performance Targets

These targets define acceptable performance for the product at expected scale.
Exceeding any of these thresholds should trigger a performance investigation.

- Editor filter response: under 2 seconds for a mod with up to 60 000 strings.
- Full mod import end-to-end: under 30 seconds for a typical loose-file archive.
- TM lookup for a single string: under 200 ms.
- LLM batch throughput: defined by provider; UI must not block during the run.
- Dashboard load: under 2 seconds for up to 20 mods with full statistics.
- Maximum stable TM size: 500 000 entries with acceptable query latency.

The editor already uses a virtualizer for large string lists. Pagination and
server-side filtering are in place. These targets define when further optimization is required.

## Success Metrics

- Reduced time from file upload to first actionable import state.
- Reduced time from Nexus download start to import-ready state.
- Reduced time from opening editor to first translation edit.
- Reduced time from review queue entry to approval or correction completion.
- Reduced number of mis-clicks on destructive actions.
- Reduced support questions about "what to do next".
- Reduced route-hopping between dashboard, quality pages, and editor.
- Improved completion rate of import-to-release workflow.
- Editor filter latency stays within performance targets at 60K-string mods.
- LLM batch operations do not block or freeze the editor UI.

## Execution Rules

- Ship improvements in small, testable increments.
- Keep user-facing terminology stable once standardized.
- Do not batch major IA and editor behavior changes in one release.
- Validate each phase with internal users before proceeding.
- Update user-facing documentation when navigation labels, page names, or workflow entry points change.
- Preserve keyboard-heavy workflows when introducing new navigation or shell layers.

## Risks and Mitigations

- Risk: navigation changes may disorient existing users.
  Mitigation: preserve routes and keep naming familiar during transition.

- Risk: editor changes may reduce expert speed.
  Mitigation: prioritize additive improvements over layout rewrites.

- Risk: visual consistency work may delay feature delivery.
  Mitigation: use a phased migration and apply shared shell progressively.

- Risk: role-aware navigation may create confusion if pages disappear unexpectedly.
  Mitigation: keep shell structure stable and explain restricted surfaces clearly.

- Risk: a purely task-first IA may break game-scoped mental models.
  Mitigation: keep selected game context visible and organize tasks inside that context.

## Working Sequence

- Start with Phase 0 immediately.
- Proceed phase-by-phase only after exit criteria are met.
- Track completed items directly in this roadmap file.
