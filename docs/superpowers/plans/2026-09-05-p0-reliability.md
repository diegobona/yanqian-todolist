# P0 desktop reliability implementation plan

> For agentic workers: use superpowers:subagent-driven-development or superpowers:executing-plans. Check off verified steps. User has authorized implementation of all P0 items.

**Goal:** Reliable local task persistence, completion/history, window recovery, state restoration, undo/trash and backup/import.

**Architecture:** One main-process local JSON repository owns all writes. Complete/restore/delete are atomic state transitions; renderer uses a narrow IPC client and stable task IDs. Preserve old data.json/data-dev.json and window-state.json with migrations and pre-change backups. UI persists input immediately and presents storage failures. No cloud service or login is introduced.

**Tech Stack:** Existing Vue 2/Electron application, Node built-in test runner for filesystem and lifecycle regressions, Electron UI smoke tests where available.

## Scope and evidence

- P0-1: Done has a 224px heading in a 290px window; data completion is split across two writes. Reproduce both independently, without equating reports to proven loss.
- P0-2: Native menu hook disables windows and uses an unguarded delayed callback. Verify Show Desktop/recovery behavior and report OS limits honestly.
- P0-3/P0-5: second-instance resets position but never shows the window. Keep valid bounds, recover offscreen windows, reset click-through when explicitly restored, add configurable global shortcut and tray recovery.
- P0-4: sort does not persist, edits have no leave persistence, filtering invalidates index-based identity.
- P0-6: preserve data before migration/import; bounded automatic backups, strict import validation, recoverable trash and completion undo. Existing Excel export stays.

## Task 1 — Baseline and regression harness
- [x] Save source baseline for review (input is not a Git repository).
- [x] Normalize obsolete package tarball URLs, install pinned npm dependencies, add npm test. Electron binary download remains blocked.
- [x] Write and run failing filesystem/task-state and window lifecycle tests.

## Task 2 — Local data service
Files: src/services/taskRepository.js, src/utils/db.js, src/utils/backgroundExtra.js, tests/taskRepository.test.cjs.
- [x] Validate/migrate IDs and schema without dropping tasks; preserve originals.
- [x] Implement atomic save, stable-ID update/reorder, atomic complete/restore, trash/restore and last-completion undo.
- [x] Implement bounded automatic backups and validated export/import, recovery on damaged primary data, visible errors.
- [x] Run real temporary-filesystem tests including write failures and invalid imports.

## Task 3 — Window recovery
Files: src/background.js, src/services/windowController.js, tests/windowController.test.cjs.
- [x] Regress duplicate launch, hidden/minimized/click-through/destroyed windows and disconnected displays at the mocked native boundary.
- [x] Remove unsafe native disable hook; normal window lifecycle, safe re-show, correct work-area origin, persistent bounds.
- [x] Add shortcut registration rollback, tray show/exit and first-hide guidance.
- [x] Run lifecycle tests.
- [ ] Run native Electron smoke checks (runtime download approval blocked).

## Task 4 — Renderer and local recovery UI
Files: src/utils/taskClient.js, src/views/Todo.vue, src/views/Done.vue, src/App.vue, src/views/Settings.vue, src/router/index.js.
- [x] Stable IDs for edit/drag, synchronous acknowledged local input persistence, no index timers; flush/handle failures on navigation/hide/exit.
- [x] Compact visible history groups and empty/error states; completion undo and recoverable trash.
- [x] Settings for global shortcut, backup/export/import and data location; retain Excel export.
- [x] Verify actual mounted Vue components and repository reopen persistence using isolated test data.
- [ ] Verify native renderer flows and actual app restart.

## Task 5 — Review and delivery
- [x] Review implementation for P0 coverage, data loss and lifecycle regressions. Independent review findings fixed and regression tested; reviewer final follow-up blocked by usage limit, fixes checked by primary agent.
- [x] Run 54 tests, lint without auto-fix, production renderer and main source compilation.
- [ ] Run Electron directory/installer build and native smoke tests.
- [x] Exercise completion/repository reopen, edit/navigation, sort, undo/trash, backup/import, hide/recover and bounds through filesystem, mounted component and mocked-native integration tests.
- [ ] Exercise the corresponding real desktop flows.
- [x] Document commands, local data/backup paths and native OS verification limits in docs/P0-validation.md.

## Work policy
Keep P1 features out. Use isolated test userData so development never changes a user's real tasks or startup settings. No deployment or cloud writes. If full OS reproduction is unavailable, document tested behavior and outstanding OS combinations rather than claiming universal coverage.
