// electron-builder 22 sends UTF-8 NSIS source to stdin without an encoding marker.
// NSIS otherwise decodes Chinese project paths with the system ANSI code page.
// Keep this compatibility shim until the build toolchain is upgraded.
if (process.platform === "win32") {
  const { NsisTarget } = require("app-builder-lib/out/targets/nsis/NsisTarget");
  const execute = NsisTarget.prototype.executeMakensis;
  NsisTarget.prototype.executeMakensis = function(defines, commands, script) {
    return execute.call(
      this,
      defines,
      commands,
      script.startsWith("\uFEFF") ? script : "\uFEFF" + script
    );
  };
}
