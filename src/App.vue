<template>
  <div id="app" :class="{ unfocused: ignoreMouse }">
    <div class="mask"></div>
    <div class="drag-nav" aria-hidden="true"></div>
    <div class="nav">
      <div class="link">
        <router-link draggable="false" to="/">Todo</router-link> |
        <router-link draggable="false" to="/done">Done</router-link>
      </div>
      <div class="tools">
        <router-link to="/settings" class="settings-link" title="设置"
          >设置</router-link
        >
        <i
          class="iconfont icon-export"
          title="导出 Excel"
          @click="exportData"
        ></i>
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
          :class="['iconfont', ignoreMouse ? 'icon-lock' : 'icon-unlock']"
          title="切换鼠标穿透"
          @mouseenter="setIgnoreMouseEvents(false)"
          @mouseleave="setIgnoreMouseEvents(ignoreMouse)"
          @click="toggleIgnore"
        ></i>
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
    <div v-if="notice" class="notice" role="alert">
      {{ notice }}<button @click="notice = ''">关闭</button>
    </div>
    <div class="main scrollbar scrollbar-y"><router-view /></div>
  </div>
</template>
<script>
import { ipcRenderer } from "electron";
import taskClient from "@/utils/taskClient";
export default {
  data() {
    return {
      ignoreMouse: false,
      notice: "",
      hasTasks: false,
      allTasksHidden: false
    };
  },
  methods: {
    setIgnoreMouseEvents(ignore) {
      ipcRenderer.invoke("setIgnoreMouseEvents", ignore).catch(error => {
        this.notice = error.message;
      });
    },
    toggleIgnore() {
      if (!taskClient.flush()) return;
      this.ignoreMouse = !this.ignoreMouse;
      this.setIgnoreMouseEvents(this.ignoreMouse);
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
        const tasks = [...snapshot.todoList, ...snapshot.doneList];
        this.hasTasks = tasks.length > 0;
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
    this.onUnlocked = () => {
      this.ignoreMouse = false;
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
    ipcRenderer.on("window:unlocked", this.onUnlocked);
    ipcRenderer.on("window:settings", this.onSettings);
    ipcRenderer.on("app:notice", this.onNotice);
    ipcRenderer.on("window:flush-request", this.onFlush);
    window.addEventListener("tasks:changed", this.onTasksChanged);
    window.addEventListener("beforeunload", this.beforeUnload);
  },
  beforeDestroy() {
    ipcRenderer.removeListener("window:unlocked", this.onUnlocked);
    ipcRenderer.removeListener("window:settings", this.onSettings);
    ipcRenderer.removeListener("app:notice", this.onNotice);
    ipcRenderer.removeListener("window:flush-request", this.onFlush);
    window.removeEventListener("tasks:changed", this.onTasksChanged);
    window.removeEventListener("beforeunload", this.beforeUnload);
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
.mask {
  display: none;
  position: absolute;
  z-index: 999;
  width: 100%;
  height: 100%;
}
.drag-nav {
  -webkit-app-region: drag;
  height: 20px;
  flex-shrink: 0;
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
.link a.router-link-exact-active {
  font-size: 20px;
  color: white;
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
#app.unfocused {
  opacity: 0.8;
}
#app.unfocused .mask {
  display: block;
}
#app.unfocused .tools {
  z-index: 1000;
}
</style>
