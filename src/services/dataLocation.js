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
module.exports = { prepareDataLocation };
