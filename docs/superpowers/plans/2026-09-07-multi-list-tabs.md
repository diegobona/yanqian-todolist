# Multiple Todo Tabs Implementation Plan

**Goal:** Replace the fixed Todo/Done navigation with user-managed todo-list tabs plus one permanent completed tab.

**Architecture:** Keep one `todoList` array for backward compatibility and add stable `tabId` metadata to active tasks. Persist editable `tabs` separately; keep completed tasks in `doneList` with their originating tab identity so restoration can recreate a deleted tab. Deleting a tab moves its tasks to the existing recycle bin.

### Task 1: Repository tab model

1. Add failing migration, CRUD, scoped reorder, delete-to-trash, and restore tests.
2. Normalize legacy data into a default `待办` tab.
3. Implement add, rename, and delete tab commands; validate names and stable IDs.
4. Make task creation and reorder tab-aware; retain origin on completion and restore.

### Task 2: Safe delete action

1. Add a failing main-process integration test for confirmation and permanent completed-tab protection.
2. Add a native confirmation dialog before deleting a tab with tasks.

### Task 3: Dynamic navigation

1. Add renderer/component tests for default Chinese tabs, add, inline rename, delete, and route selection.
2. Render horizontally scrollable todo tabs, fixed `已完成`, add control, and an active-tab menu in `App.vue`.
3. Immediately edit a newly added tab name; allow rename/delete on every todo tab.

### Task 4: Filter Todo by active tab

1. Add failing tests that tasks only render in their selected tab and new tasks use that tab.
2. Filter Todo by route `tab`, pass `tabId` to add/reorder, and flush edits before tab navigation.
3. Show restored tasks in their original tab, recreating that tab when it was deleted.

### Task 5: Verify desktop behavior

1. Run the full test suite, lint, and production compile.
2. Rebuild the Windows installer.
3. Run packaged Electron smoke checks and restart the local development window.
