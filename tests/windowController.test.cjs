const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function api() {
  const filename = path.join(__dirname, '../src/services/windowController.js');
  assert.ok(fs.existsSync(filename), 'window recovery controller must exist');
  return require(filename);
}

function fixture(options = {}) {
  const events = [];
  let bounds = options.bounds || { x: 100, y: 100, width: 400, height: 600 };
  let visible = options.visible !== false;
  let minimized = !!options.minimized;
  const native = {
    isDestroyed: () => !!options.destroyed,
    isVisible: () => visible,
    isMinimized: () => minimized,
    setIgnoreMouseEvents: value => events.push(['ignore', value]),
    setEnabled: value => events.push(['enabled', value]),
    restore: () => { minimized = false; events.push(['restore']); },
    getBounds: () => ({ ...bounds }),
    setBounds: value => { bounds = value; events.push(['bounds', value]); },
    show: () => { visible = true; events.push(['show']); },
    focus: () => events.push(['focus']),
    hide: () => { visible = false; events.push(['hide']); }
  };
  const displays = options.displays || [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
  const screen = {
    getAllDisplays: () => displays,
    getCursorScreenPoint: () => ({ x: 10, y: 10 }),
    getDisplayNearestPoint: () => displays[options.activeDisplay || 0],
    getPrimaryDisplay: () => displays[0]
  };
  let settings = { accelerator: options.accelerator };
  let failure;
  const shortcuts = new Map();
  const globalShortcut = {
    register(key, handler) {
      if (failure === 'throw') throw new Error('Invalid accelerator');
      if (failure === 'conflict') return false;
      shortcuts.set(key, handler);
      return true;
    },
    unregister: key => shortcuts.delete(key)
  };
  const controller = api().createWindowController({
    getWindow: () => options.nullWindow ? null : native,
    screen,
    globalShortcut,
    readSettings: () => settings,
    writeSettings: patch => {
      if (options.writeFailure) throw new Error('Disk is read only');
      settings = { ...settings, ...patch };
    },
    onShow: () => events.push(['onShow']),
    onHide: () => events.push(['onHide'])
  });
  return { controller, native, events, screen, shortcuts,
    settings: () => settings, setFailure: value => { failure = value; } };
}

test('recovers a hidden minimized locked window and synchronizes renderer unlock', () => {
  const f = fixture({ visible: false, minimized: true });
  assert.equal(f.controller.recover(), true);
  assert.deepEqual(f.events, [
    ['ignore', false], ['enabled', true], ['restore'],
    ['show'], ['focus'], ['onShow']
  ]);
});

test('repeated recovery never moves a valid window', () => {
  const f = fixture();
  f.controller.recover();
  f.controller.recover();
  assert.equal(f.events.filter(event => event[0] === 'bounds').length, 0);
});

test('valid saved dimensions and negative monitor origins survive recovery', () => {
  const bounds = { x: -1400, y: -200, width: 520, height: 740 };
  const f = fixture({ bounds, displays: [
    { workArea: { x: -1600, y: -300, width: 1600, height: 1200 } },
    { workArea: { x: 0, y: 40, width: 1920, height: 1000 } }
  ] });
  assert.deepEqual(api().getSafeBounds(bounds, f.screen), bounds);
  f.controller.recover();
  assert.equal(f.events.some(event => event[0] === 'bounds'), false);
});

test('removed monitor bounds are repaired within active work area preserving size', () => {
  const f = fixture({ bounds: { x: -4000, y: 50, width: 510, height: 720 }, displays: [
    { workArea: { x: 1920, y: 40, width: 1440, height: 860 } }
  ] });
  f.controller.recover();
  assert.deepEqual(f.native.getBounds(), { x: 1920, y: 50, width: 510, height: 720 });
});

test('oversized bounds clamp to reduced work area including nonzero origin', () => {
  const f = fixture({ displays: [{ workArea: { x: -1440, y: 48, width: 1440, height: 852 } }] });
  assert.deepEqual(api().getSafeBounds({ x: -2000, y: -10, width: 4000, height: 3000 }, f.screen),
    { x: -1440, y: 48, width: 1440, height: 852 });
});

test('partially offscreen bounds clamp on their existing monitor', () => {
  const f = fixture({ displays: [
    { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    { workArea: { x: -1440, y: 0, width: 1440, height: 900 } }
  ] });
  assert.deepEqual(api().getSafeBounds({ x: -1400, y: 600, width: 500, height: 600 }, f.screen),
    { x: -1400, y: 300, width: 500, height: 600 });
});

test('null and destroyed windows safely decline recovery and hide', () => {
  for (const options of [{ nullWindow: true }, { destroyed: true }]) {
    const f = fixture(options);
    assert.equal(f.controller.recover(), false);
    assert.equal(f.controller.hide(), false);
    assert.equal(f.controller.toggle(), false);
    assert.deepEqual(f.events, []);
  }
});

test('default global accelerator toggles visible and hidden windows', () => {
  const f = fixture();
  assert.equal(f.controller.registerAccelerator().ok, true);
  const handler = f.shortcuts.get(api().DEFAULT_ACCELERATOR);
  assert.equal(typeof handler, 'function');
  handler();
  assert.equal(f.native.isVisible(), false);
  handler();
  assert.equal(f.native.isVisible(), true);
  assert.equal(f.events.some(event => event[0] === 'onHide'), true);
});

test('accelerator restores minimized windows instead of hiding them', () => {
  const f = fixture({ minimized: true });
  f.controller.registerAccelerator();
  f.shortcuts.get(api().DEFAULT_ACCELERATOR)();
  assert.equal(f.native.isMinimized(), false);
  assert.equal(f.native.isVisible(), true);
});

test('startup uses saved accelerator and reports registration failure', () => {
  const f = fixture({ accelerator: 'Alt+Shift+Y' });
  f.setFailure('conflict');
  const result = f.controller.registerAccelerator();
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.equal(f.shortcuts.size, 0);
  assert.equal(f.settings().accelerator, 'Alt+Shift+Y');
  f.setFailure(null);
  assert.equal(f.controller.registerAccelerator().ok, true);
  assert.equal(f.controller.getAccelerator(), 'Alt+Shift+Y');
});

test('failed accelerator changes preserve previous live registration and settings', () => {
  for (const failure of ['conflict', 'throw']) {
    const f = fixture({ accelerator: 'Alt+Shift+Y' });
    f.controller.registerAccelerator();
    f.setFailure(failure);
    assert.equal(f.controller.setAccelerator('Alt+Shift+Q').ok, false);
    assert.equal(f.controller.getAccelerator(), 'Alt+Shift+Y');
    assert.deepEqual([...f.shortcuts.keys()], ['Alt+Shift+Y']);
    assert.equal(f.settings().accelerator, 'Alt+Shift+Y');
  }
});

test('successful accelerator update persists and removes only old registration', () => {
  const f = fixture();
  f.controller.registerAccelerator();
  assert.equal(f.controller.setAccelerator('Alt+Shift+Y').ok, true);
  assert.equal(f.settings().accelerator, 'Alt+Shift+Y');
  assert.deepEqual([...f.shortcuts.keys()], ['Alt+Shift+Y']);
  assert.equal(f.controller.setAccelerator('Alt+Shift+Y').ok, true);
  f.controller.dispose();
  f.controller.dispose();
  assert.equal(f.shortcuts.size, 0);
  assert.equal(f.controller.registerAccelerator().ok, false);
});

test('persistence failure rolls back new registration and preserves old settings', () => {
  const f = fixture({ accelerator: 'Alt+Shift+Y', writeFailure: true });
  assert.equal(f.controller.registerAccelerator().ok, true);
  assert.equal(f.controller.setAccelerator('Alt+Shift+Q').ok, false);
  assert.deepEqual([...f.shortcuts.keys()], ['Alt+Shift+Y']);
  assert.equal(f.controller.getAccelerator(), 'Alt+Shift+Y');
  assert.equal(f.settings().accelerator, 'Alt+Shift+Y');
});

test('blank and non-string accelerator inputs preserve valid registration', () => {
  const f = fixture();
  f.controller.registerAccelerator();
  for (const value of ['', '   ', null, 42]) {
    assert.equal(f.controller.setAccelerator(value).ok, false);
  }
  assert.deepEqual([...f.shortcuts.keys()], [api().DEFAULT_ACCELERATOR]);
});

test('saving the active accelerator repairs imported settings after registration conflict', () => {
  const f = fixture({ accelerator: 'Alt+Shift+Y' });
  assert.equal(f.controller.registerAccelerator().ok, true);
  // Import changes disk settings before trying to register the imported shortcut.
  f.settings().accelerator = 'Alt+Shift+Q';
  f.setFailure('conflict');
  assert.equal(f.controller.setAccelerator('Alt+Shift+Q').ok, false);
  const activeHandler = f.shortcuts.get('Alt+Shift+Y');
  assert.equal(f.controller.setAccelerator('Alt+Shift+Y').ok, true);
  assert.equal(f.settings().accelerator, 'Alt+Shift+Y');
  assert.equal(f.controller.getAccelerator(), 'Alt+Shift+Y');
  assert.deepEqual([...f.shortcuts.keys()], ['Alt+Shift+Y']);
  assert.equal(f.shortcuts.get('Alt+Shift+Y'), activeHandler);
});

test('saving the active accelerator reports persistence failure without removing its registration', () => {
  const f = fixture({ accelerator: 'Alt+Shift+Y', writeFailure: true });
  assert.equal(f.controller.registerAccelerator().ok, true);
  assert.equal(f.controller.registerAccelerator().ok, true, 'startup registration must not write settings');
  f.settings().accelerator = 'Alt+Shift+Q';
  const activeHandler = f.shortcuts.get('Alt+Shift+Y');
  const result = f.controller.setAccelerator('Alt+Shift+Y');
  assert.equal(result.ok, false);
  assert.match(result.error, /Disk is read only/);
  assert.equal(f.settings().accelerator, 'Alt+Shift+Q');
  assert.equal(f.controller.getAccelerator(), 'Alt+Shift+Y');
  assert.deepEqual([...f.shortcuts.keys()], ['Alt+Shift+Y']);
  assert.equal(f.shortcuts.get('Alt+Shift+Y'), activeHandler);
});
