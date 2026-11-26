const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeTempHome, cleanup } = require("./helpers.js");

test("log-watch classifies limit lines and ignores command text", () => {
  const env = makeTempHome();
  try {
    delete require.cache[require.resolve("../lib/log-watch.js")];
    const logWatch = require("../lib/log-watch.js");
    const rotate = 'timestamp=2026-01-01T00:00:00Z level=ERROR run=abc123 message="Free usage limit reached"';
    const ask = 'timestamp=2026-01-01T00:00:00Z level=ERROR run=def456 message="429 Too Many Requests"';
    const noop = 'timestamp=2026-01-01T00:00:00Z level=ERROR run=ghi789 message="something else broke"';
    const commandText = 'timestamp=2026-01-01T00:00:00Z level=INFO run=jkl012 message="user typed Free usage limit reached"';
    assert.equal(logWatch.classify(rotate), "rotate");
    assert.equal(logWatch.classify(ask), "ask");
    assert.equal(logWatch.classify(noop), "noop");
    const parsed = logWatch.parseLines([rotate, ask, noop, commandText].join("\n"));
    assert.equal(parsed.counts.rotate, 1);
    assert.equal(parsed.counts.ask, 1);
    assert.equal(parsed.counts.noop, 1);
    assert.equal(parsed.events.length, 2);
    assert.equal(parsed.events[0].run, "abc123");
  } finally {
    cleanup(env.dir);
  }
});

test("log-watch scan is incremental and picks the newest log", () => {
  const env = makeTempHome();
  try {
    delete require.cache[require.resolve("../lib/log-watch.js")];
    const logWatch = require("../lib/log-watch.js");
    const dir = path.join(env.dir, "logs");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "opencode.log");
    fs.writeFileSync(file, 'timestamp=2026-01-01T00:00:00Z level=ERROR run=aaa message="Free usage limit reached"\n', "utf8");
    // First scan starts at the end of the log by design; --all rescans the backlog.
    const first = logWatch.scan({ dir, reset: true });
    assert.equal(first.counts.rotate, 1);
    const second = logWatch.scan({ dir });
    assert.equal(second.counts.rotate, 0, "second scan must not replay old lines");
    fs.appendFileSync(file, 'timestamp=2026-01-01T00:01:00Z level=ERROR run=bbb message="Free usage limit reached"\n', "utf8");
    const third = logWatch.scan({ dir });
    assert.equal(third.counts.rotate, 1);
    assert.equal(third.events[0].run, "bbb");
  } finally {
    cleanup(env.dir);
  }
});
