import { ipcRenderer } from "electron";

const flushers = new Set();
function request(action, payload) {
  const result = ipcRenderer.sendSync("tasks:request", { action, payload });
  if (!result || !result.ok)
    throw Error((result && result.error) || "保存失败，请保留当前内容后重试");
  return result.value;
}
const taskClient = {
  snapshot: () => request("snapshot"),
  command: (action, payload) => request("command", { action, payload }),
  metadata: () => request("metadata"),
  registerFlush(fn) {
    flushers.add(fn);
    return () => flushers.delete(fn);
  },
  flush() {
    let ok = true;
    for (const fn of flushers) {
      if (fn() === false) ok = false;
    }
    return ok;
  },
  async action(action, payload) {
    if (!this.flush()) throw Error("有内容尚未保存，请先重试保存");
    const result = await ipcRenderer.invoke("app:action", { action, payload });
    if (!result || !result.ok)
      throw Error((result && result.error) || "操作失败");
    window.dispatchEvent(new Event("tasks:changed"));
    return result.value;
  },
  async attachment(action, payload) {
    const result = await ipcRenderer.invoke("app:action", { action, payload });
    if (!result || !result.ok)
      throw Error((result && result.error) || "截图操作失败");
    if (action !== "readScreenshot" && !result.value.canceled)
      window.dispatchEvent(new Event("tasks:changed"));
    return result.value;
  },
  changed() {
    window.dispatchEvent(new Event("tasks:changed"));
  }
};
export default taskClient;
