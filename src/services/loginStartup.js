function createLoginStartup({ app, platform, testMode = false }) {
  const supported =
    app.isPackaged && !testMode && ["win32", "darwin"].includes(platform);
  function read() {
    if (!supported) return { supported: false, enabled: false };
    try {
      const state = app.getLoginItemSettings();
      return {
        supported: true,
        enabled:
          state.openAtLogin &&
          (platform !== "win32" || state.executableWillLaunchAtLogin)
      };
    } catch (error) {
      return {
        supported: true,
        enabled: false,
        error: "无法读取开机自启动状态：" + error.message
      };
    }
  }
  function set(enabled) {
    if (typeof enabled !== "boolean") throw Error("无效的开机自启动设置");
    if (!supported) throw Error("请在安装后的眼前中设置开机自启动");
    app.setLoginItemSettings({
      openAtLogin: enabled,
      ...(platform === "win32" ? { enabled } : {})
    });
    const state = read();
    if (state.error) throw Error(state.error);
    if (state.enabled !== enabled)
      throw Error("开机自启动设置未生效，请检查系统启动项设置后重试");
    return state;
  }
  return { read, set };
}
module.exports = { createLoginStartup };
