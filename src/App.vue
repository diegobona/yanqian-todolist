<template>
  <div
    id="app"
    :class="[{ locked: windowLocked, docked: !!dockEdge }, dockEdge]"
    :style="interfaceStyle"
  >
    <div
      v-if="dockEdge"
      class="dock-handle"
      title="移入展开眼前"
      aria-label="移入展开眼前"
    >
      <span></span>
    </div>
    <div class="drag-nav" aria-hidden="true"></div>
    <div class="nav">
      <div class="link tabs-navigation">
        <button
          v-show="tabsOverflowing"
          class="tab-scroll tab-scroll-left"
          type="button"
          title="向左滚动清单"
          aria-label="向左滚动清单"
          :disabled="!canScrollLeft"
          @click="scrollTabs(-1)"
        >
          ‹
        </button>
        <div ref="tabViewport" class="tab-strip" @scroll="updateTabOverflow">
          <draggable
            v-model="tabs"
            class="tab-list"
            :animation="150"
            :disabled="!!editingTabId"
            ghost-class="tab-dragging"
            @start="closeTabActions"
            @end="reorderTabs"
          >
            <span
              v-for="tab in tabs"
              :key="tab.id"
              :data-tab-id="tab.id"
              class="tab-shell"
              :class="{ active: activeTabId === tab.id }"
            >
              <input
                v-if="editingTabId === tab.id"
                ref="tabEditor"
                v-model="tabDraft"
                class="tab-editor"
                maxlength="30"
                aria-label="清单名称"
                @click.stop
                @keydown.enter="saveTabName"
                @keydown.esc="cancelTabName"
                @blur="saveTabName"
              />
              <router-link
                v-else
                draggable="false"
                :to="{ path: '/', query: { tab: tab.id } }"
                @dblclick.native.prevent="startTabName(tab)"
                >{{ tab.name }}</router-link
              >
              <button
                v-if="activeTabId === tab.id && editingTabId !== tab.id"
                class="tab-more"
                type="button"
                title="清单操作"
                aria-label="清单操作"
                @click.stop="tabMenuId = tabMenuId === tab.id ? '' : tab.id"
              >
                ···
              </button>
            </span>
          </draggable>
          <router-link draggable="false" class="done-tab" to="/done"
            >已完成</router-link
          >
          <button
            class="add-tab"
            type="button"
            title="新建清单"
            aria-label="新建清单"
            @click="addTab"
          >
            +
          </button>
        </div>
        <button
          v-show="tabsOverflowing"
          class="tab-scroll tab-scroll-right"
          type="button"
          title="向右滚动清单"
          aria-label="向右滚动清单"
          :disabled="!canScrollRight"
          @click="scrollTabs(1)"
        >
          ›
        </button>
      </div>
      <div class="tools">
        <i
          :class="[
            'iconfont',
            'global-visibility',
            allTasksHidden ? 'icon-browse' : 'icon-eye-close',
            { disabled: !hasTasks }
          ]"
          :title="allTasksHidden ? '显示所有事项' : '隐藏所有事项'"
          :aria-label="allTasksHidden ? '显示所有事项' : '隐藏所有事项'"
          @click="toggleAllTasksVisibility"
        ></i>
        <i
          :class="['iconfont', windowLocked ? 'icon-lock' : 'icon-unlock']"
          :title="windowLocked ? '解锁窗口' : '锁定窗口'"
          :aria-label="windowLocked ? '解锁窗口' : '锁定窗口'"
          @click="toggleWindowLock"
        ></i>
        <router-link
          to="/settings"
          class="settings-link"
          title="设置"
          aria-label="设置"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          >
            <path
              d="M9 3h6l.6 2.5 2 1.2L20 6l3 5-1.9 1.8v2.4L23 17l-3 5-2.4-.7-2 1.2L15 25H9l-.6-2.5-2-1.2L4 22l-3-5 1.9-1.8v-2.4L1 11l3-5 2.4.7 2-1.2L9 3Z"
              transform="translate(2 0) scale(.83)"
            />
            <circle cx="12" cy="12" r="3.2" />
          </svg>
        </router-link>
        <i
          class="iconfont icon-minus window-control"
          title="最小化"
          @click="minimizeWindow"
        ></i>
        <i
          class="iconfont icon-close window-control close"
          title="关闭"
          @click="closeWindow"
        ></i>
      </div>
    </div>
    <div v-if="activeMenuTab" class="tab-actions">
      <span>{{ activeMenuTab.name }}</span>
      <button @click="startTabName(activeMenuTab)">改名</button>
      <button @click="askDeleteTab(activeMenuTab, $event)">删除</button>
    </div>
    <div v-if="notice" class="notice" role="alert">
      {{ notice }}<button @click="notice = ''">关闭</button>
    </div>
    <div
      v-if="deleteTabPrompt"
      class="confirm-overlay"
      @click.self="closeDeleteTab"
      @keydown.esc.stop.prevent="closeDeleteTab"
      @keydown.tab.prevent="cycleDeleteTabFocus"
    >
      <div
        class="confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-tab-title"
        aria-describedby="delete-tab-description"
      >
        <h3 id="delete-tab-title">删除这个清单？</h3>
        <p class="confirm-name">“{{ deleteTabPrompt.name }}”</p>
        <p id="delete-tab-description">
          {{
            deleteTabPrompt.count
              ? `其中 ${deleteTabPrompt.count} 条待办会移到回收站，可以在设置中恢复。`
              : "此清单中没有待办事项。"
          }}
        </p>
        <div class="confirm-actions">
          <button
            ref="cancelDeleteTab"
            type="button"
            :disabled="deleteTabBusy"
            @click="closeDeleteTab"
          >
            取消
          </button>
          <button
            ref="confirmDeleteTab"
            class="danger"
            type="button"
            :disabled="deleteTabBusy"
            @click="confirmDeleteTab"
          >
            删除清单
          </button>
        </div>
      </div>
    </div>
    <div class="main scrollbar scrollbar-y"><router-view /></div>
  </div>
</template>
<script>
import { ipcRenderer } from "electron";
import draggable from "vuedraggable";
import taskClient from "@/utils/taskClient";
export default {
  components: { draggable },
  data() {
    return {
      windowLocked: false,
      dockEdge: "",
      notice: "",
      hasTasks: false,
      allTasksHidden: false,
      tabs: [],
      tabMenuId: "",
      editingTabId: "",
      tabDraft: "",
      deleteTabPrompt: null,
      deleteTabFocus: null,
      deleteTabBusy: false,
      tabsOverflowing: false,
      canScrollLeft: false,
      canScrollRight: false,
      interfaceTransparency: 30
    };
  },
  watch: {
    "$route.fullPath"() {
      this.closeTabActions();
      this.cancelTabName();
      this.$nextTick(() => {
        this.scrollActiveTabIntoView();
        this.updateTabOverflow();
      });
    }
  },
  computed: {
    interfaceStyle() {
      if (this.dockEdge) return { backgroundColor: "transparent" };
      const alpha = (100 - this.interfaceTransparency) / 100;
      return { backgroundColor: `rgba(0, 0, 0, ${alpha})` };
    },
    activeTabId() {
      if (this.$route.path !== "/") return "";
      const requested = this.$route.query.tab;
      return this.tabs.some(tab => tab.id === requested)
        ? requested
        : this.tabs[0]
        ? this.tabs[0].id
        : "";
    },
    activeMenuTab() {
      return this.tabs.find(tab => tab.id === this.tabMenuId) || null;
    }
  },
  methods: {
    reloadTabs(state) {
      const snapshot = state || taskClient.snapshot();
      this.tabs = snapshot.tabs;
      if (this.tabMenuId && !this.tabs.some(tab => tab.id === this.tabMenuId))
        this.tabMenuId = "";
      if (this.$route.path === "/") {
        const requested = this.$route.query.tab;
        if (!this.tabs.length) this.$router.replace("/done");
        else if (!this.tabs.some(tab => tab.id === requested))
          this.$router.replace({ path: "/", query: { tab: this.tabs[0].id } });
      }
      this.$nextTick(this.updateTabOverflow);
    },
    addTab() {
      if (!taskClient.flush()) return;
      try {
        const state = taskClient.command("addTab", { name: "新清单" });
        const tab = state.tabs[state.tabs.length - 1];
        this.reloadTabs(state);
        this.$router.push({ path: "/", query: { tab: tab.id } });
        this.$nextTick(() => this.startTabName(tab));
        taskClient.changed();
      } catch (error) {
        this.notice = error.message;
      }
    },
    startTabName(tab) {
      this.tabMenuId = "";
      this.editingTabId = tab.id;
      this.tabDraft = tab.name;
      this.$nextTick(() => {
        const editor = this.$refs.tabEditor;
        const input = Array.isArray(editor) ? editor[0] : editor;
        if (input) {
          input.focus();
          input.select();
        }
      });
    },
    saveTabName() {
      if (!this.editingTabId) return;
      try {
        const state = taskClient.command("renameTab", {
          id: this.editingTabId,
          name: this.tabDraft
        });
        this.editingTabId = "";
        this.reloadTabs(state);
        taskClient.changed();
      } catch (error) {
        this.notice = error.message;
      }
    },
    cancelTabName() {
      this.editingTabId = "";
      this.tabDraft = "";
    },
    closeTabActions() {
      this.tabMenuId = "";
    },
    reorderTabs() {
      if (!taskClient.flush()) {
        this.reloadTabs();
        return;
      }
      try {
        const state = taskClient.command("reorderTabs", {
          ids: this.tabs.map(tab => tab.id)
        });
        this.tabs = state.tabs;
        taskClient.changed();
      } catch (error) {
        this.notice = error.message;
        this.reloadTabs();
      }
      this.$nextTick(this.updateTabOverflow);
    },
    updateTabOverflow() {
      const viewport = this.$refs.tabViewport;
      if (!viewport) return;
      const remaining = viewport.scrollWidth - viewport.clientWidth;
      this.tabsOverflowing = remaining > 1;
      this.canScrollLeft = viewport.scrollLeft > 1;
      this.canScrollRight = viewport.scrollLeft < remaining - 1;
    },
    scrollTabs(direction) {
      const viewport = this.$refs.tabViewport;
      if (!viewport) return;
      viewport.scrollBy({
        left: direction * Math.max(120, viewport.clientWidth * 0.7),
        behavior: "smooth"
      });
      window.setTimeout(this.updateTabOverflow, 220);
    },
    scrollActiveTabIntoView() {
      const viewport = this.$refs.tabViewport;
      if (!viewport || !this.activeTabId) return;
      const tab = viewport.querySelector(`[data-tab-id="${this.activeTabId}"]`);
      if (tab) tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
    askDeleteTab(tab, event) {
      try {
        const state = taskClient.snapshot();
        const current = state.tabs.find(item => item.id === tab.id);
        if (!current) throw Error("清单不存在，已完成清单不可删除");
        this.deleteTabPrompt = {
          id: current.id,
          name: current.name,
          count: state.todoList.filter(item => item.tabId === current.id).length
        };
        this.deleteTabFocus = event && event.currentTarget;
        taskClient.setModal(true);
        this.$nextTick(() => {
          if (this.$refs.cancelDeleteTab) this.$refs.cancelDeleteTab.focus();
        });
      } catch (error) {
        this.notice = error.message;
      }
    },
    closeDeleteTab(restoreFocus = true) {
      if (this.deleteTabBusy) return;
      const target = this.deleteTabFocus;
      this.deleteTabPrompt = null;
      this.deleteTabFocus = null;
      taskClient.setModal(false);
      if (restoreFocus && target)
        this.$nextTick(() => {
          if (document.body.contains(target)) target.focus();
        });
    },
    cycleDeleteTabFocus() {
      if (this.deleteTabBusy) return;
      const target =
        document.activeElement === this.$refs.cancelDeleteTab
          ? this.$refs.confirmDeleteTab
          : this.$refs.cancelDeleteTab;
      if (target) target.focus();
    },
    async confirmDeleteTab() {
      const prompt = this.deleteTabPrompt;
      if (!prompt || this.deleteTabBusy) return;
      this.deleteTabBusy = true;
      try {
        const value = await taskClient.action("deleteTab", { id: prompt.id });
        this.deleteTabBusy = false;
        this.closeDeleteTab(false);
        this.tabMenuId = "";
        this.reloadTabs(value);
      } catch (error) {
        this.deleteTabBusy = false;
        this.closeDeleteTab(false);
        this.notice = error.message;
      }
    },
    toggleWindowLock() {
      if (!taskClient.flush()) return;
      ipcRenderer
        .invoke("setWindowLocked", !this.windowLocked)
        .then(locked => {
          this.windowLocked = locked;
        })
        .catch(error => {
          this.notice = error.message;
        });
    },
    async exportData() {
      try {
        const result = await taskClient.action("excel");
        if (!result.canceled) this.notice = result;
      } catch (error) {
        this.notice = error.message;
      }
    },
    reloadVisibility(state) {
      try {
        const snapshot = state || taskClient.snapshot();
        this.reloadTabs(snapshot);
        const tasks = [...snapshot.todoList, ...snapshot.doneList];
        this.hasTasks = tasks.length > 0;
        this.interfaceTransparency = snapshot.settings.interfaceTransparency;
        this.windowLocked = snapshot.settings.windowLocked;
        this.allTasksHidden =
          this.hasTasks && tasks.every(item => item.hidden === true);
      } catch (error) {
        this.notice = error.message;
      }
    },
    toggleAllTasksVisibility() {
      if (!this.hasTasks || !taskClient.flush()) return;
      try {
        const state = taskClient.command("setAllVisibility", {
          hidden: !this.allTasksHidden
        });
        this.reloadVisibility(state);
        taskClient.changed();
      } catch (error) {
        this.notice = error.message;
      }
    },
    minimizeWindow() {
      if (taskClient.flush())
        ipcRenderer.invoke("minimizeWindow").catch(error => {
          this.notice = error.message;
        });
    },
    closeWindow() {
      ipcRenderer.invoke("closeWindow").catch(error => {
        this.notice = error.message;
      });
    },
    beforeUnload(event) {
      if (!taskClient.flush()) {
        event.preventDefault();
        event.returnValue = false;
      }
    }
  },
  created() {
    this.onDocked = (event, edge) => {
      this.dockEdge = edge;
    };
    ipcRenderer.on("window:docked", this.onDocked);
    this.onWindowLocked = (event, locked) => {
      this.windowLocked = locked === true;
    };
    this.onNotice = (event, text) => {
      this.notice = text;
    };
    this.onSettings = () => {
      if (this.$route.path !== "/settings") this.$router.push("/settings");
    };
    this.onFlush = (event, id) => {
      const ok = taskClient.flush();
      ipcRenderer.send("window:flush-result", { id, ok });
    };
    this.onTasksChanged = () => this.reloadVisibility();
    this.reloadVisibility();
    ipcRenderer.on("window:locked", this.onWindowLocked);
    ipcRenderer.on("window:settings", this.onSettings);
    ipcRenderer.on("app:notice", this.onNotice);
    ipcRenderer.on("window:flush-request", this.onFlush);
    window.addEventListener("tasks:changed", this.onTasksChanged);
    window.addEventListener("beforeunload", this.beforeUnload);
  },
  mounted() {
    this.onResize = () => this.updateTabOverflow();
    window.addEventListener("resize", this.onResize);
    this.$nextTick(this.updateTabOverflow);
  },
  beforeDestroy() {
    ipcRenderer.removeListener("window:docked", this.onDocked);
    ipcRenderer.removeListener("window:locked", this.onWindowLocked);
    ipcRenderer.removeListener("window:settings", this.onSettings);
    ipcRenderer.removeListener("app:notice", this.onNotice);
    ipcRenderer.removeListener("window:flush-request", this.onFlush);
    window.removeEventListener("tasks:changed", this.onTasksChanged);
    window.removeEventListener("beforeunload", this.beforeUnload);
    window.removeEventListener("resize", this.onResize);
    if (this.deleteTabPrompt) taskClient.setModal(false);
  }
};
</script>
<style lang="scss" scoped>
#app {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 5px;
}
.drag-nav {
  -webkit-app-region: drag;
  height: 16px;
  flex-shrink: 0;
}
.locked .drag-nav {
  -webkit-app-region: no-drag;
}
.settings-link {
  display: inline-flex;
  align-items: center;
}
.settings-link svg {
  width: 18px;
  height: 18px;
}
.settings-link:hover {
  color: #bad8c7;
}
.nav {
  display: flex;
  justify-content: space-between;
  height: 28px;
  padding: 0 12px;
  user-select: none;
  flex-shrink: 0;
}
.link a {
  font-weight: bold;
  color: #ccc;
  text-decoration: none;
}
.tabs-navigation {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}
.tab-strip {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.tab-strip::-webkit-scrollbar {
  display: none;
}
.tab-list {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
}
.tab-shell {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  min-width: 0;
  margin-right: 6px;
  padding-right: 6px;
  border-right: 1px solid rgba(255, 255, 255, 0.5);
}
.tab-shell a,
.done-tab {
  max-width: 88px;
  padding: 2px 3px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.done-tab {
  flex: 0 0 auto;
  margin-right: 5px;
  padding-right: 8px;
  border-right: 1px solid rgba(255, 255, 255, 0.5);
}
.tab-shell.active a,
.done-tab.router-link-exact-active {
  font-size: 17px;
  color: white;
}
.tab-more,
.add-tab {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: #ddd;
  margin: 0;
  padding: 0 3px;
  cursor: pointer;
}
.tab-more {
  font-size: 12px;
}
.add-tab {
  font-size: 20px;
  line-height: 20px;
}
.tab-scroll {
  flex: 0 0 18px;
  width: 18px;
  height: 23px;
  margin: 0;
  padding: 0;
  border: 0;
  background: rgba(0, 0, 0, 0.55);
  color: white;
  font-size: 20px;
  line-height: 20px;
}
.tab-scroll:disabled {
  color: rgba(255, 255, 255, 0.3);
  cursor: default;
}
.tab-dragging {
  opacity: 0.35;
}
.tab-editor {
  width: 76px;
  border: 0;
  border-bottom: 1px solid white;
  outline: none;
  background: rgba(0, 0, 0, 0.4);
  color: white;
  font-size: 14px;
}
.tab-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 12px;
  background: rgba(0, 0, 0, 0.42);
  font-size: 11px;
  flex-shrink: 0;
}
.tab-actions span {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tools {
  display: flex;
  align-items: center;
}
.tools i {
  font-size: 18px;
  padding: 0 4px;
  cursor: pointer;
}
.tools .global-visibility.disabled {
  opacity: 0.35;
  cursor: default;
}
.tools .window-control {
  padding: 0 5px;
}
.tools .window-control.close:hover {
  color: #ff7676;
}
.settings-link {
  font-size: 12px;
  text-decoration: none;
  padding: 0 4px;
}
.main {
  flex: 1;
  min-height: 0;
  margin: 8px 0;
  overflow-y: auto;
}
.main:hover::-webkit-scrollbar-thumb {
  display: block;
}
.notice {
  padding: 4px 12px;
  font-size: 11px;
  flex-shrink: 0;
}
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.55);
  -webkit-app-region: no-drag;
}
.confirm-card {
  width: 280px;
  max-width: 100%;
  padding: 20px;
  border: 1px solid rgba(220, 235, 226, 0.16);
  border-radius: 12px;
  background: #202823;
  color: #e8eee9;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4);
}
.confirm-card h3 {
  margin: 0 0 8px;
  font-size: 16px;
}
.confirm-card p {
  margin: 0;
  color: #abb8af;
  font-size: 12px;
  line-height: 1.6;
}
.confirm-card .confirm-name {
  margin-bottom: 7px;
  color: #e8eee9;
  overflow-wrap: anywhere;
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.confirm-actions button {
  margin: 0;
  border: 1px solid #536158;
  border-radius: 6px;
  padding: 6px 12px;
  color: #e8eee9;
  background: transparent;
}
.confirm-actions .danger {
  background: #ad4c47;
  border-color: #ad4c47;
}
.confirm-actions button:focus-visible {
  outline: 2px solid #bad8c7;
  outline-offset: 2px;
}
.notice {
  background: #593824;
  max-height: 70px;
  overflow: auto;
}
button {
  background: #333;
  border: 1px solid #888;
  border-radius: 3px;
  padding: 2px 4px;
  cursor: pointer;
  font-size: 11px;
  margin-left: 6px;
}
#app.docked {
  background: transparent;
  overflow: hidden;
}
#app.docked > :not(.dock-handle) {
  display: none;
}
.dock-handle {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgba(25, 35, 32, 0.88);
  box-shadow: inset 0 0 0 1px rgba(220, 239, 228, 0.3);
}
.dock-handle span {
  width: 3px;
  height: 28px;
  border-radius: 3px;
  background: #bad8c7;
}
.top .dock-handle span,
.bottom .dock-handle span {
  width: 28px;
  height: 3px;
}
</style>
