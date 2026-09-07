const fs = require("fs");
const path = require("path");
const extra = require("fs-extra");

function prepareDataLocation(appData, legacyDirectory) {
  const target = path.join(appData, "yanqian-todo-list");
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

function relocateData(repository, parentDirectory, configFile) {
  const target = path.resolve(parentDirectory, "yanqian-todo-list");
  const source = path.resolve(repository.directory);
  if (target.toLowerCase() === source.toLowerCase()) return source;
  const relative = path.relative(source, target);
  if (!relative.startsWith("..") && !path.isAbsolute(relative))
    throw Error("请选择当前数据文件夹以外的位置");
  if (fs.existsSync(target))
    throw Error(
      "目标位置已有 yanqian-todo-list 文件夹，请选择其他位置，避免覆盖数据"
    );
  repository.backup();
  const staging = `${target}.migration-${process.pid}-${Date.now()}`;
  fs.mkdirSync(staging, { recursive: true });
  for (const name of [
    "data.json",
    "data-dev.json",
    "attachments",
    "backups",
    "backups-dev",
    "safety"
  ]) {
    const file = path.join(source, name);
    if (fs.existsSync(file)) extra.copySync(file, path.join(staging, name));
  }
  const { TaskRepository } = require("./taskRepository");
  const filename = path.basename(repository.file);
  const verified = new TaskRepository({ directory: staging, filename });
  if (
    JSON.stringify(verified.snapshot()) !==
    JSON.stringify(repository.snapshot())
  )
    throw Error("数据校验失败，已保留原保存位置");
  fs.renameSync(staging, target);
  // Persist the pointer before switching the live repository; failed writes leave it unchanged.
  repository.atomicWrite(configFile, JSON.stringify({ directory: target }));
  repository.directory = target;
  for (const key of ["file", "backupDir", "safetyDir", "attachmentDir"])
    repository[key] = path.join(target, path.basename(repository[key]));
  return target;
}
module.exports = { prepareDataLocation, readDataLocation, relocateData };
