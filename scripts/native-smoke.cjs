// Runs against the production Electron bundle in an isolated userData directory.
// DOM/IPC and native window APIs are real; file pickers are supplied test paths.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { app, dialog } = require("electron");
app.disableHardwareAcceleration();
const directory = path.resolve(process.argv[2]);
const phase = process.argv[3];
const reportFile = path.join(directory, "native-results.jsonl");
const record = (name, detail) =>
  fs.appendFileSync(reportFile, JSON.stringify({ phase, name, detail }) + "\n");
process.env.YANQIAN_TEST = "1";
process.env.YANQIAN_DATA_DIR = directory;
app.setAppPath(path.resolve("dist_electron/bundled"));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 2000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started >= timeout)
      throw Error(`Timed out waiting for ${label}`);
    await pause(25);
  }
}
let running = false;
app.on("browser-window-created", (event, win) => {
  win.webContents.on("render-process-gone", (event, details) =>
    record("renderer-gone", details)
  );
  win.webContents.on("did-finish-load", async () => {
    if (running) return;
    running = true;
    const evaluate = (fn, ...args) =>
      win.webContents.executeJavaScript(
        "(" + fn.toString() + ")(..." + JSON.stringify(args) + ")"
      );
    const request = (action, payload) =>
      evaluate(
        (action, payload) =>
          require("electron").ipcRenderer.sendSync("tasks:request", {
            action,
            payload
          }),
        action,
        payload
      );
    const snapshot = async () => {
      const result = await request("snapshot");
      assert(result.ok, result.error);
      return result.value;
    };
    const command = async (action, payload) => {
      const result = await request("command", { action, payload });
      assert(result.ok, result.error);
      return result.value;
    };
    const route = async href => {
      await evaluate(
        href => document.querySelector('a[href="' + href + '"]').click(),
        href
      );
      await pause(100);
    };
    const click = async selector => {
      await evaluate(selector => {
        const node = document.querySelector(selector);
        if (!node) throw Error("Missing " + selector);
        node.click();
      }, selector);
      await pause(75);
    };
    const complete = async () => {
      await evaluate(() => {
        const checkbox = document.querySelector(
          '.list .item input[type="checkbox"]'
        );
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await pause(75);
    };
    const action = async (name, payload) => {
      const result = await evaluate(
        (action, payload) =>
          require("electron").ipcRenderer.invoke("app:action", {
            action,
            payload
          }),
        name,
        payload
      );
      assert(result.ok, result.error);
      return result.value;
    };
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate(() => !!document.querySelector(".root"))) break;
        await pause(50);
      }
      if (phase === "verify") {
        const persisted = await snapshot();
        assert.equal(persisted.todoList.length, 1);
        assert.equal(persisted.doneList.length, 1);
        assert.equal(persisted.trashList.length, 0);
        await route("#/done");
        assert(
          (await evaluate(() => document.body.innerText)).includes(
            persisted.doneList[0].content
          )
        );
        assert.deepStrictEqual(win.getBounds(), {
          x: 120,
          y: 120,
          width: 400,
          height: 360
        });
        assert(fs.readdirSync(path.join(directory, "backups")).length > 0);
        record("restart-persistence-and-bounds", "passed");
      } else {
        for (const text of ["中文输入离开保存", "排序后完成测试"]) {
          await click(".root");
          await evaluate(text => {
            const input = document.querySelector(
              'input[aria-label="编辑事项"]'
            );
            input.value = text;
            input.dispatchEvent(new Event("input", { bubbles: true }));
          }, text);
          await route("#/settings");
          await route("#/");
        }
        let state = await snapshot();
        assert.equal(state.todoList.length, 2);
        const privateContent = state.todoList[0].content;
        await click(".visibility-toggle");
        state = await snapshot();
        assert.equal(state.todoList[0].hidden, true);
        assert(!(await evaluate(() => document.body.innerText)).includes(privateContent));
        await click(".visibility-toggle");
        assert.equal((await snapshot()).todoList[0].hidden, false);
        await click(".global-visibility");
        state = await snapshot();
        assert(state.todoList.every(item => item.hidden));
        await click(".global-visibility");
        state = await snapshot();
        assert(state.todoList.every(item => !item.hidden));
        record("native-input-navigation-save-and-visibility", "passed");
        const order = state.todoList.map(item => item.id).reverse();
        await command("reorder", { ids: order });
        await route("#/settings");
        await route("#/");
        state = await snapshot();
        assert.deepStrictEqual(
          state.todoList.map(item => item.id),
          order
        );
        await complete();
        state = await snapshot();
        assert.equal(state.doneList.length, 1);
        await route("#/done");
        const visible = await evaluate(() => {
          const item = document.querySelector(".item p");
          const r = item.getBoundingClientRect();
          return {
            text: item.textContent,
            top: r.top,
            bottom: r.bottom,
            height: innerHeight
          };
        });
        assert(visible.text.includes(state.doneList[0].content));
        assert(visible.top >= 0 && visible.bottom <= visible.height);
        await click('button[title="恢复为待办"]');
        assert.equal((await snapshot()).todoList.length, 2);
        await route("#/");
        await complete();
        await command("undoComplete");
        assert.equal((await snapshot()).todoList.length, 2);
        await complete();
        await route("#/done");
        await click('button[title="移到回收站"]');
        assert.equal((await snapshot()).trashList.length, 1);
        await route("#/settings");
        await click(".trash button");
        assert.equal((await snapshot()).doneList.length, 1);
        record("native-complete-visible-restore-undo-trash", "passed");
        const json = path.join(directory, "export.json");
        const xlsx = path.join(directory, "export.xlsx");
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: json
        });
        await action("export");
        const exported = JSON.parse(fs.readFileSync(json, "utf8"));
        assert.equal(exported.doneList.length, 1);
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: xlsx
        });
        await action("excel");
        const ExcelJS = require("exceljs");
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(xlsx);
        assert.equal(workbook.getWorksheet("todo list").rowCount, 2);
        assert.equal(workbook.getWorksheet("done list").rowCount, 2);
        await command("add", { content: "must be replaced by import" });
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [json]
        });
        dialog.showMessageBox = async () => ({ response: 1 });
        await action("import");
        assert.equal((await snapshot()).todoList.length, 1);
        dialog.showSaveDialog = async () => ({ canceled: true });
        assert.equal((await action("export")).canceled, true);
        record(
          "native-json-roundtrip-excel-and-cancel",
          "passed (file pickers use fixture paths)"
        );
        win.setBounds({ x: 120, y: 120, width: 400, height: 360 });
        await pause(200);
        await evaluate(() =>
          require("electron").ipcRenderer.invoke("hideWindow")
        );
        await pause(100);
        assert(!win.isVisible());
        app.emit("second-instance");
        await pause(100);
        assert(win.isVisible());
        assert(win.isEnabled());
        win.minimize();
        await waitFor(() => win.isMinimized(), "window to minimize");
        app.emit("second-instance");
        await waitFor(() => !win.isMinimized(), "window to restore");
        record(
          "native-hide-minimize-recovery",
          "passed (second-instance event dispatched in process)"
        );
      }
      record("phase-pass", phase);
      app.quit();
    } catch (error) {
      record("FAIL", error.stack);
      app.exit(1);
    }
  });
});
process.on("uncaughtException", error => {
  record("FAIL", error.stack);
  app.exit(1);
});
require(path.resolve("dist_electron/bundled/background.js"));
