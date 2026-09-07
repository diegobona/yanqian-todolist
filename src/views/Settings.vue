<template>
  <div class="settings">
    <header class="settings-header">
      <h2>设置</h2>
      <div class="product-identity">
        <span class="product-name">眼前</span>
        <span class="product-version">v{{ version }}</span>
      </div>
    </header>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="message" class="message" role="status">{{ message }}</p>
    <section class="settings-section" aria-label="本地数据">
      <h3>本地数据</h3>
      <p class="hint">事项自动保存在这台电脑上。</p>
      <div class="location">
        <span class="location-label">保存位置</span>
        <p class="data-directory">{{ directory }}</p>
      </div>
      <div class="actions">
        <button :disabled="busy" @click="run('export')">导出数据</button>
        <button :disabled="busy" @click="run('import')">导入数据</button>
      </div>
      <p class="hint">换电脑或重装前，可以先导出一份数据。</p>
    </section>
    <section class="settings-section" aria-label="回收站">
      <div class="section-heading">
        <h3>回收站</h3>
        <span class="count">{{ trash.length }} 项</span>
      </div>
      <p class="hint">已删除事项可恢复到原清单。</p>
      <p v-if="!trash.length" class="empty-trash">暂无删除的事项</p>
      <div v-for="entry in trash" :key="entry.task.id" class="trash row">
        <span :title="entry.task.content"
          ><span class="trash-content">{{
            entry.task.content || "空白草稿"
          }}</span
          ><small
            >{{ entry.list === "doneList" ? "已完成" : entry.task.tabName }} ·
            {{ entry.deleted_at }}</small
          ></span
        >
        <button :disabled="busy" @click="restore(entry.task.id)">恢复</button>
      </div>
    </section>
  </div>
</template>
<script>
import taskClient from "@/utils/taskClient";
import pkg from "../../package.json";
export default {
  name: "Settings",
  data() {
    return {
      version: pkg.version,
      error: "",
      message: "",
      trash: [],
      directory: "",
      busy: false
    };
  },
  methods: {
    reload() {
      try {
        const state = taskClient.snapshot();
        this.trash = state.trashList;
        this.directory = taskClient.metadata().directory;
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
  padding: 8px 15px 20px;
  font-size: 12px;
  max-width: 640px;
  margin: 0 auto;
  color: #e4ebe7;
  font-family: "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
}
.settings-header,
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.settings-header {
  margin-bottom: 14px;
}
.product-identity {
  display: flex;
  align-items: baseline;
  gap: 7px;
}
.product-name {
  font-family: "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC",
    sans-serif;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1px;
  color: #d5e8dc;
}
.product-version {
  font-size: 11px;
  color: #9fa9a3;
}
.data-directory {
  overflow-wrap: anywhere;
  user-select: text;
  color: #dce7e0;
  line-height: 1.6;
  margin: 5px 0 0;
  font-size: 11px;
}
.settings-section {
  padding: 14px;
  margin-bottom: 12px;
  border: 1px solid rgba(210, 230, 219, 0.12);
  border-radius: 10px;
  background: rgba(17, 23, 20, 0.88);
}
.location {
  padding: 10px 12px;
  margin: 12px 0;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
}
.location-label,
.count {
  font-size: 10px;
  color: #a3afa8;
}
h2 {
  font-size: 18px;
  margin: 0;
}
h3 {
  font-size: 13px;
  margin: 0 0 5px;
}
.row {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 0;
  padding: 11px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.row > span {
  flex: 1;
  min-width: 0;
}
.row span {
  overflow-wrap: anywhere;
}
.trash-content {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.6;
}
.empty-trash {
  text-align: center;
  padding: 16px 0 8px;
  color: #94a198;
  font-size: 11px;
}
button {
  background: rgba(255, 255, 255, 0.06);
  color: #dce8e0;
  border: 1px solid rgba(213, 232, 220, 0.2);
  border-radius: 6px;
  padding: 6px 11px;
  cursor: pointer;
  font-size: 12px;
  flex-shrink: 0;
}
button:hover:not(:disabled) {
  background: rgba(186, 216, 199, 0.15);
  border-color: #80998a;
}
button:focus-visible {
  outline: 2px solid #bad8c7;
  outline-offset: 2px;
}
button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 9px;
}
.hint,
small {
  color: #a8b4ac;
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
