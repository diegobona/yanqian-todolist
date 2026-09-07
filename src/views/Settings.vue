<template>
  <div class="settings">
    <h2>设置</h2>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="message" class="message" role="status">{{ message }}</p>
    <h3>数据</h3>
    <p class="hint">事项自动保存在这台电脑上。</p>
    <div class="actions">
      <button :disabled="busy" @click="run('export')">导出数据</button>
      <button :disabled="busy" @click="run('import')">导入数据</button>
    </div>
    <p class="hint">换电脑或重装前，可以先导出一份数据。</p>
    <h3>回收站</h3>
    <p class="hint">删除的事项会一直保留，恢复后回到原列表。</p>
    <p v-if="!trash.length" class="hint">回收站为空</p>
    <div v-for="entry in trash" :key="entry.task.id" class="trash row">
      <span :title="entry.task.content"
        >{{ entry.task.content || "空白草稿"
        }}<small
          >{{ entry.list === "doneList" ? "已完成" : "待办" }} ·
          {{ entry.deleted_at }}</small
        ></span
      >
      <button :disabled="busy" @click="restore(entry.task.id)">恢复</button>
    </div>
  </div>
</template>
<script>
import taskClient from "@/utils/taskClient";
export default {
  name: "Settings",
  data() {
    return {
      error: "",
      message: "",
      trash: [],
      busy: false
    };
  },
  methods: {
    reload() {
      try {
        const state = taskClient.snapshot();
        this.trash = state.trashList;
      } catch (error) {
        this.error = error.message;
      }
    },

    async run(action, payload) {
      this.busy = true;
      this.error = "";
      this.message = "";
      try {
        const result = await taskClient.action(action, payload);
        if (!result || !result.canceled) this.message = result;
        this.reload();
      } catch (error) {
        this.error = error.message;
      } finally {
        this.busy = false;
      }
    },
    restore(id) {
      try {
        taskClient.command("restoreTrash", { id });
        this.error = "";
        this.message = "事项已恢复";
        this.reload();
        taskClient.changed();
      } catch (error) {
        this.error = error.message;
      }
    }
  },
  created() {
    this.reload();
  }
};
</script>
<style lang="scss" scoped>
.settings {
  padding: 0 15px 20px;
  font-size: 12px;
}
h2 {
  font-size: 16px;
  margin: 0 0 10px;
}
h3 {
  font-size: 14px;
  margin: 16px 0 6px;
}
.row {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 5px 0;
}
.row span {
  flex: 1;
  min-width: 0;
}
.row span {
  overflow-wrap: anywhere;
}
button {
  background: #333;
  border: 1px solid #888;
  border-radius: 3px;
  padding: 4px 6px;
  cursor: pointer;
  font-size: 12px;
  flex-shrink: 0;
}
button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.hint,
small {
  color: #bfc6cf;
  font-size: 11px;
  line-height: 1.5;
  margin: 5px 0;
}

small {
  display: block;
}
.error {
  color: #ffcfb8;
  overflow-wrap: anywhere;
}
.message {
  color: #aff5c4;
}
</style>
