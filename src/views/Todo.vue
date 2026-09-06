<template>
  <div class="root" @click="add">
    <p v-if="error" class="error" role="alert" @click.stop>
      {{ error }} <button @click.stop="edited">重试保存</button>
    </p>
    <draggable
      class="list"
      v-model="todoList"
      :disabled="editId !== ''"
      :animation="200"
      ghost-class="ghost"
      @start="dragStarted"
      @end="sorted"
    >
      <div
        class="item"
        v-for="(todo, index) in todoList"
        :key="todo.id"
        @click.stop="queueEdit($event, todo.id)"
      >
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
        <p v-if="todo.id !== editId" :class="{ concealed: todo.hidden }">
          {{ index + 1 }}.{{
            todo.hidden ? "••••••" : todo.content || "空白草稿（点击继续编辑）"
          }}
        </p>
        <div class="edit" v-else>
          <input
            ref="editor"
            v-model="draft"
            v-focus
            @input="persistInput"
            @compositionend="persistInput"
            @click.stop
            @dblclick.stop
            @keydown.esc="cancel($event)"
            @keydown.enter="edited($event)"
            spellcheck="false"
            aria-label="编辑事项"
          />
          <i class="iconfont icon-select" title="保存" @click.stop="edited"></i>
          <i
            class="iconfont icon-close"
            title="移到回收站"
            @click.stop="clear(todo.id)"
          ></i>
        </div>
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
    </draggable>
    <p v-if="!todoList.length && !error" class="empty">
      点击空白处，记录一件事
    </p>
  </div>
</template>
<script>
import draggable from "vuedraggable";
import taskClient from "@/utils/taskClient";

export default {
  name: "Todo",
  components: { draggable },
  data() {
    return {
      todoList: [],
      editId: "",
      draft: "",
      original: null,
      drag: false,
      error: ""
    };
  },
  methods: {
    reload() {
      if (this.editId) return;
      try {
        this.todoList = taskClient.snapshot().todoList;
        this.error = "";
      } catch (error) {
        this.error = error.message;
      }
    },
    apply(action, payload) {
      try {
        const state = taskClient.command(action, payload);
        this.todoList = state.todoList;
        this.error = "";
        return state;
      } catch (error) {
        this.error = `未保存：${error.message}`;
        return null;
      }
    },
    add() {
      if (this.editId) {
        this.edited();
        return;
      }
      const state = this.apply("add", { content: "" });
      if (!state) return;
      const item = state.todoList[state.todoList.length - 1];
      this.editId = item.id;
      this.draft = "";
      this.original = null;
    },
    queueEdit(event, id) {
      clearTimeout(this.clickTimer);
      const item = this.todoList.find(todo => todo.id === id);
      if (!item || item.hidden || this.drag || (event && event.detail > 1))
        return;
      this.clickTimer = setTimeout(() => this.editing(id), 500);
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
      this.draft = item.content;
    },
    persistInput(event) {
      if (event && event.target) this.draft = event.target.value;
      if (!this.editId || !this.draft.trim()) return true;
      return !!this.apply("update", { id: this.editId, content: this.draft });
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
      this.editId = "";
      this.original = null;
      this.draft = "";
      taskClient.changed();
    },
    done(event, id) {
      clearTimeout(this.clickTimer);
      if (!this.edited()) return;
      if (!this.todoList.some(t => t.id === id)) return;
      if (this.apply("complete", { id })) taskClient.changed();
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
      )
        taskClient.changed();
    },
    sorted() {
      this.drag = false;
      if (!this.apply("reorder", { ids: this.todoList.map(t => t.id) })) {
        // Show the persisted order on failure; do not imply the sort was saved.
        try {
          this.todoList = taskClient.snapshot().todoList;
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
  },
  beforeRouteLeave(to, from, next) {
    next(this.edited() ? undefined : false);
  },
  beforeDestroy() {
    clearTimeout(this.clickTimer);
    if (this.unregisterFlush) this.unregisterFlush();
    window.removeEventListener("tasks:changed", this.reload);
  },
  directives: {
    focus: {
      inserted(el) {
        el.focus();
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
  display: flex;
  align-items: center;
  min-height: 28px;
}
.todo-checkbox {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
  margin: 0 8px 0 0;
  cursor: pointer;
}
.item p {
  flex: 1;
  min-width: 0;
  line-height: 28px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
.edit {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  min-height: 28px;
}
.edit input {
  flex: 1;
  min-width: 0;
  outline: none;
  border: none;
  background: transparent;
  font-size: 16px;
}
.edit i {
  padding: 0 4px;
  cursor: pointer;
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
button {
  background: #333;
  border: 1px solid #888;
  border-radius: 3px;
  padding: 2px 4px;
  cursor: pointer;
}
</style>
