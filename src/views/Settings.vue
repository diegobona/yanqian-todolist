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
    <section class="settings-section" aria-label="外观">
      <div class="section-heading">
        <h3>界面透明度</h3>
        <strong class="transparency-value">{{ interfaceTransparency }}%</strong>
      </div>
      <input
        v-model.number="interfaceTransparency"
        class="transparency-slider"
        type="range"
        min="0"
        max="70"
        step="5"
        aria-label="界面透明度"
        @input="saveTransparency"
      />
      <div class="range-labels" aria-hidden="true">
        <span>不透明</span><span>更透明</span>
      </div>
    </section>
    <section class="settings-section" aria-label="本地数据">
      <h3>本地数据</h3>
      <p class="hint">事项自动保存在这台电脑上。</p>
      <div class="location">
        <div class="section-heading">
          <span class="location-label">保存位置</span
          ><button
            ref="changeDirectory"
            :disabled="busy"
            @click="run('changeDirectory')"
          >
            更改
          </button>
        </div>
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
        <div class="trash-tools">
          <span class="count">{{ trash.length }} 项</span>
          <button
            v-if="trash.length"
            class="danger-text"
            :disabled="busy"
            @click="askDelete(null, $event)"
          >
            清空回收站
          </button>
        </div>
      </div>
      <p class="hint">保留 <strong>30 天</strong>，到期自动清理</p>
      <p v-if="!trash.length" class="empty-trash">暂无删除的事项</p>
      <div class="trash-list">
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
          <button
            class="danger-text"
            :disabled="busy"
            @click="askDelete(entry, $event)"
          >
            彻底删除
          </button>
        </div>
      </div>
    </section>
    <div
      v-if="deletion"
      class="confirm-overlay"
      @click.self="closeDelete"
      @keydown.esc.stop.prevent="closeDelete"
      @keydown.tab.prevent="cycleConfirmFocus"
    >
      <div
        class="confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="trash-confirm-title"
        aria-describedby="trash-confirm-description"
      >
        <h3 id="trash-confirm-title">
          {{ deletion.all ? "清空回收站？" : "彻底删除这条事项？" }}
        </h3>
        <p v-if="!deletion.all" class="confirm-content">
          {{ deletion.content || "空白草稿" }}
        </p>
        <p id="trash-confirm-description">
          {{
            deletion.all
              ? `将删除回收站中的 ${deletion.ids.length} 项内容及其截图。`
              : "事项及其截图将被删除。"
          }}删除后无法从回收站恢复。
        </p>
        <div class="confirm-actions">
          <button ref="cancelDelete" @click="closeDelete">取消</button>
          <button ref="confirmDelete" class="danger" @click="confirmDelete">
            {{ deletion.all ? "确认清空" : "彻底删除" }}
          </button>
        </div>
      </div>
    </div>
    <div
      v-if="locationChange"
      class="confirm-overlay"
      @click.self="closeLocationChange"
      @keydown.esc.stop.prevent="closeLocationChange"
      @keydown.tab.prevent="cycleLocationFocus"
    >
      <div
        class="confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="location-confirm-title"
        aria-describedby="location-confirm-description"
      >
        <h3 id="location-confirm-title">此位置已有数据，是否替换？</h3>
        <p class="data-directory confirm-directory">
          {{ locationChange.directory }}
        </p>
        <p id="location-confirm-description">
          将用当前的事项和截图替换该位置的数据，原数据会自动保留一份副本。
        </p>
        <div class="confirm-actions">
          <button
            ref="cancelLocation"
            :disabled="busy"
            @click="closeLocationChange"
          >
            取消
          </button>
          <button
            ref="confirmLocation"
            :disabled="busy"
            @click="confirmLocationChange"
          >
            替换并迁移
          </button>
        </div>
      </div>
    </div>
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
      interfaceTransparency: 30,
      busy: false,
      deletion: null,
      deleteFocus: null,
      locationChange: null
    };
  },
  methods: {
    saveTransparency() {
      try {
        const state = taskClient.command("setInterfaceTransparency", {
          value: this.interfaceTransparency
        });
        this.interfaceTransparency = state.settings.interfaceTransparency;
        this.error = "";
        taskClient.changed();
      } catch (error) {
        this.error = error.message;
        this.reload();
      }
    },
    askDelete(entry, event) {
      this.deletion = entry
        ? { all: false, ids: [entry.task.id], content: entry.task.content }
        : { all: true, ids: this.trash.map(item => item.task.id) };
      this.deleteFocus = event.currentTarget;
      taskClient.setModal(true);
      this.$nextTick(() => this.$refs.cancelDelete.focus());
    },
    closeDelete() {
      this.deletion = null;
      taskClient.setModal(false);
      const target = this.deleteFocus;
      this.deleteFocus = null;
      this.$nextTick(() => {
        if (target && document.body.contains(target)) target.focus();
      });
    },
    cycleConfirmFocus() {
      const target =
        document.activeElement === this.$refs.cancelDelete
          ? this.$refs.confirmDelete
          : this.$refs.cancelDelete;
      if (target) target.focus();
    },
    closeLocationChange() {
      if (this.busy) return;
      taskClient.action("cancelDirectoryChange").catch(() => {});
      this.dismissLocationChange();
    },
    dismissLocationChange() {
      this.locationChange = null;
      taskClient.setModal(false);
      this.$nextTick(() => {
        if (this.$refs.changeDirectory) this.$refs.changeDirectory.focus();
      });
    },
    cycleLocationFocus() {
      const target =
        document.activeElement === this.$refs.cancelLocation
          ? this.$refs.confirmLocation
          : this.$refs.cancelLocation;
      if (target) target.focus();
    },
    async confirmLocationChange() {
      if (!this.locationChange || this.busy) return;
      this.busy = true;
      this.error = "";
      try {
        const result = await taskClient.action("replaceDirectory");
        this.dismissLocationChange();
        this.message = result;
        this.reload();
      } catch (error) {
        this.dismissLocationChange();
        this.error = error.message;
      } finally {
        this.busy = false;
      }
    },
    confirmDelete() {
      const deletion = this.deletion;
      if (!deletion) return;
      try {
        taskClient.command(
          deletion.all ? "clearTrash" : "deleteTrash",
          deletion.all ? { ids: deletion.ids } : { id: deletion.ids[0] }
        );
        this.closeDelete();
        this.error = "";
        this.message = deletion.all ? "回收站已清空" : "事项已彻底删除";
        this.reload();
        taskClient.changed();
      } catch (error) {
        this.closeDelete();
        this.error = error.message;
      }
    },
    reload() {
      try {
        const state = taskClient.snapshot();
        this.trash = state.trashList;
        this.interfaceTransparency = state.settings.interfaceTransparency;
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
        if (result && result.confirmation === "replaceData") {
          this.locationChange = { directory: result.directory };
          taskClient.setModal(true);
          this.$nextTick(() => this.$refs.cancelLocation.focus());
        } else if (!result || !result.canceled) this.message = result;
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
    this.refreshTimer = setInterval(() => {
      if (!this.deletion && !this.locationChange && !this.busy) this.reload();
    }, 60000);
  },
  beforeDestroy() {
    clearInterval(this.refreshTimer);
    if (this.locationChange)
      taskClient.action("cancelDirectoryChange").catch(() => {});
    if (this.deletion || this.locationChange) taskClient.setModal(false);
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
.trash-tools {
  display: flex;
  align-items: center;
  gap: 10px;
}
.transparency-value {
  color: #bad8c7;
  font-size: 12px;
}
.transparency-slider {
  width: 100%;
  margin: 12px 0 4px;
  accent-color: #bad8c7;
  cursor: pointer;
}
.range-labels {
  display: flex;
  justify-content: space-between;
  color: #85928a;
  font-size: 10px;
}
.trash-list {
  max-height: 280px;
  overflow-y: auto;
}
.danger-text {
  color: #e8aaa1;
}
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.48);
  -webkit-app-region: no-drag;
}
.confirm-card {
  width: 320px;
  max-width: 100%;
  padding: 22px;
  border-radius: 14px;
  background: #19231e;
  border: 1px solid #46534b;
  box-shadow: 0 16px 48px #0008;
}
.confirm-card h3 {
  font-size: 17px;
}
.confirm-card p {
  color: #b8c5bd;
  line-height: 1.7;
}
.confirm-content {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
}
.confirm-directory {
  padding: 9px 11px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.05);
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 22px;
}
.confirm-actions .danger {
  background: #a9433e;
  color: white;
  border-color: #c3665c;
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
