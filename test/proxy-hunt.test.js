const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeTempHome, cleanup } = require("./helpers.js");

test("proxy-hunt parses lists and normalizes urls", () => {
  const env = makeTempHome();
  try {
    delete require.cache[require.resolve("../lib/proxy-hunt.js")];
    const hunt = require("../lib/proxy-hunt.js");
    assert.equal(hunt.normalizeProxyUrl("127.0.0.1:1080"), "socks5://127.0.0.1:1080");
    assert.equal(hunt.normalizeProxyUrl("http://user:pass@10.0.0.1:3128"), "http://user:pass@10.0.0.1:3128");
    assert.equal(hunt.normalizeProxyUrl("# comment"), "");
    assert.equal(hunt.normalizeProxyUrl("ftp://127.0.0.1:21"), "");
    const parsed = hunt.parseProxyList("1.1.1.1:1080\n2.2.2.2:3128, 1.1.1.1:1080\n", "socks5");
    assert.deepEqual(parsed, ["socks5://1.1.1.1:1080", "socks5://2.2.2.2:3128"]);
  } finally {
    cleanup(env.dir);
  }
});

test("proxy-hunt pool add/load/clear round-trips", () => {
  const env = makeTempHome();
  try {
    delete require.cache[require.resolve("../lib/proxy-hunt.js")];
    const hunt = require("../lib/proxy-hunt.js");
    assert.deepEqual(hunt.loadPool(), []);
    hunt.addToPool("socks5://127.0.0.1:1080");
    hunt.addToPool("127.0.0.1:1080");
    assert.deepEqual(hunt.loadPool(), ["socks5://127.0.0.1:1080"]);
    hunt.clearPool();
    assert.deepEqual(hunt.loadPool(), []);
  } finally {
    cleanup(env.dir);
  }
});
