const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { makeTempHome, cleanup } = require("./helpers.js");

test("paths resolve under the test home and config override", () => {
  const env = makeTempHome();
  try {
    // Require fresh after env is set (paths reads env at call time, but be safe).
    delete require.cache[require.resolve("../lib/paths.js")];
    const paths = require("../lib/paths.js");
    assert.equal(paths.homeDir(), env.dir);
    assert.equal(paths.configDir(), env.configHome);
    assert.ok(paths.dataDirs().includes(env.dataHome));
    assert.ok(paths.cacheDirs().includes(env.cacheHome));
    assert.equal(paths.launchAgentsDir(), env.launchAgents);
    assert.ok(paths.appStateDir().startsWith(env.dir));
    assert.ok(paths.logDirs().length > 0);
    const nested = path.join(env.dir, "a", "b");
    paths.ensureDir(nested);
    assert.ok(require("node:fs").existsSync(nested));
  } finally {
    cleanup(env.dir);
  }
});
