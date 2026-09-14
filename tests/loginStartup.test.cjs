const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoginStartup } = require('../src/services/loginStartup');

function fixture(options = {}) {
  let state = { openAtLogin: false, executableWillLaunchAtLogin: false };
  const writes = [];
  const app = {
    isPackaged: true,
    getLoginItemSettings: () => state,
    setLoginItemSettings(value) {
      writes.push(value);
      state = { openAtLogin: value.openAtLogin, executableWillLaunchAtLogin: value.enabled };
    }
  };
  const startup = createLoginStartup({ app, platform: 'win32', ...options });
  return { app, startup, writes, systemChange: value => { state = value; } };
}
test('startup reads Windows state and enables/disables the installed executable', () => {
  const { startup, writes, systemChange } = fixture();
  assert.equal(startup.read().enabled, false);
  assert.equal(startup.set(true).enabled, true);
  assert.deepEqual(writes[0], { openAtLogin: true, enabled: true });
  systemChange({ openAtLogin: true, executableWillLaunchAtLogin: false });
  assert.equal(startup.read().enabled, false, 'Task Manager can disable a registered entry');
  assert.equal(startup.set(true).enabled, true);
  assert.equal(startup.set(false).enabled, false);
  assert.deepEqual(writes.at(-1), { openAtLogin: false, enabled: false });
});
test('startup rejects invalid requests and reports failed OS writes', () => {
  const { startup, app, writes } = fixture();
  assert.throws(() => startup.set('true'), /无效/);
  assert.equal(writes.length, 0);
  app.setLoginItemSettings = () => {};
  assert.throws(() => startup.set(true), /未生效/);
  assert.equal(startup.read().enabled, false);
  app.getLoginItemSettings = () => { throw Error('denied'); };
  assert.match(startup.read().error, /读取/);
});
test('development, test runs and unsupported platforms never register startup', () => {
  for (const options of [{ testMode: true }, { platform: 'linux' }, { app: { isPackaged: false } }]) {
    const { startup, writes } = fixture(options);
    assert.equal(startup.read().supported, false);
    assert.throws(() => startup.set(true));
    assert.equal(writes.length, 0);
  }
});
