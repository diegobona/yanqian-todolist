# Task Screenshot Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Let a user paste one or more clipboard screenshots onto a specific todo, collapse or expand them below the task, preview them, delete them, and keep them with the task through completion, deletion, export, and import.

**Architecture:** Keep task metadata in the existing local JSON state and store PNG bytes in an `attachments` directory beside that state. Electron owns clipboard and filesystem access; the renderer receives task snapshots and lazily requests safe data URLs for visible thumbnails. Export files bundle attachment bytes, while the live data file remains small. Existing task moves preserve screenshot metadata automatically.

**Tech Stack:** Electron 11, Vue 2, Node.js `fs`/`crypto`, Node test runner, Vue Test Utils.

---

### Task 1: Add local screenshot storage to the repository

**Files:**
- Modify: `src/services/taskRepository.js`
- Test: `tests/taskRepository.test.cjs`

1. Add failing tests for PNG validation, attachment metadata, external binary storage, restart persistence, and preservation through complete/trash/restore.
2. Run `node --test tests/taskRepository.test.cjs` and confirm the new tests fail for missing APIs.
3. Add normalized `screenshots` metadata, a safe attachment directory, atomic PNG writes, ownership-checked `addScreenshot`, `readScreenshot`, and `removeScreenshot`.
4. Enforce concrete limits: PNG only, valid IHDR/IEND structure, at most 15 MB and 40 megapixels per image, at most 20 screenshots per task, and generated filenames only.
5. Keep removed binaries as recoverable local orphans so rolling backups and trash restoration never reference a prematurely deleted file. Defer orphan cleanup and document that choice.
6. Re-run the repository tests.

### Task 2: Include screenshots in full export and import

**Files:**
- Modify: `src/services/taskRepository.js`
- Test: `tests/taskRepository.test.cjs`

1. Add a failing cross-repository export/import round-trip test that verifies PNG bytes and task associations.
2. Add export-only attachment payloads and safe import extraction with newly generated local file IDs, traversing Todo, Done, and Trash.
3. Reject malformed, oversized, missing, duplicate, dangling, or non-PNG attachment payloads before changing live state; cap the total import file at 200 MB.
4. Stage and validate all image writes before committing state; on any image, safety-copy, or JSON failure, leave the old state and old attachment files usable and remove newly staged files.
5. Make startup restore accept the same bundled format, while rolling JSON backups retain working image references because local orphan files are preserved.
6. Re-run repository and recovery tests, including failures during attachment write and final JSON replacement.

### Task 3: Expose clipboard and screenshot actions through Electron

**Files:**
- Modify: `src/utils/backgroundExtra.js`
- Modify: `src/utils/taskClient.js`
- Test: `tests/background.integration.test.cjs`

1. Add failing IPC tests for reading a screenshot, pasting from the system clipboard, empty clipboard feedback, hidden/missing target rejection, and confirmed deletion.
2. Add asynchronous lazy `readScreenshot`, `pasteScreenshot`, and `deleteScreenshot` actions; validate Electron `nativeImage` decode and pixel dimensions before repository writes.
3. Keep task editing intact by adding a task-client action path that does not globally flush or navigate.
4. Re-run background integration tests.

### Task 4: Build the shared collapsible screenshot UI

**Files:**
- Create: `src/components/TaskScreenshots.vue`
- Modify: `tests/components.test.cjs`

1. Add failing component tests for `N 张截图`, collapsed default, single-item expansion, lazy image loading, preview, and delete event.
2. Implement the shared component with a compact summary row, vertical thumbnail list, fixed large preview, keyboard labels, and event propagation guards.
3. Close and clear previews on Escape, close button, attachment deletion, task hiding, and component/page destruction; restore focus to the thumbnail when possible.
4. Re-run component tests.

### Task 5: Attach screenshots from Todo

**Files:**
- Modify: `src/views/Todo.vue`
- Modify: `tests/components.test.cjs`

1. Add failing tests for image paste onto the editing task, text paste pass-through, no-selected-task feedback, hover paste control, auto-expand, and hidden-task privacy.
2. Register and clean up the window paste handler.
3. Capture the stable task ID at paste time, save current text before attachment, call Electron for the clipboard PNG, then expand only that task. Stop if text save fails; reject a hidden or meanwhile removed/completed target; serialize repeated pastes so none overwrite newer text.
4. Add the per-task paste icon beside the visibility control and wire folding, preview, and deletion.
5. Re-run component tests.

### Task 6: Preserve the experience in Done

**Files:**
- Modify: `src/views/Done.vue`
- Modify: `tests/components.test.cjs`

1. Add failing tests that completed tasks show the same collapsed screenshot row and that hidden items expose no image UI.
2. Reuse the shared screenshot component, single-expanded-task state, and deletion action.
3. Re-run component tests.

### Task 7: Verify the packaged desktop behavior

**Files:**
- Modify if needed: `scripts/native-smoke.cjs`
- Modify if needed: `README.md`

1. Run the full unit/integration suite and lint, including legacy Excel behavior.
2. Run the production compile and package build.
3. Run native Electron 11 smoke verification against an isolated data directory, exercising `clipboard`, `nativeImage`, PNG decoding, dimensions, filesystem persistence, and restart reads.
4. Start the local development app with `.local-debug-data` so the user can test Ctrl+V, folding, preview, delete, completion, and restart persistence.
