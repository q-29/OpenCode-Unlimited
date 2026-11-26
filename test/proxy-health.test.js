const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeTempHome, cleanup } = require("./helpers.js");

test("proxy-health quarantines after two failures and ranks healthy first", () => {
  const env = makeTempHome();
  try {
    delete require.cache[require.resolve("../lib/proxy-health.js")];
    const health = require("../lib/proxy-health.js");
    health.record({ url: "socks5://127.0.0.1:1080", ok: true, ms: 120 });
    health.record({ url: "socks5://127.0.0.1:1081", ok: false, ms: 0, reason: "timeout" });
    health.record({ url: "socks5://127.0.0.1:1081", ok: false, ms: 0, reason: "timeout" });
    const ranked = health.rank(["socks5://127.0.0.1:1081", "socks5://127.0.0.1:1080", "socks5://127.0.0.1:1082"]);
    assert.equal(ranked.proxies[0], "socks5://127.0.0.1:1080");
    assert.equal(ranked.proxies[ranked.proxies.length - 1], "socks5://127.0.0.1:1081");
    assert.equal(ranked.held, 1);
    // A success clears the quarantine.
    health.record({ url: "socks5://127.0.0.1:1081", ok: true, ms: 200 });
    const after = health.rank(["socks5://127.0.0.1:1081"]);
    assert.equal(after.held, 0);
    health.reset();
    assert.equal(health.show([]).total, 0);
  } finally {
    cleanup(env.dir);
  }
});
