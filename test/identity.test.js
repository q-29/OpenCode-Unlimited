const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeTempHome, cleanup } = require("./helpers.js");

test("identity rotate mints 40-hex projectId and keeps files in sync", () => {
  const env = makeTempHome();
  try {
    delete require.cache[require.resolve("../lib/identity.js")];
    const identity = require("../lib/identity.js");
    assert.equal(identity.show().exists, false);
    const first = identity.rotate();
    assert.match(first.projectId, /^[0-9a-f]{40}$/);
    assert.ok(first.deviceId);
    assert.equal(first.generation, 1);

    const shield = JSON.parse(fs.readFileSync(identity.shieldIdentityFile(), "utf8"));
    assert.equal(shield.projectId, first.projectId);
    assert.equal(shield.deviceId, first.deviceId);
    assert.equal(fs.readFileSync(identity.shimGuidFile(), "utf8").trim(), first.deviceId);

    const second = identity.rotate();
    assert.equal(second.generation, 2);
    assert.notEqual(second.projectId, first.projectId);
    assert.equal(second.previous, first.deviceId);

    const shown = identity.show();
    assert.equal(shown.exists, true);
    assert.equal(shown.projectId, second.projectId);
    assert.match(shown.fingerprint, /^[0-9a-f]{16}$/);

    const restored = identity.restore();
    assert.equal(restored.restored, true);
    assert.equal(identity.show().exists, false);
    assert.ok(!fs.existsSync(identity.shimGuidFile()));
  } finally {
    cleanup(env.dir);
  }
});

test("identity rotate accepts an explicit 40-hex projectId", () => {
  const env = makeTempHome();
  try {
    delete require.cache[require.resolve("../lib/identity.js")];
    const identity = require("../lib/identity.js");
    const wanted = "a".repeat(40);
    const result = identity.rotate({ projectId: wanted });
    assert.equal(result.projectId, wanted);
    assert.ok(fs.existsSync(path.join(env.configHome, "unlimited-identity.json")));
  } finally {
    cleanup(env.dir);
  }
});
