const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

function homeDir() {
  return process.env.OPENCODE_TEST_HOME || process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function configDir() {
  const explicit = process.env.OPENCODE_CONFIG_HOME || process.env.OPENCODE_CONFIG_DIR;
  if (explicit) return explicit;
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, "opencode");
  return path.join(homeDir(), ".config", "opencode");
}

function dataDirs() {
  const home = homeDir();
  const out = [];
  for (const name of ["OPENCODE_DATA_HOME", "OPENCODE_DATA_DIR"]) {
    if (process.env[name]) out.push(process.env[name]);
  }
  if (process.env.XDG_DATA_HOME) out.push(path.join(process.env.XDG_DATA_HOME, "opencode"));
  out.push(path.join(home, ".local", "share", "opencode"));
  out.push(path.join(home, "Library", "Application Support", "opencode"));
  if (process.env.LOCALAPPDATA) {
    out.push(path.join(process.env.LOCALAPPDATA, "opencode", "data"));
    out.push(path.join(process.env.LOCALAPPDATA, "opencode"));
  }
  return [...new Set(out.filter(Boolean))];
}

function primaryDataDir() {
  const dirs = dataDirs();
  for (const d of dirs) {
    if (fs.existsSync(d)) return d;
  }
  return dirs[0];
}

function cacheDirs() {
  const home = homeDir();
  const out = [];
  if (process.env.OPENCODE_CACHE_HOME) out.push(process.env.OPENCODE_CACHE_HOME);
  if (process.env.XDG_CACHE_HOME) out.push(path.join(process.env.XDG_CACHE_HOME, "opencode"));
  out.push(path.join(home, ".cache", "opencode"));
  out.push(path.join(home, "Library", "Caches", "opencode"));
  if (process.env.LOCALAPPDATA) out.push(path.join(process.env.LOCALAPPDATA, "opencode"));
  return [...new Set(out.filter(Boolean))];
}

function logDirs() {
  const home = homeDir();
  const out = [];
  if (process.env.OPENCODE_LOG_DIR) out.push(process.env.OPENCODE_LOG_DIR);
  if (process.env.XDG_STATE_HOME) out.push(path.join(process.env.XDG_STATE_HOME, "opencode", "log"));
  if (process.env.XDG_DATA_HOME) out.push(path.join(process.env.XDG_DATA_HOME, "opencode", "log"));
  out.push(path.join(home, ".local", "share", "opencode", "log"));
  out.push(path.join(home, "Library", "Logs", "opencode"));
  out.push(path.join(home, "Library", "Application Support", "opencode", "log"));
  if (process.env.LOCALAPPDATA) out.push(path.join(process.env.LOCALAPPDATA, "opencode", "log"));
  return [...new Set(out.filter(Boolean))];
}

function appStateDir() {
  if (process.env.OPENCODE_UNLIMITED_APP_DIR) return process.env.OPENCODE_UNLIMITED_APP_DIR;
  const home = homeDir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "opencode-unlimited");
  }
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return path.join(base, "opencode-unlimited");
  }
  const base = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(base, "opencode-unlimited");
}

function launchAgentsDir() {
  if (process.env.OPENCODE_UNLIMITED_LAUNCHAGENTS_DIR) {
    return process.env.OPENCODE_UNLIMITED_LAUNCHAGENTS_DIR;
  }
  return path.join(homeDir(), "Library", "LaunchAgents");
}

function ensureDir(dirPath) {
  if (dirPath && !fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

module.exports = {
  homeDir,
  configDir,
  dataDirs,
  primaryDataDir,
  cacheDirs,
  logDirs,
  appStateDir,
  launchAgentsDir,
  ensureDir,
};
