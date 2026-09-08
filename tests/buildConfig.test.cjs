const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

test("Windows installer uses the yanqian-todo-list Setup version name", () => {
  const project = path.resolve(__dirname, "..");
  const config = require(path.join(project, "vue.config.js"));
  const pkg = require(path.join(project, "package.json"));
  const template = config.pluginOptions.electronBuilder.builderOptions.win.artifactName;
  assert.equal(template, "yanqian-todo-list Setup ${version}.${ext}");
  assert.equal(
    template.replace("${version}", pkg.version).replace("${ext}", "exe"),
    `yanqian-todo-list Setup ${pkg.version}.exe`
  );
});

test("product branding is consistent across installer, app and metadata", () => {
  const project = path.resolve(__dirname, "..");
  const config = require(path.join(project, "vue.config.js"));
  const pkg = require(path.join(project, "package.json"));
  const builder = config.pluginOptions.electronBuilder.builderOptions;
  const { getWindowsInstallationDirName } = require("app-builder-lib/out/targets/targetUtil");
  const index = require("node:fs").readFileSync(
    path.join(project, "public/index.html"),
    "utf8"
  );
  const background = require("node:fs").readFileSync(
    path.join(project, "src/background.js"),
    "utf8"
  );
  const extra = require("node:fs").readFileSync(
    path.join(project, "src/utils/backgroundExtra.js"),
    "utf8"
  );
  const license = require("node:fs")
    .readFileSync(path.join(project, "public/license_zh_CN.txt"), "utf8")
    .trim();

  assert.equal(pkg.name, "yanqian-todo-list");
  assert.equal(pkg.productName, "眼前");
  assert.equal(builder.appId, "com.yanqian.todo");
  assert.equal(builder.productName, "眼前");
  assert.equal(builder.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(
    getWindowsInstallationDirName(
      { productFilename: builder.productName, sanitizedName: pkg.name },
      true
    ),
    "yanqian-todo-list"
  );
  assert.equal(builder.nsis.shortcutName, "眼前");
  assert.equal(builder.nsis.installerIcon, "./public/logo.ico");
  assert.equal(builder.nsis.uninstallerIcon, "./public/logo.ico");
  assert.equal(builder.nsis.installerHeaderIcon, "./public/logo.ico");
  assert.match(index, /<html lang="zh-CN">/);
  assert.match(index, /<title>眼前<\/title>/);
  assert.ok(background.includes("app.setName(pkg.productName)"));
  assert.ok(background.includes("title: pkg.productName"));
  assert.ok(extra.includes("title: pkg.productName"));
  assert.equal(license, "愿你在意的人和事，始终在眼前。");
});

test("application icon files use the eye brand assets", () => {
  const fs = require("node:fs");
  const project = path.resolve(__dirname, "..");
  const vector = fs.readFileSync(path.join(project, "public/app-icon.svg"), "utf8");
  assert.match(vector, /#173d32/i);
  assert.match(vector, /#b9f3d3/i);
  const ico = fs.readFileSync(path.join(project, "public/logo.ico"));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.ok(ico.readUInt16LE(4) >= 6);
  const icns = fs.readFileSync(path.join(project, "public/logo.icns"));
  assert.equal(icns.subarray(0, 4).toString("ascii"), "icns");
});
