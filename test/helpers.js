const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function makeTempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ocu-test-"));
  const configHome = path.join(dir, "config");
  const dataHome = path.join(dir, "data");
  const cacheHome = path.join(dir, "cache");
  const launchAgents = path.join(dir, "Library", "LaunchAgents");
  fs.mkdirSync(configHome, { recursive: true });
  fs.mkdirSync(dataHome, { recursive: true });
  fs.mkdirSync(cacheHome, { recursive: true });
  fs.mkdirSync(launchAgents, { recursive: true });
  process.env.OPENCODE_TEST_HOME = dir;
  process.env.OPENCODE_CONFIG_HOME = configHome;
  process.env.OPENCODE_DATA_HOME = dataHome;
  process.env.OPENCODE_CACHE_HOME = cacheHome;
  process.env.OPENCODE_UNLIMITED_LAUNCHAGENTS_DIR = launchAgents;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_DATA_HOME;
  delete process.env.XDG_CACHE_HOME;
  return { dir, configHome, dataHome, cacheHome, launchAgents };
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    void 0;
  }
}

module.exports = { makeTempHome, cleanup };
