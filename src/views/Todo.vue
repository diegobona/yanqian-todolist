<template>
  <div class="root" @click="add">
    <p v-if="error" class="error" role="alert" @click.stop>
      {{ error }} <button @click.stop="edited">重试保存</button>
    </p>
    <p v-if="notice" class="notice" role="status" @click.stop>{{ notice }}</p>
    <draggable
      class="list"
      v-model="todoList"
      :disabled="editId !== ''"
      :animation="200"
      :move="allowTaskMove"
      ghost-class="ghost"
      @start="dragStarted"
      @end="sorted"
    >
      <div
        class="item"
        :class="{ selected: selectedId === todo.id }"
        v-for="(todo, index) in todoList"
        :key="todo.id"
        @click.stop="queueEdit($event, todo.id)"
      >
        <div class="item-main">
          <input
            class="todo-checkbox"
            type="checkbox"
            :aria-label="
              todo.hidden
                ? '完成隐藏事项'
                : `完成事项：${todo.content || '空白草稿'}`
            "
            @click.stop
            @change.stop="done($event, todo.id)"
          />
          <p
            v-if="todo.id !== editId"
            :class="{ concealed: todo.hidden }"
            :title="todo.hidden ? '事项已隐藏' : todo.content"
          >
            {{ index + 1 }}.{{
              todo.hidden
                ? "••••••"
                : previewText(todo.content) || "空白草稿（点击继续编辑）"
            }}
          </p>
          <div class="edit" v-else>
            <textarea
              ref="editor"
              rows="1"
              v-model="draft"
              v-focus
              @input="persistInput"
              @compositionend="persistInput"
              @click.stop
              @dblclick.stop
              @keydown.esc="cancel($event)"
              @keydown.ctrl.s.prevent.stop="edited($event)"
              @keydown.meta.s.prevent.stop="edited($event)"
              spellcheck="false"
              aria-label="编辑事项"
            />
            <i
              class="iconfont icon-select"
              title="保存（Ctrl+S）"
              @click.stop="edited"
            ></i>
            <i
              class="iconfont icon-close"
              title="移到回收站"
              @click.stop="clear(todo.id)"
            ></i>
          </div>
          <button
            v-if="!todo.hidden"
            class="screenshot-paste"
            type="button"
            title="粘贴剪贴板截图"
            aria-label="粘贴剪贴板截图"
            :disabled="screenshotBusy"
            @click.stop="attachScreenshot(todo.id)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 5h16v14H4zM7 15l3-3 2 2 2-2 3 3M8 9h.01" />
            </svg>
          </button>
          <button
            class="pin-toggle"
            :class="{ pinned: todo.pinned }"
            type="button"
            :title="todo.pinned ? '取消置顶' : '置顶事项'"
            :aria-label="todo.pinned ? '取消置顶' : '置顶事项'"
            :aria-pressed="String(!!todo.pinned)"
            @click.stop="togglePinned(todo)"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M8 3h8l-1 7 4 4v2H5v-2l4-4-1-7Z M12 16v5" />
            </svg>
          </button>
          <i
            :class="[
              'iconfont',
              'visibility-toggle',
              todo.hidden ? 'icon-browse' : 'icon-eye-close'
            ]"
            :title="todo.hidden ? '显示此事项' : '隐藏此事项'"
            :aria-label="todo.hidden ? '显示此事项' : '隐藏此事项'"
            @click.stop="toggleVisibility(todo)"
          ></i>
        </div>
        <p v-if="todo.id === editId" class="editor-hint" @click.stop>
          Enter 换行 · Ctrl+S 保存
        </p>
        <TaskScreenshots
          v-if="!todo.hidden && todo.screenshots && todo.screenshots.length"
          :task="todo"
          list="todoList"
          :expanded="expandedId === todo.id"
          @toggle="toggleScreenshots"
          @delete="deleteScreenshot(todo.id, $event)"
          @error="setNotice"
        />
      </div>
    </draggable>
    <p v-if="!todoList.length && !error" class="empty">
      点击空白处，记录一件事
    </p>
  </div>
</template>
<script>
import draggable from "vuedraggable";
import { fireworks } from "@/utils/fireworks";
import taskClient from "@/utils/taskClient";
import TaskScreenshots from "@/components/TaskScreenshots.vue";

export default {
  name: "Todo",
  components: { draggable, TaskScreenshots },
  data() {
    return {
      todoList: [],
      editId: "",
      selectedId: "",
      draft: "",
      original: null,
      drag: false,
      error: "",
      notice: "",
      expandedId: "",
      screenshotBusy: false,
      pasteQueue: Promise.resolve()
    };
  },
  methods: {
    togglePinned(todo) {
      if (!this.edited()) return;
      if (this.apply("setPinned", { id: todo.id, pinned: !todo.pinned }))
        taskClient.changed();
    },
    allowTaskMove(event) {
      const from = event.draggedContext.element;
      const to = event.relatedContext.element;
      return !to || !!from.pinned === !!to.pinned;
    },
    previewText(content) {
      const chars = Array.from(content || "");
      return chars.length > 100 ? chars.slice(0, 100).join("") + "…" : content;
    },
    currentTabId(state) {
      const requested = this.$route && this.$route.query.tab;
      return state.tabs.some(tab => tab.id === requested)
        ? requested
        : state.tabs[0]
        ? state.tabs[0].id
        : "";
    },
    setTodoList(state) {
      const tabId = this.currentTabId(state);
      this.todoList = state.todoList
        .filter(todo => todo.tabId === tabId)
        .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
    },
    reload() {
      if (this.editId) return;
      try {
        this.setTodoList(taskClient.snapshot());
        if (!this.todoList.some(item => item.id === this.selectedId))
          this.selectedId = "";
        this.error = "";
      } catch (error) {
        this.error = error.message;
      }
    },
    apply(action, payload) {
      try {
        const state = taskClient.command(action, payload);
        this.setTodoList(state);
        this.error = "";
        return state;
      } catch (error) {
        this.error = `未保存：${error.message}`;
        return null;
      }
    },
    setNotice(message) {
      clearTimeout(this.noticeTimer);
      this.notice = message || "";
      if (this.notice)
        this.noticeTimer = setTimeout(() => {
          this.notice = "";
        }, 2600);
    },
    add() {
      if (this.editId) {
        this.edited();
        return;
      }
      const snapshot = taskClient.snapshot();
      const tabId = this.currentTabId(snapshot);
      if (!tabId) {
        this.setNotice("请先新建一个待办清单");
        return;
      }
      const state = this.apply("add", { content: "", tabId });
      if (!state) return;
      const item = state.todoList
        .filter(todo => todo.tabId === tabId)
        .slice(-1)[0];
      this.editId = item.id;
      this.selectedId = item.id;
      this.draft = "";
      this.original = null;
    },
    queueEdit(event, id) {
      clearTimeout(this.clickTimer);
      const item = this.todoList.find(todo => todo.id === id);
      if (!item || item.hidden || this.drag || (event && event.detail > 1))
        return;
      this.selectedId = id;
      this.editing(id);
    },
    dragStarted() {
      clearTimeout(this.clickTimer);
      this.drag = true;
    },
    editing(id) {
      if (this.editId === id) return;
      if (!this.edited()) return;
      const item = this.todoList.find(todo => todo.id === id);
      if (!item) return;
      this.original = { ...item };
      this.editId = id;
      this.selectedId = id;
      this.draft = item.content;
    },
    persistInput(event) {
      if (event && event.target) this.draft = event.target.value;
      this.resizeEditor();
      if (!this.editId || !this.draft.trim()) return true;
      return !!this.apply("update", { id: this.editId, content: this.draft });
    },
    resizeEditor() {
      const refs = this.$refs.editor;
      const el = Array.isArray(refs) ? refs[0] : refs;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    },
    edited(event) {
      if (event && (event.isComposing || event.keyCode === 229)) return false;
      clearTimeout(this.clickTimer);
      if (!this.editId) {
        if (this.error) this.reload();
        return !this.error;
      }
      const input = this.$refs && this.$refs.editor;
      const el = Array.isArray(input) ? input[0] : input;
      if (el) this.draft = el.value;
      let saved;
      if (this.draft.trim())
        saved = this.apply("update", { id: this.editId, content: this.draft });
      else {
        const item = this.todoList.find(t => t.id === this.editId);
        saved = this.apply(
          item && item.content.trim() ? "delete" : "discardDraft",
          { id: this.editId, list: "todoList" }
        );
      }
      if (!saved) return false;
      this.editId = "";
      this.original = null;
      this.draft = "";
      taskClient.changed();
      return true;
    },
    cancel(event) {
      if (event && (event.isComposing || event.keyCode === 229)) return;
      const id = this.editId;
      const saved = this.original
        ? this.apply("update", { id, content: this.original.content })
        : this.apply("delete", { id, list: "todoList" });
      if (!saved) return;
      this.editId = "";
      this.original = null;
      this.draft = "";
      taskClient.changed();
    },
    clear(id) {
      if (!this.apply("delete", { id, list: "todoList" })) return;
      if (this.expandedId === id) this.expandedId = "";
      if (this.selectedId === id) this.selectedId = "";
      this.editId = "";
      this.original = null;
      this.draft = "";
      taskClient.changed();
    },
    done(event, id) {
      clearTimeout(this.clickTimer);
      const source =
        event && event.target && event.target.closest(".item-main");

      const bounds = source && source.getBoundingClientRect();

      if (!this.edited()) return;
      if (!this.todoList.some(t => t.id === id)) return;
      if (this.apply("complete", { id })) {
        if (!this.shatterCleanups) this.shatterCleanups = new Set();
        const cleanup = fireworks(bounds);
        this.shatterCleanups.add(cleanup);
        setTimeout(() => this.shatterCleanups.delete(cleanup), 1300);
        if (this.expandedId === id) this.expandedId = "";
        if (this.selectedId === id) this.selectedId = "";
        taskClient.changed();
      }
    },
    toggleVisibility(todo) {
      clearTimeout(this.clickTimer);
      if (!this.edited()) return;
      if (
        this.apply("setVisibility", {
          list: "todoList",
          id: todo.id,
          hidden: !todo.hidden
        })
      ) {
        if (!todo.hidden && this.expandedId === todo.id) this.expandedId = "";
        if (!todo.hidden && this.selectedId === todo.id) this.selectedId = "";
        taskClient.changed();
      }
    },
    toggleScreenshots(id) {
      this.expandedId = this.expandedId === id ? "" : id;
    },
    attachScreenshot(taskId) {
      clearTimeout(this.clickTimer);
      const target = this.todoList.find(todo => todo.id === taskId);
      if (!target || target.hidden) {
        this.setNotice("请先显示要添加截图的事项");
        return Promise.resolve(false);
      }
      this.selectedId = taskId;
      if (this.editId === taskId) {
        if (!this.persistInput()) return Promise.resolve(false);
      } else if (this.editId && !this.edited()) return Promise.resolve(false);
      const run = this.pasteQueue.then(async () => {
        const current = taskClient
          .snapshot()
          .todoList.find(todo => todo.id === taskId);
        if (!current) throw Error("事项已变化，请重新选择后粘贴");
        if (current.hidden) throw Error("请先显示要添加截图的事项");
        this.screenshotBusy = true;
        await taskClient.attachment("pasteScreenshot", {
          list: "todoList",
          taskId
        });
        this.setTodoList(taskClient.snapshot());
        this.expandedId = taskId;
        this.setNotice("截图已添加");
        return true;
      });
      this.pasteQueue = run.catch(() => false);
      return run
        .catch(error => {
          this.setNotice(error.message);
          return false;
        })
        .finally(() => {
          this.screenshotBusy = false;
        });
    },
    async deleteScreenshot(taskId, screenshotId) {
      try {
        const value = await taskClient.attachment("deleteScreenshot", {
          list: "todoList",
          taskId,
          screenshotId
        });
        if (value.canceled) return;
        this.setTodoList(taskClient.snapshot());
        const task = this.todoList.find(item => item.id === taskId);
        if (!task || !task.screenshots.length) this.expandedId = "";
      } catch (error) {
        this.setNotice(error.message);
      }
    },
    onPaste(event) {
      const items = Array.from(
        (event.clipboardData && event.clipboardData.items) || []
      );
      if (!items.some(item => /^image\//.test(item.type || ""))) return;
      event.preventDefault();
      const taskId = this.editId || this.selectedId;
      if (!taskId) {
        this.setNotice("先点一下要添加截图的事项");
        return;
      }
      this.attachScreenshot(taskId);
    },
    sorted() {
      this.drag = false;
      const state = taskClient.snapshot();
      if (
        !this.apply("reorder", {
          tabId: this.currentTabId(state),
          ids: this.todoList.map(t => t.id)
        })
      ) {
        // Show the persisted order on failure; do not imply the sort was saved.
        try {
          this.setTodoList(taskClient.snapshot());
        } catch (error) {
          this.error = error.message;
        }
      }
    }
  },
  created() {
    this.reload();
    this.unregisterFlush = taskClient.registerFlush(() => this.edited());
    window.addEventListener("tasks:changed", this.reload);
    window.addEventListener("paste", this.onPaste);
    window.addEventListener("resize", this.resizeEditor);
  },
  beforeRouteLeave(to, from, next) {
    next(this.edited() ? undefined : false);
  },
  beforeRouteUpdate(to, from, next) {
    if (!this.edited()) {
      next(false);
      return;
    }
    this.selectedId = "";
    this.expandedId = "";
    next();
    this.$nextTick(this.reload);
  },
  beforeDestroy() {
    if (this.shatterCleanups)
      this.shatterCleanups.forEach(cleanup => cleanup());
    clearTimeout(this.clickTimer);
    clearTimeout(this.noticeTimer);
    if (this.unregisterFlush) this.unregisterFlush();
    window.removeEventListener("tasks:changed", this.reload);
    window.removeEventListener("paste", this.onPaste);
    window.removeEventListener("resize", this.resizeEditor);
  },
  directives: {
    focus: {
      inserted(el) {
        el.focus();
        el.style.height = `${el.scrollHeight}px`;
      }
    }
  }
};
</script>
<style lang="scss" scoped>
.root {
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  padding: 0 15px 28px;
}
.item {
  display: block;
  min-height: 28px;
}
.item-main {
  display: flex;
  align-items: center;
  min-height: 28px;
}
.item.selected > .item-main {
  background: rgba(255, 255, 255, 0.07);
  border-radius: 3px;
}
.todo-checkbox {
  flex: 0 0 auto;
  align-self: flex-start;
  width: 15px;
  height: 15px;
  margin: 6px 8px 0 0;
  cursor: pointer;
}
.item-main p {
  flex: 1;
  min-width: 0;
  line-height: 28px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  cursor: pointer;
  user-select: none;
}
.concealed {
  letter-spacing: 2px;
  opacity: 0.7;
}
.visibility-toggle {
  flex: 0 0 auto;
  padding: 0 3px;
  cursor: pointer;
}
.pin-toggle {
  flex: 0 0 auto;
  width: 23px;
  height: 23px;
  margin: 0 1px;
  padding: 3px;
  border: 0;
  background: transparent;
  color: inherit;
  opacity: 0;
}
.pin-toggle svg {
  width: 17px;
  height: 17px;
}
.item:hover .pin-toggle,
.pin-toggle:focus-visible {
  opacity: 0.8;
}
.pin-toggle.pinned {
  opacity: 1;
  color: #e6c77d;
}
.pin-toggle.pinned svg {
  fill: rgba(230, 199, 125, 0.2);
}
.screenshot-paste {
  flex: 0 0 auto;
  width: 23px;
  height: 23px;
  margin: 0 1px;
  padding: 3px;
  border: 0;
  background: transparent;
  color: inherit;
  opacity: 0;
  cursor: pointer;
  transition: opacity 0.12s ease;
}
.item:hover .screenshot-paste,
.screenshot-paste:focus {
  opacity: 0.82;
}
.screenshot-paste:disabled {
  cursor: wait;
  opacity: 0.35;
}
.screenshot-paste svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.edit {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  min-height: 28px;
}
.edit textarea {
  flex: 1;
  min-width: 0;
  outline: none;
  border: none;
  background: transparent;
  font-size: 16px;
  font-family: inherit;
  color: inherit;
  line-height: 28px;
  padding: 0;
  resize: none;
  overflow: hidden;
  min-height: 28px;
  overflow-wrap: anywhere;
}
.edit i {
  padding: 0 4px;
  cursor: pointer;
}
.editor-hint {
  margin: 2px 0 6px 23px;
  font-size: 11px;
  line-height: 18px;
  color: #aab6ae;
  user-select: none;
}
.ghost {
  opacity: 0.5;
}
.empty {
  opacity: 0.6;
  font-size: 13px;
  padding-top: 10px;
}
.error {
  color: #ffcfb8;
  font-size: 12px;
  white-space: normal;
}
.notice {
  margin: 0 0 3px;
  color: #d9f3e5;
  font-size: 12px;
  white-space: normal;
}
button {
  background: #333;
  border: 1px solid #888;
  border-radius: 3px;
  padding: 2px 4px;
  cursor: pointer;
}
</style>
