const DEFAULT_ACCELERATOR = "CommandOrControl+Shift+Space";

function getSafeBounds(bounds, screen) {
  const areas = screen.getAllDisplays().map(display => display.workArea);
  const validSize =
    Number.isFinite(bounds.width) &&
    bounds.width > 0 &&
    Number.isFinite(bounds.height) &&
    bounds.height > 0;
  const validPosition = Number.isFinite(bounds.x) && Number.isFinite(bounds.y);
  // Do not move a window that still fits on any connected display.
  if (
    validSize &&
    validPosition &&
    areas.some(
      area =>
        bounds.x >= area.x &&
        bounds.y >= area.y &&
        bounds.x + bounds.width <= area.x + area.width &&
        bounds.y + bounds.height <= area.y + area.height
    )
  ) {
    return { ...bounds };
  }

  let area;
  let largestOverlap = 0;
  if (validSize && validPosition) {
    areas.forEach(candidate => {
      const width = Math.max(
        0,
        Math.min(bounds.x + bounds.width, candidate.x + candidate.width) -
          Math.max(bounds.x, candidate.x)
      );
      const height = Math.max(
        0,
        Math.min(bounds.y + bounds.height, candidate.y + candidate.height) -
          Math.max(bounds.y, candidate.y)
      );
      if (width * height > largestOverlap) {
        largestOverlap = width * height;
        area = candidate;
      }
    });
  }
  if (!area) {
    area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      .workArea;
  }
  const width = Math.min(
    area.width,
    Number.isFinite(bounds.width) && bounds.width > 0 ? bounds.width : 400
  );
  const height = Math.min(
    area.height,
    Number.isFinite(bounds.height) && bounds.height > 0 ? bounds.height : 600
  );
  return {
    x: Math.round(
      Math.min(
        Math.max(Number.isFinite(bounds.x) ? bounds.x : area.x, area.x),
        area.x + area.width - width
      )
    ),
    y: Math.round(
      Math.min(
        Math.max(Number.isFinite(bounds.y) ? bounds.y : area.y, area.y),
        area.y + area.height - height
      )
    ),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function createWindowController({
  getWindow,
  screen,
  globalShortcut,
  readSettings,
  writeSettings,
  onShow = () => {},
  onHide = () => {}
}) {
  let accelerator = null;
  let disposed = false;

  function currentWindow() {
    const window = getWindow();
    return !disposed && window && !window.isDestroyed() ? window : null;
  }

  function recover() {
    const window = currentWindow();
    if (!window) return false;
    window.setIgnoreMouseEvents(false);
    window.setEnabled(true);
    if (window.isMinimized()) window.restore();
    const bounds = window.getBounds();
    const safeBounds = getSafeBounds(bounds, screen);
    if (
      ["x", "y", "width", "height"].some(key => bounds[key] !== safeBounds[key])
    ) {
      window.setBounds(safeBounds);
    }
    window.show();
    window.focus();
    onShow();
    return true;
  }

  function hide() {
    const window = currentWindow();
    if (!window) return false;
    window.hide();
    onHide();
    return true;
  }

  function toggle() {
    const window = currentWindow();
    if (!window) return false;
    return window.isVisible() && !window.isMinimized() ? hide() : recover();
  }

  function failure(error) {
    return { ok: false, accelerator, error };
  }

  function updateAccelerator(value, persist) {
    if (disposed) return failure("Window controller has been disposed.");
    if (typeof value !== "string" || !value.trim()) {
      return failure("Enter a valid keyboard shortcut.");
    }
    const next = value.trim();
    if (next === accelerator) {
      try {
        // Imported settings can differ from the shortcut still registered here.
        if (persist) writeSettings({ accelerator: next });
      } catch (error) {
        return failure(
          error.message || "Could not save the keyboard shortcut."
        );
      }
      return { ok: true, accelerator };
    }
    try {
      // Keep the previous shortcut registered until the replacement is ready.
      if (!globalShortcut.register(next, toggle)) {
        return failure("This keyboard shortcut is already in use.");
      }
    } catch (error) {
      return failure(error.message || "The keyboard shortcut is invalid.");
    }
    try {
      if (persist) writeSettings({ accelerator: next });
    } catch (error) {
      globalShortcut.unregister(next);
      return failure(error.message || "Could not save the keyboard shortcut.");
    }
    if (accelerator) globalShortcut.unregister(accelerator);
    accelerator = next;
    return { ok: true, accelerator };
  }

  function registerAccelerator() {
    if (disposed) return failure("Window controller has been disposed.");
    try {
      const settings = readSettings() || {};
      return updateAccelerator(
        settings.accelerator || DEFAULT_ACCELERATOR,
        false
      );
    } catch (error) {
      return failure(error.message || "Could not load the keyboard shortcut.");
    }
  }

  function dispose() {
    if (disposed) return;
    if (accelerator) globalShortcut.unregister(accelerator);
    accelerator = null;
    disposed = true;
  }

  return {
    recover,
    hide,
    toggle,
    registerAccelerator,
    setAccelerator: value => updateAccelerator(value, true),
    getAccelerator: () => accelerator,
    dispose
  };
}

module.exports = { createWindowController, getSafeBounds, DEFAULT_ACCELERATOR };
