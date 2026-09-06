const { test } = require("node:test");
const assert = require("node:assert/strict");

test("development server websocket stack loads on the supported Node runtime", () => {
  assert.doesNotThrow(() => require("sockjs"));
});
