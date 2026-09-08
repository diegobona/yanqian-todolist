/* global __static */
"use strict";
import {
  app,
  protocol,
  BrowserWindow,
  screen,
  ipcMain,
  globalShortcut,
  dialog,
  shell
} from "electron";
import { createProtocol } from "vue-cli-plugin-electron-builder/lib";
import { autoUpdater } from "electron-updater";
import fs from "fs";
import path from "path";
import DB from "@/utils/db";
import { restoreDataFile } from "@/services/taskRepository";
import { initExtra, createTray, createAppMenu } from "@/utils/backgroundExtra";
import {
  createWindowController,
  getSafeBounds
} from "@/services/windowController";
import pkg from "../package.json";
import { dockEdge, handleBounds, contains } from "@/services/edgeDock";
import { prepareDataLocation, readDataLocation } from "@/services/dataLocation";
const isDevelopment = process.env.NODE_ENV !== "production";
const isTest = process.env.YANQIAN_TEST === "1";
app.setName(pkg.productName);
if (isTest && process.env.YANQIAN_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.YANQIAN_DATA_DIR));
let win, controller, repository, boundsTimer, backupTimer;
let readyToQuit = false,
  quitting = false,
  pendingFlush = null,
  flushId = 0;
let boundsWarningShown = false;
let modalOpen = false;
let windowLocked = false;
ipcMain.on("window:modal", (event, open) => {
  if (win && !win.isDestroyed() && event.sender === win.webContents)
    modalOpen = open === true;
});
let dockTimer,
  expandedBounds = null,
  dockBusy = false,
  lastWindowMove = 0,
  outsideSince = 0;
function expandDock() {
  if (!expandedBounds || !win || win.isDestroyed()) return;
  const bounds = expandedBounds;
  expandedBounds = null;
  win.setMinimumSize(320, 290);
  win.setBounds(getSafeBounds(bounds, screen));
  send("window:docked", "");
  lastWindowMove = Date.now();
  outsideSince = 0;
}
function applyWindowLocked(locked = windowLocked) {
  windowLocked = locked === true;
  if (!win || win.isDestroyed()) return windowLocked;
  if (windowLocked) expandDock();
  win.setIgnoreMouseEvents(false);
  win.setAlwaysOnTop(windowLocked);
  win.setMovable(!windowLocked);
  win.setResizable(!windowLocked);
  send("window:locked", windowLocked);
  return windowLocked;
}
async function checkDock() {
  if (modalOpen || windowLocked) {
    outsideSince = 0;
    return;
  }
  if (
    !win ||
    win.isDestroyed() ||
    !win.isVisible() ||
    win.isMinimized() ||
    dockBusy ||
    quitting
  )
    return;
  const bounds = win.getBounds();
  const point = screen.getCursorScreenPoint();
  if (expandedBounds) {
    if (contains(bounds, point)) expandDock();
    return;
  }
  if (contains(bounds, point) || Date.now() - lastWindowMove < 120) {
    outsideSince = 0;
    return;
  }
  const dock = dockEdge(
    bounds,
    screen.getAllDisplays().map(display => display.workArea)
  );
  if (!dock) {
    outsideSince = 0;
    return;
  }
  if (!outsideSince) outsideSince = Date.now();
  if (Date.now() - outsideSince < 60) return;
  dockBusy = true;
  try {
    if (!(await requestFlush())) {
      outsideSince = Date.now();
      return;
    }
    if (
      !win ||
      win.isDestroyed() ||
      !win.isVisible() ||
      win.isMinimized() ||
      quitting ||
      modalOpen ||
      windowLocked ||
      contains(win.getBounds(), screen.getCursorScreenPoint()) ||
      Date.now() - lastWindowMove < 120
    )
      return;
    saveBounds();
    expandedBounds = { ...bounds };
    send("window:docked", dock.edge);
    win.setMinimumSize(1, 1);
    win.setBounds(handleBounds(bounds, dock));
  } finally {
    dockBusy = false;
  }
}
const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

if (!app.requestSingleInstanceLock()) app.quit();
else {
  let locationError;
  if (!isTest) {
    try {
      app.setPath(
        "userData",
        prepareDataLocation(
          app.getPath("appData"),
          path.join(app.getPath("appData"), "xhznl-todo-list")
        )
      );
    } catch (error) {
      locationError = error;
    }
  }
  app.on("second-instance", () => {
    if (controller) controller.recover();
  });
  protocol.registerSchemesAsPrivileged([
    { scheme: "app", privileges: { secure: true, standard: true } }
  ]);
  app
    .whenReady()
    .then(() => {
      if (locationError) throw locationError;
      return init();
    })
    .catch(error => {
      dialog.showErrorBox("眼前无法启动", error.message);
      app.exit(1);
    });
}
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function shortcutLabel(accelerator) {
  return accelerator
    .replace(
      "CommandOrControl",
      process.platform === "darwin" ? "Command" : "Ctrl"
    )
    .split("+")
    .join(" + ");
}
function saveBounds() {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  try {
    repository.atomicWrite(
      stateFile(),
      JSON.stringify(expandedBounds || win.getBounds())
    );
  } catch (error) {
    if (!boundsWarningShown) {
      boundsWarningShown = true;
      send("app:notice", `窗口位置未保存：${error.message}`);
    }
  }
}
function requestFlush() {
  if (!win || win.isDestroyed()) return Promise.resolve(true);
  if (pendingFlush) return pendingFlush.promise;
  const id = ++flushId;
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  const timer = setTimeout(() => {
    pendingFlush = null;
    resolve(false);
    if (controller) controller.recover();
    send("app:notice", "窗口未响应，已取消隐藏或退出；请先确认事项已保存。");
  }, 5000);
  pendingFlush = { id, resolve, timer, promise };
  send("window:flush-request", id);
  return promise;
}
ipcMain.on("window:flush-result", (event, result) => {
  if (
    !win ||
    event.sender !== win.webContents ||
    !pendingFlush ||
    result.id !== pendingFlush.id
  )
    return;
  const pending = pendingFlush;
  pendingFlush = null;
  clearTimeout(pending.timer);
  pending.resolve(result.ok === true);
});
async function quitSafely() {
  if (quitting || readyToQuit) return;
  quitting = true;
  if (!(await requestFlush())) {
    quitting = false;
    controller.recover();
    return;
  }
  saveBounds();
  try {
    repository.backup();
  } catch (error) {
    quitting = false;
    controller.recover();
    send(
      "app:notice",
      `退出前备份失败：${error.message}。事项仍保存在本机，请检查磁盘后重试。`
    );
    return;
  }
  readyToQuit = true;
  app.quit();
}
async function afterHide() {
  saveBounds();
  if (!(await requestFlush())) {
    controller.recover();
    return;
  }
  if (!repository.snapshot().settings.hideHintSeen) {
    const shortcut = controller.getAccelerator();
    const detail = `点击系统托盘里的眼前图标，或再次启动眼前，即可恢复窗口。${
      shortcut
        ? `\n快捷键：${shortcutLabel(shortcut)}`
        : "\n当前快捷键不可用，可通过系统托盘或再次启动眼前找回窗口。"
    }`;
    try {
      if (!isTest)
        await dialog.showMessageBox({
          type: "info",
          title: "眼前已隐藏",
          message: "可以随时找回窗口",
          detail,
          buttons: ["知道了"]
        });
      repository.command("settings", { hideHintSeen: true });
    } catch (error) {
      controller.recover();
      send("app:notice", error.message);
    }
  }
}

async function openRepository() {
  const defaultDirectory = app.getPath("userData");
  const directory = readDataLocation(
    path.join(
      defaultDirectory,
      isDevelopment ? "data-location-dev.json" : "data-location.json"
    ),
    defaultDirectory
  );
  for (;;) {
    try {
      return DB.initDB(directory);
    } catch (error) {
      if (isTest) throw error;
      const result = await dialog.showMessageBox({
        type: "error",
        title: "本地数据需要恢复",
        message: error.message,
        detail:
          "原文件会保留。可以选择完整 JSON 备份恢复，或打开数据目录检查备份与 safety 文件夹。",
        buttons: ["选择备份恢复", "打开数据目录", "退出"],
        defaultId: 0,
        cancelId: 2
      });
      if (result.response === 2) {
        readyToQuit = true;
        app.quit();
        return null;
      }
      if (result.response === 1) {
        await shell.openPath(directory);
        continue;
      }
      const selected = await dialog.showOpenDialog({
        title: "选择完整备份",
        properties: ["openFile"],
        filters: [{ name: "JSON 备份", extensions: ["json"] }]
      });
      if (selected.canceled || !selected.filePaths.length) continue;
      try {
        restoreDataFile({
          directory,
          filename: isDevelopment ? "data-dev.json" : "data.json",
          source: selected.filePaths[0]
        });
      } catch (restoreError) {
        await dialog.showMessageBox({
          type: "error",
          title: "恢复失败",
          message: restoreError.message,
          detail: "原文件未被替换，请检查备份和磁盘权限。"
        });
      }
    }
  }
}

async function init() {
  repository = await openRepository();
  if (!repository) return;
  windowLocked = repository.snapshot().settings.windowLocked;
  createAppMenu();
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch (error) {
    /* first launch */
  }
  const primary = screen.getPrimaryDisplay().workArea;
  const initial = getSafeBounds(
    {
      x: primary.x + primary.width - 350,
      y: primary.y + 30,
      width: 320,
      height: 290,
      ...saved
    },
    screen
  );
  win = new BrowserWindow({
    ...initial,
    minWidth: 320,
    minHeight: 290,
    frame: false,
    transparent: true,
    show: false,
    minimizable: true,
    maximizable: false,
    alwaysOnTop: windowLocked,
    movable: !windowLocked,
    resizable: !windowLocked,
    skipTaskbar: false,
    title: pkg.productName,
    icon: path.join(__static, "logo.ico"),
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  controller = createWindowController({
    getWindow: () => win,
    screen,
    globalShortcut,
    readSettings: () => repository.snapshot().settings,
    writeSettings: patch => repository.command("settings", patch),
    onShow: () => {
      expandDock();
      applyWindowLocked();
      saveBounds();
    },
    onHide: () => {
      afterHide().catch(error => send("app:notice", error.message));
    }
  });
  const shortcut = controller.registerAccelerator();
  controller.shortcutError = shortcut.ok ? "" : shortcut.error;
  initExtra({ getWindow: () => win, controller, requestFlush });
  createTray({
    showWindow: () => controller.recover(),
    hideWindow: () => controller.hide(),
    showSettings: () => {
      controller.recover();
      send("window:settings");
    },
    quit: quitSafely
  });
  ipcMain.handle("hideWindow", () => controller.hide());
  ipcMain.handle("minimizeWindow", event => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents)
      return false;
    saveBounds();
    win.minimize();
    return true;
  });
  ipcMain.handle("closeWindow", event => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents)
      return false;
    return quitSafely();
  });
  ipcMain.handle("setWindowLocked", (event, locked) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents)
      return false;
    if (typeof locked !== "boolean") throw Error("窗口锁定状态无效");
    repository.command("setWindowLocked", { locked });
    return applyWindowLocked(locked);
  });
  win.on("move", () => {
    lastWindowMove = Date.now();
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveBounds, 150);
  });
  win.on("resize", () => {
    lastWindowMove = Date.now();
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveBounds, 150);
  });
  win.on("close", event => {
    if (!readyToQuit) {
      event.preventDefault();
      quitSafely();
    }
  });
  win.on("closed", () => {
    win = null;
  });
  // Restore the persisted window behavior after Show Desktop or taskbar minimize.
  win.on("restore", () => {
    if (win && !win.isDestroyed()) {
      win.setEnabled(true);
      applyWindowLocked();
    }
  });
  win.webContents.on("render-process-gone", () => {
    modalOpen = false;
    controller.recover();
    dialog
      .showMessageBox({
        type: "error",
        title: "界面已停止响应",
        message: "事项保存在本机。是否重新加载界面？",
        buttons: ["重新加载", "稍后"],
        defaultId: 0
      })
      .then(result => {
        if (result.response === 0 && win && !win.isDestroyed()) win.reload();
      });
  });
  for (const name of ["display-removed", "display-metrics-changed"])
    screen.on(name, () => {
      if (win && !win.isDestroyed()) {
        expandDock();
        win.setBounds(getSafeBounds(win.getBounds(), screen));
        saveBounds();
      }
    });
  backupTimer = setInterval(() => {
    try {
      repository.pruneTrash();
      repository.backup();
    } catch (error) {
      send("app:notice", `自动备份失败：${error.message}`);
    }
  }, 5 * 60 * 1000);
  if (process.env.WEBPACK_DEV_SERVER_URL)
    await win.loadURL(process.env.WEBPACK_DEV_SERVER_URL);
  else {
    createProtocol("app");
    await win.loadURL("app://./index.html");
  }
  controller.recover();
  dockTimer = setInterval(() => {
    checkDock().catch(error => {
      expandDock();
      send("app:notice", error.message);
    });
  }, 30);
  if (repository.recoveryNotice) send("app:notice", repository.recoveryNotice);
  if (!shortcut.ok)
    send(
      "app:notice",
      "快捷键不可用，仍可通过任务栏、托盘或再次启动恢复窗口。"
    );
  if (!isDevelopment && !isTest && app.isPackaged)
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}
app.on("before-quit", event => {
  if (!readyToQuit && repository) {
    event.preventDefault();
    quitSafely();
  }
});
app.on("will-quit", () => {
  clearTimeout(boundsTimer);
  clearInterval(backupTimer);
  clearInterval(dockTimer);
  if (controller) controller.dispose();
});
app.on("activate", () => {
  if (controller) controller.recover();
});
app.on("window-all-closed", () => {
  if (readyToQuit) app.quit();
});
if (isDevelopment) {
  if (process.platform === "win32")
    process.on("message", data => {
      if (data === "graceful-exit") quitSafely();
    });
  else process.on("SIGTERM", quitSafely);
}
