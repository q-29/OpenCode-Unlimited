const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const { configDir, launchAgentsDir, ensureDir } = require("./paths.js");
const logWatch = require("./log-watch.js");

const LABEL = "ai.opencode.unlimited.watch";
const PLIST_NAME = LABEL + ".plist";
const MAX_ROTATIONS = 5;
const WINDOW_MS = 30 * 60000;
const DEFAULT_INTERVAL_MS = 2000;

function pidFile() {
  return join(configDir(), "unlimited-watch.pid");
}

function logFile() {
  return join(configDir(), "unlimited-watch.log");
}

function stateFile() {
  return join(configDir(), "unlimited-watch-state.json");
}

function join(...parts) {
  return path.join(...parts);
}

function plistPath() {
  return join(launchAgentsDir(), PLIST_NAME);
}

function loadState() {
  const file = stateFile();
  if (!fs.existsSync(file)) return { rotations: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return { rotations: Array.isArray(raw.rotations) ? raw.rotations.filter((n) => Number.isFinite(Number(n))) : [] };
  } catch {
    return { rotations: [] };
  }
}

function saveState(state) {
  const file = stateFile();
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function rotationsInWindow(now) {
  const cutoff = Number(now || Date.now()) - WINDOW_MS;
  return loadState().rotations.filter((at) => Number(at) >= cutoff);
}

function canRotate(now) {
  return rotationsInWindow(now).length < MAX_ROTATIONS;
}

function recordRotation(now) {
  const at = Number(now || Date.now());
  const state = loadState();
  state.rotations = [...state.rotations.filter((value) => value >= at - WINDOW_MS), at];
  saveState(state);
  return state.rotations.length;
}

function isRunning() {
  const file = pidFile();
  if (!fs.existsSync(file)) return { running: false, pid: 0 };
  const pid = Number(String(fs.readFileSync(file, "utf8")).trim());
  if (!Number.isInteger(pid) || pid <= 0) return { running: false, pid: 0 };
  try {
    process.kill(pid, 0);
    return { running: true, pid };
  } catch {
    return { running: false, pid };
  }
}

function writePid(pid) {
  const file = pidFile();
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, String(pid) + "\n", "utf8");
}

function clearPid() {
  const file = pidFile();
  if (fs.existsSync(file)) {
    try {
      fs.unlinkSync(file);
    } catch {
      void 0;
    }
  }
}

function appendLog(line) {
  const file = logFile();
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, new Date().toISOString() + " " + line + "\n", "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runDaemon(options = {}) {
  const intervalMs = Number(options.intervalMs || DEFAULT_INTERVAL_MS);
  const onRotate = typeof options.onRotate === "function" ? options.onRotate : async () => ({});
  const log = typeof options.log === "function" ? options.log : appendLog;
  writePid(process.pid);
  log("watcher started pid=" + process.pid + " interval=" + intervalMs + "ms");
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    while (!stopping) {
      let scan;
      try {
        scan = logWatch.scan(options.scan || {});
      } catch (error) {
        log("scan failed: " + String((error && error.message) || error));
        await sleep(intervalMs);
        continue;
      }
      const rotates = (scan.events || []).filter((event) => event.kind === "rotate");
      for (const event of rotates) {
        if (!canRotate()) {
          log("rotate capped at " + MAX_ROTATIONS + " per 30m, skipping run=" + (event.run || ""));
          continue;
        }
        try {
          const result = await onRotate(event, scan);
          recordRotation();
          log("rotated run=" + (event.run || "") + " result=" + JSON.stringify(result).slice(0, 200));
        } catch (error) {
          log("rotate failed: " + String((error && error.message) || error));
        }
      }
      await sleep(intervalMs);
    }
  } finally {
    clearPid();
    log("watcher stopped");
  }
  return { stopped: true };
}

function startBackground(options = {}) {
  const current = isRunning();
  if (current.running) return { started: false, pid: current.pid, reason: "already running" };
  const cliPath = options.cliPath;
  if (!cliPath || !fs.existsSync(cliPath)) throw new Error("cliPath is required to start the watcher");
  const log = logFile();
  ensureDir(path.dirname(log));
  const child = spawn(process.execPath, [cliPath, "watch", "--follow", "--auto", "--background"], {
    detached: true,
    stdio: ["ignore", fs.openSync(log, "a"), fs.openSync(log, "a")],
  });
  child.unref();
  writePid(child.pid);
  return { started: true, pid: child.pid, log };
}

function stopBackground() {
  const current = isRunning();
  let stopped = false;
  if (current.running) {
    try {
      process.kill(current.pid, "SIGTERM");
      stopped = true;
    } catch {
      void 0;
    }
  }
  clearPid();
  return { stopped, pid: current.pid };
}

function plistContents(options = {}) {
  const cliPath = options.cliPath || "";
  const nodePath = options.nodePath || process.execPath;
  const keepAlive = options.keepAlive !== false;
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0">\n' +
    "<dict>\n" +
    "\t<key>Label</key>\n" +
    "\t<string>" + LABEL + "</string>\n" +
    "\t<key>ProgramArguments</key>\n" +
    "\t<array>\n" +
    "\t\t<string>" + nodePath + "</string>\n" +
    "\t\t<string>" + cliPath + "</string>\n" +
    "\t\t<string>watch</string>\n" +
    "\t\t<string>--follow</string>\n" +
    "\t\t<string>--auto</string>\n" +
    "\t\t<string>--background</string>\n" +
    "\t</array>\n" +
    "\t<key>RunAtLoad</key>\n" +
    "\t<true/>\n" +
    "\t<key>KeepAlive</key>\n" +
    "\t<" + (keepAlive ? "true" : "false") + "/>\n" +
    "\t<key>StandardOutPath</key>\n" +
    "\t<string>" + logFile() + "</string>\n" +
    "\t<key>StandardErrorPath</key>\n" +
    "\t<string>" + logFile() + "</string>\n" +
    "</dict>\n" +
    "</plist>\n"
  );
}

function launchctl(args) {
  return execFileSync("/bin/launchctl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function uid() {
  try {
    return Number(String(execFileSync("/usr/bin/id", ["-u"], { encoding: "utf8" })).trim());
  } catch {
    return 0;
  }
}

function isLoaded() {
  if (process.platform !== "darwin") return false;
  try {
    launchctl(["print", "gui/" + uid() + "/" + LABEL]);
    return true;
  } catch {
    return false;
  }
}

function installLaunchAgent(options = {}) {
  if (process.platform !== "darwin") {
    return { installed: false, reason: "launchd is macOS only", plist: plistPath() };
  }
  const file = plistPath();
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, plistContents(options), "utf8");
  const domain = "gui/" + uid();
  let loaded = false;
  let error = "";
  try {
    launchctl(["bootout", domain + "/" + LABEL]);
  } catch {
    void 0;
  }
  try {
    launchctl(["bootstrap", domain, file]);
    loaded = true;
  } catch (firstError) {
    error = String((firstError && firstError.message) || firstError);
    try {
      launchctl(["load", "-w", file]);
      loaded = true;
    } catch (secondError) {
      error = String((secondError && secondError.message) || secondError);
    }
  }
  return { installed: true, loaded, plist: file, label: LABEL, error };
}

function uninstallLaunchAgent() {
  const file = plistPath();
  if (process.platform !== "darwin") {
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch {
        void 0;
      }
    }
    return { removed: true, plist: file };
  }
  const domain = "gui/" + uid();
  try {
    launchctl(["bootout", domain + "/" + LABEL]);
  } catch {
    void 0;
  }
  try {
    launchctl(["unload", "-w", file]);
  } catch {
    void 0;
  }
  if (fs.existsSync(file)) {
    try {
      fs.unlinkSync(file);
    } catch {
      void 0;
    }
  }
  return { removed: true, plist: file, label: LABEL };
}

function main() {
  const [action] = process.argv.slice(2);
  (async () => {
    try {
      if (!action || action === "status") {
        console.log(JSON.stringify({ pid: isRunning(), loaded: isLoaded(), plist: plistPath(), log: logFile() }, null, 2));
        return;
      }
      if (action === "install") {
        console.log(JSON.stringify(installLaunchAgent({ cliPath: process.argv[3] || "" }), null, 2));
        return;
      }
      if (action === "uninstall") {
        console.log(JSON.stringify(uninstallLaunchAgent(), null, 2));
        return;
      }
      console.log(JSON.stringify({ error: "unknown action: " + action }));
      process.exitCode = 2;
    } catch (error) {
      console.log(JSON.stringify({ error: String((error && error.message) || error) }));
      process.exitCode = 1;
    }
  })();
}

if (require.main === module) main();

module.exports = {
  LABEL,
  PLIST_NAME,
  MAX_ROTATIONS,
  WINDOW_MS,
  pidFile,
  logFile,
  stateFile,
  plistPath,
  plistContents,
  rotationsInWindow,
  canRotate,
  recordRotation,
  isRunning,
  runDaemon,
  startBackground,
  stopBackground,
  installLaunchAgent,
  uninstallLaunchAgent,
  isLoaded,
};
