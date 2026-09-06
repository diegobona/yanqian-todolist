const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const clone = value => JSON.parse(JSON.stringify(value));
const uid = () => crypto.randomBytes(16).toString("hex");
const pad = n => String(n).padStart(2, "0");
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function normalize(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("备份格式无效");
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1)
    throw Error("不支持此数据版本，请使用相应版本的软件");
  if (!Array.isArray(raw.todoList) || !Array.isArray(raw.doneList))
    throw Error("备份缺少待办或完成列表");
  if (raw.trashList !== undefined && !Array.isArray(raw.trashList))
    throw Error("回收站格式无效");
  if (
    raw.settings !== undefined &&
    (!raw.settings ||
      typeof raw.settings !== "object" ||
      Array.isArray(raw.settings))
  )
    throw Error("设置格式无效");
  const state = clone(raw);
  const used = new Set();
  const task = item => {
    if (
      item &&
      [
        "todo_date",
        "todo_datetime",
        "done_date",
        "done_datetime",
        "updated_at"
      ].some(key => item[key] !== undefined && typeof item[key] !== "string")
    )
      throw Error("事项日期格式无效");
    if (
      !item ||
      typeof item.content !== "string" ||
      item.content.length > 100000
    )
      throw Error("事项内容格式无效");
    if (item.hidden !== undefined && typeof item.hidden !== "boolean")
      throw Error("事项显示状态无效");
    item.hidden = item.hidden === true;
    if (typeof item.id !== "string" || !item.id || used.has(item.id))
      item.id = uid();
    used.add(item.id);
    return item;
  };
  state.todoList = state.todoList.map(task);
  state.doneList = state.doneList.map(item => {
    task(item);
    if (typeof item.done_date !== "string" || !item.done_date) {
      item.done_date =
        typeof item.done_datetime === "string"
          ? item.done_datetime.slice(0, 10)
          : item.todo_date || "日期未知";
    }
    return item;
  });
  state.trashList = (state.trashList || []).map(entry => {
    if (!entry || !["todoList", "doneList"].includes(entry.list))
      throw Error("回收站记录无效");
    if (!Number.isSafeInteger(entry.index) || entry.index < 0)
      throw Error("回收站位置无效");
    task(entry.task);
    return entry;
  });
  state.settings = state.settings || {};
  state.schemaVersion = 1;
  state.revision = Number.isSafeInteger(state.revision) ? state.revision : 0;
  state.lastCompletion = state.lastCompletion || null;
  if (
    state.lastCompletion &&
    (typeof state.lastCompletion.id !== "string" ||
      !Number.isSafeInteger(state.lastCompletion.index) ||
      state.lastCompletion.index < 0 ||
      !state.doneList.some(item => item.id === state.lastCompletion.id))
  )
    throw Error("撤销记录无效");
  return state;
}

class TaskRepository {
  constructor({ directory, filename = "data.json", fs: io = fs }) {
    this.fs = io;
    this.directory = directory;
    this.file = path.join(directory, filename);
    this.backupDir = path.join(
      directory,
      filename === "data-dev.json" ? "backups-dev" : "backups"
    );
    this.safetyDir = path.join(directory, "safety");
    this.lastBackup = 0;
    this.fs.mkdirSync(directory, { recursive: true });
    this.fs.mkdirSync(this.backupDir, { recursive: true });
    this.fs.mkdirSync(this.safetyDir, { recursive: true });
    if (!this.fs.existsSync(this.file)) {
      if (
        this.listBackups().length ||
        this.fs
          .readdirSync(this.safetyDir)
          .some(name => name.startsWith(filename + "-"))
      ) {
        this.recover(null);
        return;
      }
      this.state = normalize({ todoList: [], doneList: [], settings: {} });
      this.atomicWrite(this.file, JSON.stringify(this.state, null, 2));
      return;
    }
    const bytes = this.fs.readFileSync(this.file, "utf8");
    let raw;
    try {
      raw = JSON.parse(bytes);
    } catch (error) {
      this.recover(bytes);
      return;
    }
    // A newer format must not be rolled back automatically to an older backup.
    if (raw && raw.schemaVersion !== undefined && raw.schemaVersion !== 1)
      throw Error("数据来自其他版本，原文件已保留，请使用相应版本的软件");
    try {
      this.state = normalize(raw);
    } catch (error) {
      this.recover(bytes);
      return;
    }
    if (JSON.stringify(this.state) !== JSON.stringify(raw)) {
      this.safetyCopy("migration", bytes);
      this.atomicWrite(this.file, JSON.stringify(this.state, null, 2));
    }
  }
  atomicWrite(file, text) {
    return atomicWrite(this.fs, file, text);
  }
  safetyCopy(reason, bytes) {
    const file = path.join(
      this.safetyDir,
      `${path.basename(this.file)}-${Date.now()}-${reason}-${uid()}.json`
    );
    this.atomicWrite(file, bytes);
    return file;
  }
  recover(bytes) {
    const protectedFile =
      bytes === null ? this.safetyDir : this.safetyCopy("corrupt", bytes);
    for (const backup of this.listBackups()) {
      let state;
      try {
        state = normalize(
          JSON.parse(
            this.fs.readFileSync(path.join(this.backupDir, backup.name), "utf8")
          )
        );
      } catch (error) {
        continue;
      }
      // Once selected, never fall back to older data because a disk write failed.
      this.atomicWrite(this.file, JSON.stringify(state, null, 2));
      this.state = state;
      this.recoveryNotice =
        "数据文件缺失或损坏，已恢复备份 " +
        backup.name +
        "。原文件（如有）保留在 " +
        protectedFile +
        "，请核对最近的事项。";
      return;
    }
    throw Error(
      "无法读取数据，未覆盖原文件。安全副本目录：" +
        protectedFile +
        "。请从本地备份恢复。"
    );
  }
  snapshot() {
    return clone(this.state);
  }
  listBackups() {
    return this.fs
      .readdirSync(this.backupDir)
      .filter(name => /^backup-.*\.json$/.test(name))
      .map(name => ({
        name,
        modified: this.fs.statSync(path.join(this.backupDir, name)).mtimeMs
      }))
      .sort((a, b) => b.modified - a.modified || b.name.localeCompare(a.name));
  }
  backup() {
    const file = path.join(
      this.backupDir,
      `backup-${Date.now()}-${uid()}.json`
    );
    this.atomicWrite(file, JSON.stringify(this.state, null, 2));
    this.lastBackup = Date.now();
    // Pruning is best effort. A cleanup failure must not misreport a saved backup as lost.
    for (const old of this.listBackups().slice(10)) {
      try {
        this.fs.unlinkSync(path.join(this.backupDir, old.name));
      } catch (error) {
        /* kept */
      }
    }
    return path.basename(file);
  }
  commit(next, destructive = false) {
    if (destructive || Date.now() - this.lastBackup >= 5 * 60 * 1000)
      this.backup();
    this.atomicWrite(this.file, JSON.stringify(next, null, 2));
    this.state = next;
    return this.snapshot();
  }
  command(action, payload = {}) {
    const next = this.snapshot();
    const locate = (list, id) => {
      const index = next[list].findIndex(item => item.id === id);
      if (index < 0) throw Error("事项已变化，请刷新后重试");
      return index;
    };
    const content = value => {
      if (typeof value !== "string" || value.length > 100000)
        throw Error("事项内容无效或过长");
      return value;
    };
    let destructive = false;
    switch (action) {
      case "add": {
        const now = stamp();
        next.todoList.push({
          id: uid(),
          content: content(payload.content || ""),
          todo_date: now.slice(0, 10),
          todo_datetime: now,
          updated_at: now,
          hidden: false
        });
        break;
      }
      case "update": {
        const item = next.todoList[locate("todoList", payload.id)];
        item.content = content(payload.content);
        item.updated_at = stamp();
        break;
      }
      case "setVisibility": {
        if (!["todoList", "doneList"].includes(payload.list))
          throw Error("列表无效");
        if (typeof payload.hidden !== "boolean")
          throw Error("事项显示状态无效");
        next[payload.list][locate(payload.list, payload.id)].hidden =
          payload.hidden;
        break;
      }
      case "setAllVisibility": {
        if (typeof payload.hidden !== "boolean")
          throw Error("事项显示状态无效");
        for (const list of ["todoList", "doneList"])
          next[list].forEach(item => {
            item.hidden = payload.hidden;
          });
        break;
      }
      case "reorder": {
        const ids = payload.ids;
        if (
          !Array.isArray(ids) ||
          ids.length !== next.todoList.length ||
          new Set(ids).size !== ids.length ||
          ids.some(id => !next.todoList.some(t => t.id === id))
        )
          throw Error("排序已变化，请重试");
        const byId = new Map(next.todoList.map(item => [item.id, item]));
        next.todoList = ids.map(id => byId.get(id));
        break;
      }
      case "complete": {
        const index = locate("todoList", payload.id);
        if (!next.todoList[index].content.trim())
          throw Error("空白事项不能完成");
        const item = next.todoList.splice(index, 1)[0];
        const now = stamp();
        Object.assign(item, {
          done_date: now.slice(0, 10),
          done_datetime: now,
          updated_at: now
        });
        next.doneList.unshift(item);
        next.lastCompletion = { id: item.id, index };
        destructive = true;
        break;
      }
      case "restoreDone":
      case "undoComplete": {
        if (action === "undoComplete" && !next.lastCompletion)
          throw Error("没有可撤销的完成操作");
        const id =
          action === "undoComplete" ? next.lastCompletion.id : payload.id;
        const item = next.doneList.splice(locate("doneList", id), 1)[0];
        const index =
          next.lastCompletion && next.lastCompletion.id === id
            ? next.lastCompletion.index
            : next.todoList.length;
        delete item.done_date;
        delete item.done_datetime;
        item.updated_at = stamp();
        next.todoList.splice(
          Math.max(0, Math.min(index, next.todoList.length)),
          0,
          item
        );
        if (next.lastCompletion && next.lastCompletion.id === id)
          next.lastCompletion = null;
        destructive = true;
        break;
      }
      case "delete": {
        if (!["todoList", "doneList"].includes(payload.list))
          throw Error("列表无效");
        const index = locate(payload.list, payload.id);
        const item = next[payload.list].splice(index, 1)[0];
        next.trashList.unshift({
          task: item,
          list: payload.list,
          index,
          deleted_at: stamp()
        });
        if (next.lastCompletion && next.lastCompletion.id === item.id)
          next.lastCompletion = null;
        destructive = true;
        break;
      }
      case "discardDraft": {
        const index = locate("todoList", payload.id);
        if (next.todoList[index].content.trim())
          throw Error("非空事项不能作为草稿丢弃");
        next.todoList.splice(index, 1);
        break;
      }
      case "restoreTrash": {
        const index = next.trashList.findIndex(
          entry => entry.task.id === payload.id
        );
        if (index < 0) throw Error("回收站记录已变化");
        const entry = next.trashList.splice(index, 1)[0];
        next[entry.list].splice(
          Math.max(0, Math.min(entry.index, next[entry.list].length)),
          0,
          entry.task
        );
        destructive = true;
        break;
      }
      case "settings": {
        if (!payload || typeof payload !== "object" || Array.isArray(payload))
          throw Error("设置无效");
        next.settings = Object.assign({}, next.settings, payload);
        break;
      }
      default:
        throw Error("不支持的操作");
    }
    next.revision += 1;
    return this.commit(next, destructive);
  }
  exportTo(file) {
    if (
      path.resolve(file).toLowerCase() === path.resolve(this.file).toLowerCase()
    )
      throw Error("请另选备份文件，不能覆盖正在使用的数据文件");
    this.atomicWrite(file, JSON.stringify(this.state, null, 2));
  }
  importFrom(file) {
    const size = this.fs.statSync(file).size;
    if (size > 50 * 1024 * 1024) throw Error("备份文件超过 50 MB，请检查文件");
    const state = normalize(JSON.parse(this.fs.readFileSync(file, "utf8")));
    this.safetyCopy("before-import", JSON.stringify(this.state, null, 2));
    return this.commit(state, true);
  }
}
function atomicWrite(io, file, text) {
  const temp = `${file}.${uid()}.tmp`;
  try {
    io.writeFileSync(temp, text, { encoding: "utf8", flag: "wx" });
    const fd = io.openSync(temp, "r+");
    try {
      io.fsyncSync(fd);
    } finally {
      io.closeSync(fd);
    }
    io.renameSync(temp, file);
  } finally {
    if (io.existsSync(temp)) io.unlinkSync(temp);
  }
}

function restoreDataFile({
  directory,
  filename = "data.json",
  source,
  fs: io = fs
}) {
  if (io.statSync(source).size > 50 * 1024 * 1024)
    throw Error("备份文件超过 50 MB");
  const state = normalize(JSON.parse(io.readFileSync(source, "utf8")));
  const target = path.join(directory, filename);
  const safety = path.join(directory, "safety");
  io.mkdirSync(safety, { recursive: true });
  if (io.existsSync(target))
    atomicWrite(
      io,
      path.join(
        safety,
        filename + "-" + Date.now() + "-startup-restore-" + uid() + ".json"
      ),
      io.readFileSync(target, "utf8")
    );
  atomicWrite(io, target, JSON.stringify(state, null, 2));
}

module.exports = { TaskRepository, normalize, restoreDataFile };
