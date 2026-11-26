const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeTempHome, cleanup } = require("./helpers.js");

test("egress block keys: ipv4 /32, ipv6 /64, mapped ipv4", () => {
  const env = makeTempHome();
  try {
    delete require.cache[require.resolve("../lib/egress.js")];
    const egress = require("../lib/egress.js");
    assert.equal(egress.blockKey("1.2.3.4"), "1.2.3.4/32");
    assert.equal(egress.blockKey("::ffff:1.2.3.4"), "1.2.3.4/32");
    assert.equal(egress.blockKey("2001:db8:abcd:12::1"), "2001:db8:abcd:12::/64");
    assert.equal(egress.blockKey("2001:db8:abcd:12::99"), "2001:db8:abcd:12::/64");
    assert.equal(egress.sameBlock("2001:db8:abcd:12::1", "2001:db8:abcd:12::99"), true);
    assert.equal(egress.sameBlock("1.2.3.4", "1.2.3.5"), false);
    assert.equal(egress.blockKey(""), "");
    assert.equal(egress.blockKey("not-an-ip"), "");
  } finally {
    cleanup(env.dir);
  }
});

test("egress record/check/show lifecycle with UTC reset", () => {
  const env = makeTempHome();
  try {
    delete require.cache[require.resolve("../lib/egress.js")];
    const egress = require("../lib/egress.js");
    assert.equal(egress.check({ ip: "9.9.9.9" }).known, false);
    egress.record({ ip: "9.9.9.9", status: 200, country: "de" });
    egress.record({ ip: "9.9.9.9", status: 429, retryAfter: 3600 });
    const state = egress.check({ ip: "9.9.9.9" });
    assert.equal(state.spent, true);
    assert.equal(state.country, "DE");
    assert.equal(state.open, 1);
    assert.equal(state.refused, 1);
    const shown = egress.show();
    assert.equal(shown.total, 1);
    assert.equal(shown.spent, 1);
    assert.ok(shown.secondsToReset >= 0);
    assert.ok(new Date(shown.nextResetUtc).getUTCHours() === 0);
    egress.clear();
    assert.equal(egress.show().total, 0);
  } finally {
    cleanup(env.dir);
  }
});
