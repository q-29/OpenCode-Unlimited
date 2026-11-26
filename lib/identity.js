const { randomUUID, randomBytes, createHash } = require("node:crypto");
const { readFileSync, writeFileSync, existsSync, unlinkSync } = require("node:fs");
const { join, dirname } = require("node:path");
const { configDir, appStateDir, homeDir, ensureDir } = require("./paths.js");

function stateFile() {
  return join(configDir(), "unlimited-identity.json");
}

function shieldIdentityFile() {
  return process.env.OPENCODE_UNLIMITED_IDENTITY || join(configDir(), "identity.json");
}

function legacyIdentityFile() {
  return join(homeDir(), ".opencode", "identity.json");
}

function shimDir() {
  return join(appStateDir(), "shim");
}

function shimGuidFile() {
  return join(shimDir(), "machine-guid.txt");
}

function newGuid() {
  return randomUUID().toLowerCase();
}

function newProjectId() {
  return randomBytes(20).toString("hex");
}

function fingerprint(guid) {
  return createHash("sha256").update(String(guid)).digest("hex").slice(0, 16);
}

function load() {
  const sf = stateFile();
  if (existsSync(sf)) {
    try {
      const parsed = JSON.parse(readFileSync(sf, "utf8"));
      if (parsed && parsed.deviceId) return parsed;
    } catch {
      void 0;
    }
  }
  const shf = shieldIdentityFile();
  if (existsSync(shf)) {
    try {
      const parsed = JSON.parse(readFileSync(shf, "utf8"));
      if (parsed && parsed.projectId) {
        return {
          deviceId: parsed.deviceId || newGuid(),
          projectId: parsed.projectId,
          directory: parsed.directory || join(homeDir(), "dev", "workspace-" + randomBytes(4).toString("hex")),
          generation: 1,
          createdAt: parsed.createdAt || new Date().toISOString(),
          rotatedAt: parsed.createdAt || new Date().toISOString(),
          history: [],
        };
      }
    } catch {
      void 0;
    }
  }
  return null;
}

function save(state) {
  const sf = stateFile();
  ensureDir(dirname(sf));
  writeFileSync(sf, JSON.stringify(state, null, 2) + "\n", "utf8");

  const sd = shimDir();
  ensureDir(sd);
  writeFileSync(shimGuidFile(), state.deviceId + "\n", "utf8");

  // Keep shield plugin's identity.json in sync so x-opencode-project rotates on the wire
  const projectId = /^[0-9a-f]{40}$/i.test(state.projectId || "") ? state.projectId.toLowerCase() : newProjectId();
  const directory = state.directory || join(homeDir(), "dev", "workspace-" + randomBytes(4).toString("hex"));
  const shieldPayload = {
    projectId,
    deviceId: state.deviceId,
    clientId: "cli",
    directory,
    createdAt: state.rotatedAt || state.createdAt || new Date().toISOString(),
  };
  const shieldJson = JSON.stringify(shieldPayload, null, 2) + "\n";
  const shf = shieldIdentityFile();
  ensureDir(dirname(shf));
  writeFileSync(shf, shieldJson, "utf8");

  const legacy = legacyIdentityFile();
  if (existsSync(dirname(legacy))) {
    writeFileSync(legacy, shieldJson, "utf8");
  }

  state.projectId = projectId;
  state.directory = directory;
  return state;
}

function show() {
  const state = load();
  if (!state) {
    return {
      exists: false,
      stateFile: stateFile(),
      identityFile: shieldIdentityFile(),
      shimFile: shimGuidFile(),
      hint: "run identity rotate to mint one",
    };
  }
  return {
    exists: true,
    stateFile: stateFile(),
    identityFile: shieldIdentityFile(),
    shimFile: shimGuidFile(),
    deviceId: state.deviceId,
    projectId: state.projectId || "",
    directory: state.directory || "",
    fingerprint: fingerprint(state.deviceId),
    generation: Number(state.generation || 0),
    createdAt: state.createdAt || "",
    rotatedAt: state.rotatedAt || "",
    registryTouched: false,
  };
}

function rotate(options = {}) {
  const previous = load();
  const now = new Date().toISOString();
  const deviceId = options.deviceId || newGuid();
  const projectId =
    options.projectId && /^[0-9a-f]{40}$/i.test(options.projectId)
      ? options.projectId.toLowerCase()
      : newProjectId();
  const directory = options.directory || join(homeDir(), "dev", "workspace-" + randomBytes(4).toString("hex"));

  const state = {
    deviceId,
    projectId,
    directory,
    generation: previous ? Number(previous.generation || 0) + 1 : 1,
    createdAt: (previous && previous.createdAt) || now,
    rotatedAt: now,
    history: [
      ...((previous && Array.isArray(previous.history)) ? previous.history : []).slice(-19),
      previous && previous.deviceId
        ? { deviceId: previous.deviceId, projectId: previous.projectId || "", retiredAt: now }
        : null,
    ].filter(Boolean),
  };
  save(state);
  return {
    deviceId,
    projectId,
    directory,
    previous: previous ? previous.deviceId || "" : "",
    previousProjectId: previous ? previous.projectId || "" : "",
    generation: state.generation,
    fingerprint: fingerprint(deviceId),
    stateFile: stateFile(),
    identityFile: shieldIdentityFile(),
    shimFile: shimGuidFile(),
    registryTouched: false,
  };
}

function restore() {
  const sf = stateFile();
  const shf = shieldIdentityFile();
  const sgf = shimGuidFile();
  const legacy = legacyIdentityFile();
  const hadAny = existsSync(sf) || existsSync(shf) || existsSync(sgf);
  for (const f of [sgf, sf, shf, legacy]) {
    if (existsSync(f)) {
      try {
        unlinkSync(f);
      } catch {
        void 0;
      }
    }
  }
  if (!hadAny) {
    return { restored: false, reason: "no identity state", stateFile: sf, shimFile: sgf, registryTouched: false };
  }
  return { restored: true, removed: sgf, stateFile: sf, identityFile: shf, registryTouched: false };
}

function main() {
  const [action, arg] = process.argv.slice(2);
  try {
    if (!action || action === "show") {
      console.log(JSON.stringify(show(), null, 2));
      return;
    }
    if (action === "rotate") {
      console.log(JSON.stringify(rotate({ deviceId: arg || "" }), null, 2));
      return;
    }
    if (action === "restore") {
      console.log(JSON.stringify(restore(), null, 2));
      return;
    }
    if (action === "fingerprint") {
      const state = load();
      console.log(JSON.stringify({ fingerprint: state ? fingerprint(state.deviceId) : "" }));
      return;
    }
    console.log(JSON.stringify({ error: "unknown action: " + action }));
    process.exitCode = 2;
  } catch (error) {
    console.log(JSON.stringify({ error: String(error && error.message ? error.message : error) }));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  load,
  show,
  rotate,
  restore,
  fingerprint,
  stateFile,
  shieldIdentityFile,
  shimDir,
  shimGuidFile,
};
