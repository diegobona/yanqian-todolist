const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const directory = fs.mkdtempSync(path.join(process.cwd(), ".p0-native-auto-"));
const runtime = require("electron");
async function run(phase) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      runtime,
      [path.resolve("scripts/native-smoke.cjs"), directory, phase],
      { stdio: "inherit", windowsHide: true }
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("Native smoke timeout: " + phase));
    }, 60000);
    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", code => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(Error("Native smoke exited " + code));
    });
  });
}
(async () => {
  console.log("Isolated native test data: " + directory);
  await run("write");
  await run("verify");
  const log = fs.readFileSync(
    path.join(directory, "native-results.jsonl"),
    "utf8"
  );
  console.log(log);
  if (!log.includes("restart-persistence-and-bounds") || log.includes('"FAIL"'))
    throw Error("Native report incomplete");
  console.log(
    "NATIVE SMOKE PASSED. Win+D, physical multi-display and native file picker input remain manual checks."
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
