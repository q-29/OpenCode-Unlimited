const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { makeTempHome, cleanup } = require("./helpers.js");

const CLI = path.join(__dirname, "..", "bin", "opencode-unlimited");

function runCli(env, args, options = {}) {
  const result = spawnSync(options.cli || CLI, args, {
    encoding: "utf8",
    timeout: 30000,
    env: {
      ...process.env,
      OPENCODE_TEST_HOME: env.dir,
      OPENCODE_CONFIG_HOME: env.configHome,
      OPENCODE_DATA_HOME: env.dataHome,
      OPENCODE_CACHE_HOME: env.cacheHome,
      OPENCODE_UNLIMITED_LAUNCHAGENTS_DIR: env.launchAgents,
      HOME: env.dir,
    },
  });
  return { status: result.status, stdout: String(result.stdout || ""), stderr: String(result.stderr || "") };
}

test("cli help and version respond", () => {
  const env = makeTempHome();
  try {
    const help = runCli(env, ["help"]);
    assert.equal(help.status, 0);
    assert.ok(help.stdout.includes("opencode-unlimited <command>"));
    assert.ok(help.stdout.includes("hunt"));
    assert.ok(help.stdout.includes("watch"));
    const version = runCli(env, ["version"]);
    assert.equal(version.status, 0);
    assert.ok(version.stdout.includes("tool"));
    const unknown = runCli(env, ["nope"]);
    assert.equal(unknown.status, 2);
  } finally {
    cleanup(env.dir);
  }
});

test("cli identity rotate/show/restore round-trips in a temp home", () => {
  const env = makeTempHome();
  try {
    const rotated = runCli(env, ["identity", "rotate"]);
    assert.equal(rotated.status, 0, rotated.stderr);
    assert.ok(rotated.stdout.includes("project id"));
    const shown = runCli(env, ["identity"]);
    assert.equal(shown.status, 0);
    assert.ok(shown.stdout.includes("projectId"));
    const restored = runCli(env, ["identity", "restore"]);
    assert.equal(restored.status, 0);
    assert.ok(restored.stdout.includes("removed"));
  } finally {
    cleanup(env.dir);
  }
});

test("cli block/usage/proxy pool work without a database", () => {
  const env = makeTempHome();
  try {
    const block = runCli(env, ["block"]);
    assert.equal(block.status, 0, block.stderr);
    assert.ok(block.stdout.includes("egress blocks"));
    const usage = runCli(env, ["usage"]);
    assert.equal(usage.status, 0, usage.stderr);
    assert.ok(usage.stdout.includes("reset at"));
    const pool = runCli(env, ["proxy", "pool"]);
    assert.equal(pool.status, 0);
    assert.ok(pool.stdout.includes("proxies"));
    const added = runCli(env, ["proxy", "pool", "add", "socks5://127.0.0.1:1080"]);
    assert.equal(added.status, 0, added.stderr);
    assert.ok(added.stdout.includes("pool: 1 proxies"));
    const listed = runCli(env, ["proxy", "pool"]);
    assert.ok(listed.stdout.includes("127.0.0.1"));
    const cleared = runCli(env, ["proxy", "pool", "clear"]);
    assert.equal(cleared.status, 0);
    const empty = runCli(env, ["proxy", "pool"]);
    assert.ok(empty.stdout.includes(": 0 proxies"));
  } finally {
    cleanup(env.dir);
  }
});

test("cli resolves lib/ through a symlink (macOS /usr/local/bin style)", () => {
  const env = makeTempHome();
  try {
    const linkDir = path.join(env.dir, "bin");
    fs.mkdirSync(linkDir, { recursive: true });
    const link = path.join(linkDir, "opencode-unlimited");
    fs.symlinkSync(CLI, link);
    const result = runCli(env, ["help"], { cli: link });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes("opencode-unlimited <command>"));
  } finally {
    cleanup(env.dir);
  }
});

test("cli doctor runs and reports platform", () => {
  const env = makeTempHome();
  try {
    const result = runCli(env, ["doctor"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes("platform"));
    assert.ok(result.stdout.includes("node"));
  } finally {
    cleanup(env.dir);
  }
});
