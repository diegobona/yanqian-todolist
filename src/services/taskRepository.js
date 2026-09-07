const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const clone = value => JSON.parse(JSON.stringify(value));
const uid = () => crypto.randomBytes(16).toString("hex");
const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;
const MAX_SCREENSHOTS_PER_TASK = 20;
const MAX_SCREENSHOT_PIXELS = 40 * 1000 * 1000;
const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
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
  const usedScreenshots = new Set();
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
    if (item.screenshots !== undefined && !Array.isArray(item.screenshots))
      throw Error("事项截图格式无效");
    item.screenshots = (item.screenshots || []).map(screenshot => {
      if (
        !screenshot ||
        typeof screenshot.id !== "string" ||
        !/^[a-f0-9]{32}$/.test(screenshot.id) ||
        usedScreenshots.has(screenshot.id) ||
        screenshot.fileName !== `${screenshot.id}.png` ||
        typeof screenshot.created_at !== "string" ||
        !Number.isSafeInteger(screenshot.width) ||
        !Number.isSafeInteger(screenshot.height) ||
        screenshot.width < 1 ||
        screenshot.height < 1 ||
        screenshot.width > 12000 ||
        screenshot.height > 12000 ||
        screenshot.width * screenshot.height > MAX_SCREENSHOT_PIXELS ||
        !Number.isSafeInteger(screenshot.size) ||
        screenshot.size < 1 ||
        screenshot.size > MAX_SCREENSHOT_BYTES
      )
        throw Error("事项截图格式无效");
      usedScreenshots.add(screenshot.id);
      return screenshot;
    });
    if (item.screenshots.length > MAX_SCREENSHOTS_PER_TASK)
      throw Error(`每个事项最多添加 ${MAX_SCREENSHOTS_PER_TASK} 张截图`);
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
    this.attachmentDir = path.join(directory, "attachments");
    this.lastBackup = 0;
    this.fs.mkdirSync(directory, { recursive: true });
    this.fs.mkdirSync(this.backupDir, { recursive: true });
    this.fs.mkdirSync(this.safetyDir, { recursive: true });
    this.fs.mkdirSync(this.attachmentDir, { recursive: true });
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
  task(list, taskId, state = this.state) {
    if (!["todoList", "doneList"].includes(list)) throw Error("列表无效");
    const item = state[list].find(task => task.id === taskId);
    if (!item) throw Error("事项已变化，请刷新后重试");
    return item;
  }
  addScreenshot({ list, taskId, png }) {
    const item = this.task(list, taskId);
    if (item.hidden) throw Error("隐藏事项不能添加截图，请先显示此事项");
    if (item.screenshots.length >= MAX_SCREENSHOTS_PER_TASK)
      throw Error(`每个事项最多添加 ${MAX_SCREENSHOTS_PER_TASK} 张截图`);
    const bytes = Buffer.isBuffer(png) ? png : Buffer.from(png || []);
    const dimensions = inspectPng(bytes);
    const screenshotId = uid();
    const screenshot = {
      id: screenshotId,
      fileName: `${screenshotId}.png`,
      created_at: stamp(),
      width: dimensions.width,
      height: dimensions.height,
      size: bytes.length
    };
    const file = this.attachmentPath(screenshot.fileName);
    this.atomicWrite(file, bytes);
    try {
      const next = this.snapshot();
      this.task(list, taskId, next).screenshots.push(screenshot);
      next.revision += 1;
      return this.commit(next);
    } catch (error) {
      try {
        this.fs.unlinkSync(file);
      } catch (cleanupError) {
        /* a generated orphan is harmless and never referenced */
      }
      throw error;
    }
  }
  readScreenshot({ list, taskId, screenshotId }) {
    const item = this.task(list, taskId);
    if (item.hidden) throw Error("事项已隐藏");
    const screenshot = item.screenshots.find(
      entry => entry.id === screenshotId
    );
    if (!screenshot) throw Error("截图已变化，请刷新后重试");
    const bytes = this.fs.readFileSync(
      this.attachmentPath(screenshot.fileName)
    );
    const dimensions = inspectPng(bytes);
    if (
      bytes.length !== screenshot.size ||
      dimensions.width !== screenshot.width ||
      dimensions.height !== screenshot.height
    )
      throw Error("截图文件已损坏");
    return bytes;
  }
  removeScreenshot({ list, taskId, screenshotId }) {
    const item = this.task(list, taskId);
    if (item.hidden) throw Error("事项已隐藏");
    const index = item.screenshots.findIndex(
      entry => entry.id === screenshotId
    );
    if (index < 0) throw Error("截图已变化，请刷新后重试");
    const next = this.snapshot();
    this.task(list, taskId, next).screenshots.splice(index, 1);
    next.revision += 1;
    return this.commit(next, true);
  }
  attachmentPath(fileName) {
    if (!/^[a-f0-9]{32}\.png$/.test(fileName)) throw Error("截图文件名无效");
    return path.join(this.attachmentDir, fileName);
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
          hidden: false,
          screenshots: []
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
    const exported = this.snapshot();
    exported.attachmentData = {};
    for (const item of allTasks(exported)) {
      for (const screenshot of item.screenshots) {
        const bytes = this.fs.readFileSync(
          this.attachmentPath(screenshot.fileName)
        );
        const dimensions = inspectPng(bytes);
        if (
          bytes.length !== screenshot.size ||
          dimensions.width !== screenshot.width ||
          dimensions.height !== screenshot.height
        )
          throw Error("截图文件已损坏，导出已取消");
        exported.attachmentData[screenshot.id] = bytes.toString("base64");
      }
    }
    this.atomicWrite(file, JSON.stringify(exported, null, 2));
  }
  importFrom(file) {
    const size = this.fs.statSync(file).size;
    if (size > MAX_IMPORT_BYTES) throw Error("备份文件超过 200 MB，请检查文件");
    const prepared = prepareImport(
      JSON.parse(this.fs.readFileSync(file, "utf8")),
      this.attachmentDir,
      this.fs,
      true
    );
    const written = [];
    try {
      for (const attachment of prepared.attachments) {
        const target = this.attachmentPath(attachment.fileName);
        this.atomicWrite(target, attachment.bytes);
        written.push(target);
      }
      this.safetyCopy("before-import", JSON.stringify(this.state, null, 2));
      return this.commit(prepared.state, true);
    } catch (error) {
      for (const target of written) {
        try {
          this.fs.unlinkSync(target);
        } catch (cleanupError) {
          /* best effort for unreferenced staged files */
        }
      }
      throw error;
    }
  }
}
function allTasks(state) {
  return [
    ...state.todoList,
    ...state.doneList,
    ...(state.trashList || []).map(entry => entry.task)
  ];
}
function inspectPng(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (
    bytes.length < 45 ||
    bytes.length > MAX_SCREENSHOT_BYTES ||
    !bytes.slice(0, 8).equals(PNG_SIGNATURE)
  )
    throw Error("截图必须是有效的 PNG 图片，且不能超过 15 MB");
  let offset = 8;
  let width = 0;
  let height = 0;
  let hasImageData = false;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw Error("PNG 截图结构已损坏");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) throw Error("PNG 截图缺少尺寸信息");
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
    }
    if (type === "IDAT") hasImageData = true;
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.length)
        throw Error("PNG 截图结尾已损坏");
      ended = true;
      break;
    }
    offset = end;
  }
  if (
    !ended ||
    !hasImageData ||
    width < 1 ||
    height < 1 ||
    width > 12000 ||
    height > 12000 ||
    width * height > MAX_SCREENSHOT_PIXELS
  )
    throw Error("PNG 截图无效或尺寸过大");
  return { width, height };
}
function decodeBase64(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw Error("截图备份内容无效");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw Error("截图备份内容无效");
  return bytes;
}
function prepareImport(raw, attachmentDir, io, rewrite) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("备份格式无效");
  const stateRaw = clone(raw);
  const attachmentData = stateRaw.attachmentData;
  delete stateRaw.attachmentData;
  const state = normalize(stateRaw);
  const refs = allTasks(state).flatMap(item => item.screenshots);
  if (!refs.length) {
    if (
      attachmentData !== undefined &&
      (!attachmentData ||
        typeof attachmentData !== "object" ||
        Array.isArray(attachmentData) ||
        Object.keys(attachmentData).length)
    )
      throw Error("备份包含没有对应事项的截图");
    return { state, attachments: [] };
  }
  const payloadKeys =
    attachmentData &&
    typeof attachmentData === "object" &&
    !Array.isArray(attachmentData)
      ? Object.keys(attachmentData)
      : [];
  const refIds = new Set(refs.map(screenshot => screenshot.id));
  if (attachmentData !== undefined && !payloadKeys.length)
    throw Error("备份缺少事项所引用的截图");
  if (
    payloadKeys.length &&
    (payloadKeys.length !== refs.length ||
      payloadKeys.some(id => !refIds.has(id)))
  )
    throw Error("备份中的截图与事项不一致");
  const attachments = [];
  for (const item of allTasks(state)) {
    item.screenshots = item.screenshots.map(screenshot => {
      let bytes;
      if (payloadKeys.length)
        bytes = decodeBase64(attachmentData[screenshot.id]);
      else
        bytes = io.readFileSync(
          safeAttachmentPath(attachmentDir, screenshot.fileName)
        );
      const dimensions = inspectPng(bytes);
      if (
        bytes.length !== screenshot.size ||
        dimensions.width !== screenshot.width ||
        dimensions.height !== screenshot.height
      )
        throw Error("备份中的截图文件已损坏");
      if (!rewrite) return screenshot;
      const id = uid();
      const next = { ...screenshot, id, fileName: `${id}.png` };
      attachments.push({ fileName: next.fileName, bytes });
      return next;
    });
  }
  return { state: normalize(state), attachments };
}
function safeAttachmentPath(directory, fileName) {
  if (!/^[a-f0-9]{32}\.png$/.test(fileName)) throw Error("截图文件名无效");
  return path.join(directory, fileName);
}
function atomicWrite(io, file, text) {
  const temp = `${file}.${uid()}.tmp`;
  try {
    io.writeFileSync(
      temp,
      text,
      Buffer.isBuffer(text) ? { flag: "wx" } : { encoding: "utf8", flag: "wx" }
    );
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
  if (io.statSync(source).size > MAX_IMPORT_BYTES)
    throw Error("备份文件超过 200 MB");
  const attachmentDir = path.join(directory, "attachments");
  io.mkdirSync(attachmentDir, { recursive: true });
  const prepared = prepareImport(
    JSON.parse(io.readFileSync(source, "utf8")),
    attachmentDir,
    io,
    true
  );
  const target = path.join(directory, filename);
  const safety = path.join(directory, "safety");
  io.mkdirSync(safety, { recursive: true });
  const written = [];
  try {
    for (const attachment of prepared.attachments) {
      const file = safeAttachmentPath(attachmentDir, attachment.fileName);
      atomicWrite(io, file, attachment.bytes);
      written.push(file);
    }
    if (io.existsSync(target))
      atomicWrite(
        io,
        path.join(
          safety,
          filename + "-" + Date.now() + "-startup-restore-" + uid() + ".json"
        ),
        io.readFileSync(target, "utf8")
      );
    atomicWrite(io, target, JSON.stringify(prepared.state, null, 2));
  } catch (error) {
    for (const file of written) {
      try {
        io.unlinkSync(file);
      } catch (cleanupError) {
        /* best effort for unreferenced staged files */
      }
    }
    throw error;
  }
}

module.exports = { TaskRepository, normalize, restoreDataFile };
