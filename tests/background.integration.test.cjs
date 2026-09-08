const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const babel = require('@babel/core');
const { TaskRepository } = require('../src/services/taskRepository');

const project = path.resolve(__dirname, '..');
const nativeRequire = createRequire(path.join(project, 'package.json'));
const plain = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));
const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

// Execute production main-process modules in an isolated module cache. Only
// Electron and process/clock boundaries are replaced; repository I/O is real.
async function launch(t, { savedBounds, shortcutConflict = false, clipboardPng = null, initialSettings, selectedDirectory = null } = {}) {
  const tempRoot = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempRoot, 'yanqian-background-test-'));
  const clock = new Map();
  let timerId = 0;
  t.after(() => {
    clock.clear();
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), tempRoot);
    assert.ok(path.basename(target).startsWith('yanqian-background-test-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const stateFile = path.join(directory, 'window-state.json');
  if (savedBounds) fs.writeFileSync(stateFile, JSON.stringify(savedBounds));
  if (initialSettings) fs.writeFileSync(path.join(directory, 'data.json'), JSON.stringify({todoList:[],doneList:[],settings:initialSettings}));

  const sent = [];
  const calls = [];
  const windows = [];
  const trays = [];
  const shortcuts = new Map();
  const handlers = new Map();
  const errors = [];
  const ipcMain = new EventEmitter();
  ipcMain.handle = (channel, handler) => handlers.set(channel, handler);
  const app = new EventEmitter();
  let quitCount = 0;
  Object.assign(app, {
    isPackaged: false,
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    getPath: () => directory,
    setPath: () => {},
    setName: name => calls.push(['setName', name]),
    quit() {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      app.emit('before-quit', event);
      if (!event.prevented) { quitCount += 1; app.emit('will-quit'); }
    },
    exit: code => errors.push(`app.exit(${code})`)
  });
  const workArea = { x: -1600, y: 40, width: 1600, height: 1040 };
  const screen = new EventEmitter();
  Object.assign(screen, {
    getAllDisplays: () => [{ workArea }],
    getPrimaryDisplay: () => ({ workArea }),
    getCursorScreenPoint: () => ({ x: -600, y: 200 }),
    getDisplayNearestPoint: () => ({ workArea })
  });
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.visible = options.show !== false;
      this.minimized = false;
      this.destroyed = false;
      this.enabled = true;
      this.ignoring = false;
      this.alwaysOnTop = false;
      this.movable = true;
      this.resizable = true;
      this.webContents = new EventEmitter();
      this.webContents.send = (channel, payload) => sent.push({ channel, payload });
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    isMinimized() { return this.minimized; }
    setIgnoreMouseEvents(value) { this.ignoring = value; calls.push(['ignore', value]); }
    setAlwaysOnTop(value) { this.alwaysOnTop = value; calls.push(['alwaysOnTop', value]); }
    setMovable(value) { this.movable = value; calls.push(['movable', value]); }
    setResizable(value) { this.resizable = value; calls.push(['resizable', value]); }
    setEnabled(value) { this.enabled = value; calls.push(['enabled', value]); }
    getBounds() { return { ...this.bounds }; }
    setBounds(bounds) { this.bounds = plain(bounds); calls.push(['bounds', plain(bounds)]); }
    show() { this.visible = true; calls.push(['show']); }
    focus() { calls.push(['focus']); }
    hide() { this.visible = false; calls.push(['hide']); }
    minimize() { this.minimized = true; calls.push(['minimize']); }
    restore() { this.minimized = false; this.emit('restore'); calls.push(['restore']); }
    hookWindowMessage(message) { calls.push(['hookWindowMessage', message]); }
    async loadURL(url) { calls.push(['loadURL', url]); }
    reload() { calls.push(['reload']); }
  }
  class Tray extends EventEmitter {
    constructor() { super(); trays.push(this); }
    setContextMenu(menu) { this.menu = menu; }
    setToolTip() {}
  }
  const electron = {
    app, ipcMain, screen, BrowserWindow, Tray,
    Menu: { buildFromTemplate: items => items, setApplicationMenu: () => {} },
    protocol: { registerSchemesAsPrivileged: () => {} },
    globalShortcut: {
      register(key, callback) { if (shortcutConflict) return false; shortcuts.set(key, callback); return true; },
      unregister: key => shortcuts.delete(key)
    },
    dialog: {
      showErrorBox: (title, message) => errors.push({ title, message }),
      showMessageBox: async options => { calls.push(['showMessageBox', plain(options)]); return { response: 1 }; },
      showOpenDialog: async options => { calls.push(['showOpenDialog', plain(options)]); return selectedDirectory ? { canceled: false, filePaths: [selectedDirectory] } : { canceled: true, filePaths: [] }; }
    },
    shell: { openPath: async () => '' },
    Notification: { isSupported: () => false },
    clipboard: {
      readImage: () => ({
        isEmpty: () => !clipboardPng,
        getSize: () => clipboardPng ? { width: 1, height: 1 } : { width: 0, height: 0 },
        toPNG: () => clipboardPng || Buffer.alloc(0)
      })
    },
    nativeImage: {
      createFromBuffer: bytes => ({
        isEmpty: () => !Buffer.isBuffer(bytes) || !bytes.equals(png1x1),
        getSize: () => ({ width: 1, height: 1 })
      })
    }
  };
  const processBoundary = new EventEmitter();
  Object.assign(processBoundary, {
    env: { NODE_ENV: 'production', YANQIAN_TEST: '1', YANQIAN_DATA_DIR: directory },
    platform: 'win32', argv: ['node', 'background.js'], execPath: process.execPath
  });
  function addTimer(callback, delay, repeat) {
    const id = ++timerId;
    clock.set(id, { callback, delay, repeat });
    return id;
  }
  const context = vm.createContext({
    console, Buffer, process: processBoundary, __static: path.join(project, 'public'),
    setTimeout: (callback, delay) => addTimer(callback, delay, false),
    clearTimeout: id => clock.delete(id),
    setInterval: (callback, delay) => addTimer(callback, delay, true),
    clearInterval: id => clock.delete(id)
  });
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const transformed = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
      filename, babelrc: false, configFile: false,
      plugins: ['@babel/plugin-transform-modules-commonjs']
    }).code;
    const requireModule = specifier => {
      if (specifier === 'electron') return electron;
      if (specifier === 'vue-cli-plugin-electron-builder/lib') return { createProtocol() {} };
      if (specifier === 'electron-updater') return { autoUpdater: { checkForUpdatesAndNotify: async () => {} } };
      if (specifier.startsWith('@/') || specifier.startsWith('.')) {
        let resolved = specifier.startsWith('@/')
          ? path.join(project, 'src', specifier.slice(2))
          : path.resolve(path.dirname(filename), specifier);
        if (resolved.endsWith('.json')) return nativeRequire(resolved);
        if (!path.extname(resolved)) resolved += '.js';
        return load(resolved);
      }
      return nativeRequire(specifier);
    };
    const execute = vm.runInContext(`(function(require,module,exports,__filename,__dirname) {\n${transformed}\n})`, context, { filename });
    execute(requireModule, module, module.exports, filename, path.dirname(filename));
    return module.exports;
  }
  load(path.join(project, 'src/background.js'));
  await settle();
  assert.deepEqual(errors, [], 'production startup should succeed');
  assert.equal(windows.length, 1);
  const win = windows[0];
  function latestFlush() {
    return sent.filter(message => message.channel === 'window:flush-request').at(-1);
  }
  return {
    app, win, trays, calls, sent, shortcuts, directory, stateFile,
    quitCount: () => quitCount,
    invoke: (channel, payload) => handlers.get(channel)({ sender: win.webContents }, payload),
    latestFlush,
    reply(ok, { id = latestFlush().payload, sender = win.webContents } = {}) {
      ipcMain.emit('window:flush-result', { sender }, { id, ok });
    },
    command(action, payload) {
      const event = { sender: win.webContents };
      ipcMain.emit('tasks:request', event, { action: 'command', payload: { action, payload } });
      assert.equal(event.returnValue.ok, true, event.returnValue.error);
      return plain(event.returnValue.value);
    },
    tick(delay) {
      for (const [id, timer] of [...clock]) {
        if (timer.delay === delay) {
          if (!timer.repeat) clock.delete(id);
          timer.callback();
        }
      }
    }
  };
}

test('clipboard screenshots can be attached, lazily read and deleted with ownership checks', async t => {
  const f = await launch(t, { clipboardPng: png1x1 });
  const id = f.command('add', { content: 'attach here' }).todoList[0].id;
  const pasted = await f.invoke('app:action', { action: 'pasteScreenshot', payload: { list: 'todoList', taskId: id } });
  assert.equal(pasted.ok, true, pasted.error);
  const shot = pasted.value.todoList[0].screenshots[0];
  const read = await f.invoke('app:action', { action: 'readScreenshot', payload: { list: 'todoList', taskId: id, screenshotId: shot.id } });
  assert.equal(read.ok, true, read.error);assert.equal(read.value, `data:image/png;base64,${png1x1.toString('base64')}`);
  const wrongOwner = await f.invoke('app:action', { action: 'readScreenshot', payload: { list: 'todoList', taskId: 'missing', screenshotId: shot.id } });
  assert.equal(wrongOwner.ok, false);
  const removed = await f.invoke('app:action', { action: 'deleteScreenshot', payload: { list: 'todoList', taskId: id, screenshotId: shot.id } });
  assert.equal(removed.ok, true);assert.equal(removed.value.todoList[0].screenshots.length, 0);
});

test('renderer can save interface transparency through its dedicated command', async t => {
  const f = await launch(t);
  const state = f.command('setInterfaceTransparency', { value: 55 });
  assert.equal(state.settings.interfaceTransparency, 55);
  const saved = JSON.parse(fs.readFileSync(path.join(f.directory, 'data.json'), 'utf8'));
  assert.equal(saved.settings.interfaceTransparency, 55);
});

test('window lock stays interactive, fixed and above other applications', async t => {
  const f = await launch(t);
  const locked = await f.invoke('setWindowLocked', true);
  assert.equal(locked, true);
  assert.equal(f.win.ignoring, false);
  assert.equal(f.win.alwaysOnTop, true);
  assert.equal(f.win.movable, false);
  assert.equal(f.win.resizable, false);
  const saved = JSON.parse(fs.readFileSync(path.join(f.directory, 'data.json'), 'utf8'));
  assert.equal(saved.settings.windowLocked, true);

  const unlocked = await f.invoke('setWindowLocked', false);
  assert.equal(unlocked, false);
  assert.equal(f.win.alwaysOnTop, false);
  assert.equal(f.win.movable, true);
  assert.equal(f.win.resizable, true);
});

test('saved window lock is restored at startup and blocks edge auto-hide', async t => {
  const f = await launch(t, { initialSettings: { windowLocked: true } });
  assert.equal(f.win.alwaysOnTop, true);
  assert.equal(f.win.movable, false);
  f.win.bounds = { x: -320, y: 100, width: 320, height: 290 };
  f.tick(30);
  await new Promise(resolve => setTimeout(resolve, 70));
  f.tick(30);
  assert.deepEqual(f.win.bounds, { x: -320, y: 100, width: 320, height: 290 });
});

test('empty clipboard and hidden task reject screenshot attachment', async t => {
  const f = await launch(t);
  const id = f.command('add', { content: 'private' }).todoList[0].id;
  let result = await f.invoke('app:action', { action: 'pasteScreenshot', payload: { list: 'todoList', taskId: id } });
  assert.equal(result.ok, false);assert.match(result.error, /剪贴板里没有截图/);
  f.command('setVisibility', { list: 'todoList', id, hidden: true });
  result = await f.invoke('app:action', { action: 'pasteScreenshot', payload: { list: 'todoList', taskId: id } });
  assert.equal(result.ok, false);assert.match(result.error, /隐藏/);
});

test('confirmed tab deletion does not open a native dialog and moves tasks to trash',async t=>{
  const f=await launch(t);const added=f.command('addTab',{name:'工作'});const tab=added.tabs.find(item=>item.name==='工作');const task=f.command('add',{content:'keep recoverable',tabId:tab.id}).todoList.find(item=>item.tabId===tab.id);
  const dialogsBefore=f.calls.filter(call=>call[0]==='showMessageBox').length;const result=await f.invoke('app:action',{action:'deleteTab',payload:{id:tab.id}});assert.equal(result.ok,true,result.error);assert.equal(f.calls.filter(call=>call[0]==='showMessageBox').length,dialogsBefore);assert.ok(!result.value.tabs.some(item=>item.id===tab.id));assert.equal(result.value.trashList[0].task.id,task.id);
  const completed=await f.invoke('app:action',{action:'deleteTab',payload:{id:'done'}});assert.equal(completed.ok,false);assert.match(completed.error,/已完成/);
});

test('existing data location is confirmed in the renderer and then activated safely', async t => {
  const externalRoot=fs.mkdtempSync(path.join(os.tmpdir(),'yanqian-existing-location-'));t.after(()=>fs.rmSync(externalRoot,{recursive:true,force:true}));
  const target=path.join(externalRoot,'yanqian-todo-list');const existing=new TaskRepository({directory:target});existing.command('add',{content:'existing data'});
  const f=await launch(t,{selectedDirectory:target});f.command('add',{content:'current data'});
  const choose=f.invoke('app:action',{action:'changeDirectory'});await settle();f.reply(true);const choice=await choose;
  assert.equal(choice.ok,true,choice.error);assert.deepEqual(plain(choice.value),{confirmation:'replaceData',directory:target});
  const activate=f.invoke('app:action',{action:'replaceDirectory'});await settle();f.reply(true);const switched=await activate;
  assert.equal(switched.ok,true,switched.error);assert.equal(switched.value,'保存位置已更改，事项和截图已迁移');
  const active=f.command('add',{content:'after switch'});assert.equal(active.todoList[0].content,'current data');
  assert.equal(new TaskRepository({directory:f.directory}).snapshot().todoList[0].content,'current data');
});

test('second instance recovers the actual main window without resetting saved valid coordinates', async t => {
  const savedBounds = { x: -1450, y: 110, width: 550, height: 750 };
  const f = await launch(t, { savedBounds });
  assert.deepEqual(f.win.getBounds(), savedBounds);
  f.win.visible = false;
  f.win.minimized = true;
  f.win.enabled = false;
  f.win.ignoring = true;
  f.calls.length = 0;
  f.app.emit('second-instance');
  f.app.emit('second-instance');
  assert.equal(f.win.visible, true);
  assert.equal(f.win.minimized, false);
  assert.equal(f.win.enabled, true);
  assert.equal(f.win.ignoring, false);
  assert.equal(f.calls.filter(call => call[0] === 'focus').length, 2);
  assert.equal(f.calls.some(call => call[0] === 'bounds'), false);
  assert.deepEqual(f.win.getBounds(), savedBounds);
});

test('native restore event stays interactive and synchronizes the saved lock state', async t => {
  const f = await launch(t);
  f.win.ignoring = true;
  f.win.enabled = false;
  f.sent.length = 0;
  f.win.emit('restore');
  assert.equal(f.win.ignoring, false);
  assert.equal(f.win.enabled, true);
  assert.ok(f.sent.some(message => message.channel === 'window:locked' && message.payload === false));
});

test('window control handlers minimize and close through the safe quit flow', async t => {
  const f = await launch(t);
  await f.invoke('minimizeWindow');
  assert.equal(f.win.minimized, true);
  assert.ok(f.calls.some(call => call[0] === 'minimize'));

  const closing = f.invoke('closeWindow');
  assert.ok(f.latestFlush(), 'close must request a final renderer flush');
  assert.equal(f.quitCount(), 0);
  f.reply(true);
  await closing;
  await settle();
  assert.equal(f.quitCount(), 1);
});

test('main process installs no WM_INITMENU hook that could disable the window', async t => {
  const f = await launch(t);
  assert.equal(f.calls.some(call => call[0] === 'hookWindowMessage' && call[1] === 0x116), false);
  assert.equal(f.calls.some(call => call[0] === 'enabled' && call[1] === false), false);
  assert.equal(f.win.options.minimizable, true);
  assert.equal(f.win.options.skipTaskbar, false);
});

test('normal close waits for matching renderer flush then persists final bounds and task backup', async t => {
  const f = await launch(t);
  const finalBounds = { x: -1300, y: 180, width: 610, height: 690 };
  f.win.bounds = finalBounds;
  let prevented = false;
  f.win.emit('close', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(f.quitCount(), 0);
  assert.ok(f.latestFlush());
  f.reply(true, { sender: {} });
  f.reply(true, { id: f.latestFlush().payload + 1 });
  await settle();
  assert.equal(f.quitCount(), 0, 'untrusted or stale acknowledgements must not quit');
  f.command('add', { content: 'latest renderer edit before close' });
  f.reply(true);
  await settle();
  assert.equal(f.quitCount(), 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.stateFile, 'utf8')), finalBounds);
  const backups = fs.readdirSync(path.join(f.directory, 'backups')).map(name =>
    JSON.parse(fs.readFileSync(path.join(f.directory, 'backups', name), 'utf8')));
  assert.ok(backups.some(backup => backup.todoList.some(task => task.content === 'latest renderer edit before close')));
  assert.equal(f.shortcuts.size, 0, 'successful quit disposes global shortcut');
});

test('negative flush response cancels quit and recovers the window', async t => {
  const f = await launch(t);
  f.win.visible = false;
  f.app.quit();
  assert.equal(f.quitCount(), 0);
  f.reply(false);
  await settle();
  assert.equal(f.quitCount(), 0);
  assert.equal(f.win.visible, true);
  assert.ok(f.shortcuts.size > 0);
});

test('hide flush failure restores the window and does not mark hint as acknowledged', async t => {
  const f = await launch(t);
  await f.invoke('hideWindow');
  assert.ok(f.latestFlush());
  f.reply(false);
  await settle();
  assert.equal(f.win.visible, true);
  const data = JSON.parse(fs.readFileSync(path.join(f.directory, 'data.json'), 'utf8'));
  assert.equal(data.settings.hideHintSeen, undefined);
});

test('flush timeout restores hidden window, cancels quit, and allows a later retry', async t => {
  const f = await launch(t);
  await f.invoke('hideWindow');
  f.app.quit();
  assert.equal(f.sent.filter(message => message.channel === 'window:flush-request').length, 1,
    'hide and quit should share the outstanding flush');
  f.tick(5000);
  await settle();
  assert.equal(f.win.visible, true);
  assert.equal(f.quitCount(), 0);
  assert.ok(f.sent.some(message => message.channel === 'app:notice' && message.payload.includes('窗口未响应')));
  f.app.quit();
  assert.equal(f.sent.filter(message => message.channel === 'window:flush-request').length, 2);
  f.reply(true);
  await settle();
  assert.equal(f.quitCount(), 1);
});

test('move events debounce an atomic window-state.json write with width and height', async t => {
  const f = await launch(t);
  const initial = fs.readFileSync(f.stateFile, 'utf8');
  f.win.bounds = { x: -1500, y: 160, width: 700, height: 800 };
  f.win.emit('move');
  assert.equal(fs.readFileSync(f.stateFile, 'utf8'), initial);
  f.win.bounds = { x: -1400, y: 170, width: 720, height: 780 };
  f.win.emit('resize');
  f.tick(150);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.stateFile, 'utf8')), f.win.bounds);
  assert.equal(fs.readdirSync(f.directory).some(name => name.endsWith('.tmp')), false);
});

test('shortcut registration conflict reports the failure while tray recovery remains functional', async t => {
  const f = await launch(t, { shortcutConflict: true });
  assert.equal(f.shortcuts.size, 0);
  assert.ok(f.sent.some(message => message.channel === 'app:notice' && message.payload.includes('快捷键不可用')));
  f.win.visible = false;
  f.trays[0].emit('click');
  assert.equal(f.win.visible, true);
  assert.ok(f.sent.some(message => message.channel === 'window:locked' && message.payload === false));
});

test('canceling a location conflict leaves both folders intact and invalidates replacement',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yanqian-cancel-location-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const target=new TaskRepository({directory:root});target.command('add',{content:'destination'});const bytes=fs.readFileSync(target.file);
 const f=await launch(t,{selectedDirectory:root});f.command('add',{content:'current'});
 const choose=f.invoke('app:action',{action:'changeDirectory'});await settle();f.reply(true);assert.equal((await choose).value.confirmation,'replaceData');
 assert.equal((await f.invoke('app:action',{action:'cancelDirectoryChange'})).ok,true);
 const result=await f.invoke('app:action',{action:'replaceDirectory'});assert.equal(result.ok,false);
 assert.ok(fs.readFileSync(target.file).equals(bytes));assert.equal(new TaskRepository({directory:f.directory}).snapshot().todoList[0].content,'current');
});

test('cancel during save flush cannot redirect a pending replacement',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yanqian-flush-cancel-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const target=new TaskRepository({directory:root});target.command('add',{content:'destination'});const bytes=fs.readFileSync(target.file);
 const f=await launch(t,{selectedDirectory:root});f.command('add',{content:'current'});
 const choose=f.invoke('app:action',{action:'changeDirectory'});await settle();f.reply(true);await choose;
 const replace=f.invoke('app:action',{action:'replaceDirectory'});await settle();
 await f.invoke('app:action',{action:'cancelDirectoryChange'});f.reply(true);
 assert.equal((await replace).ok,false);assert.ok(fs.readFileSync(target.file).equals(bytes));
});
