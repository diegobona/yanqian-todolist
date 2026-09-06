/* global __static */
import { app, ipcMain, Tray, Menu, dialog, Notification } from "electron";
import DB from "./db";
import path from "path";
import pkg from "../../package.json";
import ExcelJS from "exceljs";
import { getNowDateTimeForFlieName } from "@/utils/common";
let tray;
const isTest = process.env.YANQIAN_TEST === "1";

export function initExtra({ getWindow, controller, requestFlush }) {
  const repository = DB.repository;
  const validSender = event =>
    getWindow() &&
    !getWindow().isDestroyed() &&
    event.sender === getWindow().webContents;
  ipcMain.on("tasks:request", (event, request) => {
    try {
      if (!validSender(event)) throw Error("无效窗口");
      let value;
      switch (request.action) {
        case "snapshot":
          value = repository.snapshot();
          break;
        case "metadata":
          value = {
            directory: repository.directory,
            backups: repository.listBackups(),
            recoveryNotice: repository.recoveryNotice || "",
            accelerator: controller.getAccelerator() || "",
            shortcutError: controller.shortcutError || ""
          };
          break;
        case "command": {
          const { action, payload } = request.payload;
          if (action === "settings") throw Error("请通过设置页面修改设置");
          value = repository.command(action, payload);
          break;
        }
        default:
          throw Error("不支持的请求");
      }
      event.returnValue = { ok: true, value };
    } catch (error) {
      event.returnValue = { ok: false, error: error.message };
    }
  });
  ipcMain.handle("app:action", async (event, request) => {
    try {
      if (!validSender(event)) throw Error("无效窗口");
      const parent = getWindow();
      let value;
      switch (request.action) {
        case "export": {
          const result = await dialog.showSaveDialog(parent, {
            title: "导出数据",
            defaultPath: path.join(
              app.getPath("documents"),
              `眼前数据-${getNowDateTimeForFlieName()}.json`
            ),
            filters: [{ name: "眼前数据", extensions: ["json"] }]
          });
          if (result.canceled) return { ok: true, value: { canceled: true } };
          if (!(await requestFlush()))
            throw Error("有内容尚未保存，导出已取消");
          repository.exportTo(result.filePath);
          value = "数据已导出";
          break;
        }
        case "import": {
          const selected = await dialog.showOpenDialog(parent, {
            title: "导入数据",
            properties: ["openFile"],
            filters: [{ name: "眼前数据", extensions: ["json"] }]
          });
          if (selected.canceled || !selected.filePaths.length)
            return { ok: true, value: { canceled: true } };
          const choice = await dialog.showMessageBox(parent, {
            type: "warning",
            title: "导入数据",
            message: "导入的数据会替换当前事项和回收站，是否继续？",
            detail: "导入前会自动保护当前数据。",
            buttons: ["取消", "导入"],
            defaultId: 0,
            cancelId: 0
          });
          if (choice.response !== 1)
            return { ok: true, value: { canceled: true } };
          if (!(await requestFlush()))
            throw Error("有内容尚未保存，导入已取消");
          repository.importFrom(selected.filePaths[0]);
          const result = controller.setAccelerator(
            repository.snapshot().settings.accelerator ||
              "CommandOrControl+Shift+Space"
          );
          controller.shortcutError = result.ok ? "" : result.error;
          value = result.ok
            ? "数据已导入"
            : "数据已导入；快捷键被占用，请在设置中重新选择";
          break;
        }
        case "excel":
          value = await exportExcel(parent);
          break;
        case "shortcut": {
          const result = controller.setAccelerator(request.payload.accelerator);
          if (!result.ok) throw Error(result.error);
          controller.shortcutError = "";
          value = "快捷键已保存";
          break;
        }
        default:
          throw Error("不支持的操作");
      }
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

export function createTray({ showWindow, hideWindow, showSettings, quit }) {
  tray = new Tray(
    path.join(
      __static,
      process.platform === "darwin" ? "tray-mac@2x.png" : "tray.png"
    )
  );
  const items = [
    { label: "显示眼前", click: showWindow },
    { label: "隐藏眼前", click: hideWindow },
    { label: "设置", click: showSettings },
    { type: "separator" },
    {
      label: "开机启动",
      type: "checkbox",
      checked: !isTest && app.getLoginItemSettings().openAtLogin,
      click(item) {
        if (isTest) return;
        const options = { openAtLogin: item.checked };
        if (!app.isPackaged)
          Object.assign(options, {
            path: process.execPath,
            args: [path.resolve(process.argv[1])]
          });
        app.setLoginItemSettings(options);
      }
    },
    {
      label: "关于",
      click: () =>
        dialog.showMessageBox({
          title: pkg.name,
          message: pkg.description,
          detail: `Version: ${pkg.version}\nAuthor: ${pkg.author}`
        })
    },
    { label: "退出", click: quit }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip("眼前 — 点击恢复窗口");
  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
  return tray;
}
export function createAppMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      process.platform === "darwin"
        ? [{ label: app.name, submenu: [{ role: "about" }, { role: "quit" }] }]
        : []
    )
  );
}
async function exportExcel(parent) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = pkg.name;
  const todo = workbook.addWorksheet("todo list");
  todo.addRow(["内容", "建立时间"]);
  const done = workbook.addWorksheet("done list");
  done.addRow(["内容", "建立时间", "完成时间"]);
  const result = await dialog.showSaveDialog(parent, {
    title: "数据导出",
    defaultPath: path.join(
      app.getPath("documents"),
      `${getNowDateTimeForFlieName()}.xlsx`
    ),
    filters: [{ name: "Excel", extensions: ["xlsx"] }]
  });
  if (result.canceled) return { canceled: true };
  const state = DB.repository.snapshot();
  state.todoList.forEach(item =>
    todo.addRow([item.content, item.todo_datetime])
  );
  state.doneList.forEach(item =>
    done.addRow([item.content, item.todo_datetime, item.done_datetime])
  );
  await workbook.xlsx.writeFile(result.filePath);
  return "Excel 已导出";
}
export function showNotification(options) {
  if (Notification.isSupported()) new Notification(options).show();
}
