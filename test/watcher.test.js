const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeTempHome, cleanup } = require("./helpers.js");

test("watcher plist is a valid launchd agent for the CLI", () => {
  const env = makeTempHome();
  try {
    delete require.cache[require.resolve("../lib/watcher.js")];
    const watcher = require("../lib/watcher.js");
    const plist = watcher.plistContents({ cliPath: "/tmp/bin/opencode-unlimited", nodePath: "/opt/homebrew/bin/node" });
    assert.ok(plist.includes("<string>ai.opencode.unlimited.watch</string>"));
    assert.ok(plist.includes("<string>/tmp/bin/opencode-unlimited</string>"));
    assert.ok(plist.includes("<string>watch</string>"));
    assert.ok(plist.includes("<key>RunAtLoad</key>"));
    assert.ok(plist.includes("<key>KeepAlive</key>"));
    assert.ok(plist.startsWith('<?xml version="1.0"'));
    assert.equal(watcher.plistPath(), env.launchAgents + "/ai.opencode.unlimited.watch.plist");
  } finally {
    cleanup(env.dir);
  }
});

test("watcher rotation cap: 5 per 30 minutes", () => {
  const env = makeTempHome();
  try {
    delete require.cache[require.resolve("../lib/watcher.js")];
    const watcher = require("../lib/watcher.js");
    const now = Date.now();
    assert.equal(watcher.canRotate(now), true);
    for (let i = 0; i < 5; i += 1) watcher.recordRotation(now);
    assert.equal(watcher.rotationsInWindow(now).length, 5);
    assert.equal(watcher.canRotate(now), false);
    assert.equal(watcher.canRotate(now + 31 * 60000), true);
  } finally {
    cleanup(env.dir);
  }
});
