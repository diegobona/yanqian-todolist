const fs = require("fs");
const path = require("path");
const extra = require("fs-extra");
const DATA_DIRECTORY_NAME = "yanqian-todo-list";
const MANAGED_NAMES = [
  "data.json",
  "data-dev.json",
  "attachments",
  "backups",
  "backups-dev",
  "safety"
];

function prepareDataLocation(appData, legacyDirectory) {
  const target = path.join(appData, DATA_DIRECTORY_NAME);
  if (fs.existsSync(target)) return target;
  const staging = `${target}.migration-${process.pid}-${Date.now()}`;
  fs.mkdirSync(staging, { recursive: true });
  // Preserve both development and production data, without copying Electron caches.
  for (const name of [
    "data.json",
    "data-dev.json",
    "attachments",
    "backups",
    "backups-dev",
    "safety",
    "data-location.json",
    "data-location-dev.json",
    "window-state.json"
  ]) {
    const source = path.join(legacyDirectory, name);
    if (fs.existsSync(source))
      extra.copySync(source, path.join(staging, name), {
        errorOnExist: true,
        overwrite: false
      });
  }
  // Only switch after every copy succeeds. The original directory stays intact.
  fs.renameSync(staging, target);
  return target;
}

function resolveDataDirectory(selectedDirectory) {
  return path.resolve(selectedDirectory);
}

function sameDirectory(left, right) {
  if (fs.existsSync(left)) left = fs.realpathSync(left);
  if (fs.existsSync(right)) right = fs.realpathSync(right);
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function directoryHasFiles(directory, predicate = () => true) {
  return (
    fs.existsSync(directory) &&
    fs.statSync(directory).isDirectory() &&
    fs.readdirSync(directory).some(predicate)
  );
}

function inspectDataLocation(repository, selectedDirectory) {
  const directory = resolveDataDirectory(selectedDirectory);
  const source = path.resolve(repository.directory);
  const hasExistingData = MANAGED_NAMES.some(name => {
    const file = path.join(directory, name);
    if (!fs.existsSync(file)) return false;
    return !fs.statSync(file).isDirectory() || directoryHasFiles(file);
  });
  return {
    directory,
    current: sameDirectory(directory, source),
    hasExistingData,
    hasManagedContent: MANAGED_NAMES.some(name =>
      fs.existsSync(path.join(directory, name))
    )
  };
}

function pointRepositoryAt(repository, next) {
  repository.directory = next.directory;
  repository.file = next.file;
  repository.backupDir = next.backupDir;
  repository.safetyDir = next.safetyDir;
  repository.attachmentDir = next.attachmentDir;
  repository.lastBackup = next.lastBackup;
  repository.recoveryNotice = next.recoveryNotice;
  repository.state = next.snapshot();
}
function readDataLocation(configFile, fallback) {
  if (!fs.existsSync(configFile)) return fallback;
  const directory = JSON.parse(fs.readFileSync(configFile, "utf8")).directory;
  if (
    typeof directory !== "string" ||
    !path.isAbsolute(directory) ||
    !fs.existsSync(directory)
  )
    throw Error("自定义保存位置不可用，请检查磁盘是否已连接：" + directory);
  return directory;
}

// Validate the copied bytes before publishing a new location.
function verifyCopy(directory, repository) {
  const { TaskRepository } = require("./taskRepository");
  const next = new TaskRepository({
    directory,
    filename: path.basename(repository.file)
  });
  if (JSON.stringify(next.snapshot()) !== JSON.stringify(repository.snapshot()))
    throw Error("数据校验失败，已保留原保存位置");
  const state = next.snapshot();
  for (const tasks of [
    state.todoList,
    state.doneList,
    state.trashList.map(entry => entry.task)
  ]) {
    for (const task of tasks)
      for (const shot of task.screenshots || []) {
        const original = fs.readFileSync(
          path.join(repository.attachmentDir, shot.fileName)
        );
        const copied = fs.readFileSync(
          path.join(next.attachmentDir, shot.fileName)
        );
        if (!original.equals(copied))
          throw Error("截图校验失败，已保留原保存位置");
      }
  }
  return next;
}

function relocateData(
  repository,
  selectedDirectory,
  configFile,
  { replace = false } = {}
) {
  const inspected = inspectDataLocation(repository, selectedDirectory);
  const target = inspected.directory;
  const source = fs.realpathSync(repository.directory);
  if (inspected.current) return repository.directory;
  const resolvedTarget = fs.existsSync(target)
    ? fs.realpathSync(target)
    : target;
  // A parent directory is allowed, so old nested paths can be flattened.
  const relative = path.relative(source, resolvedTarget);
  if (
    relative &&
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  )
    throw Error("不能保存到当前数据文件夹内部，请选择它的上级或其他文件夹");
  // Never move an entry that contains the active repository (e.g. attachments).
  for (const name of MANAGED_NAMES) {
    const entry = path.join(resolvedTarget, name);
    const rel = path.relative(entry, source);
    if (
      !rel ||
      (rel !== ".." &&
        !rel.startsWith(".." + path.sep) &&
        !path.isAbsolute(rel))
    )
      throw Error("此位置与当前数据文件夹重叠，请选择其他文件夹");
  }
  if (inspected.hasExistingData && !replace)
    throw Error("此位置已有数据，请确认替换并迁移");
  repository.backup();
  fs.mkdirSync(target, { recursive: true });
  const transaction = fs.mkdtempSync(path.join(target, ".yanqian-transfer-"));
  const staging = path.join(transaction, "incoming");
  const previous = path.join(transaction, "previous");
  fs.mkdirSync(staging);
  fs.mkdirSync(previous);
  const saved = [],
    installed = [];
  try {
    for (const name of MANAGED_NAMES) {
      const file = path.join(source, name);
      if (fs.existsSync(file))
        extra.copySync(file, path.join(staging, name), { dereference: true });
    }
    verifyCopy(staging, repository);
    // Recheck immediately before moving target entries; no asynchronous gap follows.
    if (!replace && inspectDataLocation(repository, target).hasExistingData)
      throw Error("此位置已有数据，请确认替换并迁移");
    for (const name of MANAGED_NAMES) {
      const file = path.join(target, name);
      if (fs.existsSync(file)) {
        fs.renameSync(file, path.join(previous, name));
        saved.push(name);
      }
      if (fs.existsSync(path.join(staging, name))) {
        fs.renameSync(path.join(staging, name), file);
        installed.push(name);
      }
    }
    const next = verifyCopy(target, repository);
    repository.atomicWrite(configFile, JSON.stringify({ directory: target }));
    pointRepositoryAt(repository, next);
  } catch (error) {
    try {
      for (const name of installed.reverse())
        fs.renameSync(path.join(target, name), path.join(staging, name));
      for (const name of saved.reverse())
        fs.renameSync(path.join(previous, name), path.join(target, name));
    } catch (rollbackError) {
      throw Error(
        "迁移未完成，原保存位置仍在使用。目标旧数据已保留于：" + previous
      );
    }
    throw error;
  }
  // Remove only empty staging directories; retained old data is never deleted.
  try {
    fs.rmdirSync(staging);
    if (!saved.length) {
      fs.rmdirSync(previous);
      fs.rmdirSync(transaction);
    }
  } catch (error) {
    /* cleanup must not turn a successful migration into failure */
  }
  // Keep the transaction's previous directory as an independent safety copy.
  // It is never included in the rolling backup cleanup or a later replacement.
  return target;
}

module.exports = {
  prepareDataLocation,
  readDataLocation,
  inspectDataLocation,
  relocateData
};
