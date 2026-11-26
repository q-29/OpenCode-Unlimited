const { execFileSync } = require("node:child_process");
const { existsSync, readFileSync, statSync, writeFileSync, accessSync, constants } = require("node:fs");
const { dirname, join, delimiter } = require("node:path");
const { homeDir, configDir, dataDirs, ensureDir } = require("./paths.js");

const DEFAULT_BASE = "https://opencode.ai/inference/openai/v1";
const DEFAULT_MODEL = "deepseek-v4.1-flash-free";
const INFO_FILE = "unlimited-info.json";
const CACHE_TTL = Number(process.env.OPENCODE_UNLIMITED_INFO_TTL || 300) * 1000;
const CALL_TIMEOUT = Number(process.env.OPENCODE_UNLIMITED_INFO_TIMEOUT || 25000);
const AGGREGATE_COLUMNS = ["aggregate_id", "aggregateId", "aggregate"];

function findDatabase(explicit) {
  const names = ["opencode.db", "opencode.sqlite", "db.sqlite"];
  const dirs = explicit ? [explicit] : dataDirs();
  for (const dir of dirs) {
    if (!dir) continue;
    try {
      if (existsSync(dir) && statSync(dir).isFile()) return dir;
    } catch {
      continue;
    }
    for (const name of names) {
      const file = join(dir, name);
      if (existsSync(file)) return file;
    }
  }
  return null;
}

function isExecutableFile(filePath) {
  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
    if (process.platform !== "win32") {
      accessSync(filePath, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function exeCandidates() {
  const out = [];
  for (const name of ["OPENCODE_BIN", "OPENCODE_BINARY", "OPENCODE_PATH"]) {
    const value = process.env[name];
    if (value) out.push(value);
  }
  const envPath = process.env.PATH || "";
  const binNames = process.platform === "win32"
    ? ["opencode.exe", "opencode.cmd", "opencode.bat", "opencode"]
    : ["opencode"];

  for (const dir of envPath.split(delimiter)) {
    if (!dir) continue;
    for (const file of binNames) {
      const candidate = join(dir, file);
      if (isExecutableFile(candidate)) out.push(candidate);
    }
  }

  const home = homeDir();
  const extra = [
    "/opt/homebrew/bin/opencode",
    "/usr/local/bin/opencode",
    join(home, ".opencode", "bin", "opencode"),
    join(home, ".bun", "bin", "opencode"),
    join(home, ".local", "bin", "opencode"),
    join(home, "bin", "opencode"),
    "/Applications/OpenCode.app/Contents/MacOS/opencode",
    "/Applications/OpenCode.app/Contents/Resources/bin/opencode",
    join(home, "Applications", "OpenCode.app", "Contents", "MacOS", "opencode"),
  ];

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || "";
    const local = process.env.LOCALAPPDATA || "";
    extra.push(
      appData && join(appData, "npm", "node_modules", "@opencode", "cli", "bin", "opencode.exe"),
      appData && join(appData, "npm", "opencode.exe"),
      appData && join(appData, "npm", "opencode.cmd"),
      local && join(local, "Programs", "opencode", "opencode.exe"),
      join(home, ".opencode", "bin", "opencode.exe"),
      join(home, ".bun", "bin", "opencode.exe"),
      join(home, "scoop", "shims", "opencode.exe"),
      "C:\\ProgramData\\chocolatey\\bin\\opencode.exe",
      "C:\\Program Files\\opencode\\opencode.exe",
    );
  }

  for (const entry of extra) {
    if (entry && isExecutableFile(entry)) out.push(entry);
  }
  return [...new Set(out)];
}

function findExe() {
  const list = exeCandidates();
  if (process.platform === "win32") {
    const exe = list.find((entry) => /\.exe$/i.test(entry));
    return exe || list[0] || "opencode";
  }
  return list[0] || "opencode";
}

function run(file, args, timeout) {
  const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(file);
  try {
    const out = execFileSync(file, args, {
      timeout: timeout || CALL_TIMEOUT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      shell: useShell,
    });
    return String(out || "").trim();
  } catch (error) {
    const stdout = error && error.stdout ? String(error.stdout) : "";
    return stdout.trim();
  }
}

function apiJson(exe, endpoint, timeout) {
  const raw = run(exe, ["api", "get", endpoint], timeout);
  if (!raw) return null;
  const start = raw.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(raw.slice(start));
  } catch {
    return null;
  }
}

function parseVersion(text) {
  const match = String(text || "").match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    raw: match[0],
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function packageVersion(exe) {
  let dir = dirname(exe);
  for (let depth = 0; depth < 6; depth++) {
    const file = join(dir, "package.json");
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
        if (parsed && typeof parsed.version === "string") return parsed.version;
      } catch {
        void 0;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function detectVersion(exe) {
  const direct = parseVersion(run(exe, ["--version"], 15000));
  if (direct) return direct;
  const info = apiJson(exe, "/api/info", 5000);
  const fromApi = parseVersion(info && info.version);
  if (fromApi) return fromApi;
  return parseVersion(packageVersion(exe));
}

function detectService(exe) {
  const info = apiJson(exe, "/api/info", 5000);
  if (!info || !info.version) return { running: false, url: "", pid: 0, version: "" };
  const urls = Array.isArray(info.urls) ? info.urls : [];
  return {
    running: true,
    url: urls.length ? String(urls[0]) : "",
    pid: Number(info.pid) || 0,
    version: String(info.version || ""),
  };
}

function detectProvider(exe) {
  const payload = apiJson(exe, "/api/provider", 10000);
  const list = payload && Array.isArray(payload.data) ? payload.data : [];
  const isOpencode = (item) => item && (item.id === "opencode" || item.integrationID === "opencode");
  const hostMatch = (item) => {
    const base = item && item.settings && typeof item.settings.baseURL === "string" ? item.settings.baseURL : "";
    return base.includes("opencode.ai");
  };
  const hit = list.find(isOpencode) || list.find(hostMatch);
  if (!hit) return { id: "", baseURL: "", orgId: "" };
  const base = hit.settings && typeof hit.settings.baseURL === "string" ? hit.settings.baseURL.replace(/\/+$/, "") : "";
  const headers = hit.headers && typeof hit.headers === "object" ? hit.headers : {};
  const key = Object.keys(headers).find((name) => name.toLowerCase() === "x-opencode-org-id");
  return { id: String(hit.id || ""), baseURL: base, orgId: key ? String(headers[key]) : "" };
}

function detectModels(exe) {
  const payload = apiJson(exe, "/api/model", 10000);
  const list = payload && Array.isArray(payload.data) ? payload.data : [];
  const rows = [];
  for (const item of list) {
    if (!item || item.providerID !== "opencode") continue;
    const cost = Array.isArray(item.cost) ? item.cost[0] : item.cost;
    const free = cost && Number(cost.input) === 0 && Number(cost.output) === 0;
    rows.push({
      id: String(item.modelID || item.id || ""),
      name: String(item.name || ""),
      free: Boolean(free),
      released: Number(item.time && item.time.released) || 0,
    });
  }
  rows.sort((a, b) => b.released - a.released);
  return rows.filter((row) => row.id);
}

function detectApiVersion(version) {
  const file = join(configDir(), "cli.json");
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
      const match = String(parsed && parsed.$schema ? parsed.$schema : "").match(/\/v(\d+)\//);
      if (match) return Number(match[1]);
    } catch {
      void 0;
    }
  }
  return version ? version.major : 0;
}

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function tableNames(db) {
  return db
    .prepare("select name from sqlite_master where type = 'table'")
    .all()
    .map((row) => String(row.name))
    .filter((name) => !name.startsWith("sqlite_"));
}

function columnsOf(db, table) {
  return db
    .prepare("pragma table_info(" + quoteIdent(table) + ")")
    .all()
    .map((row) => String(row.name));
}

function likeClause(column, prefix) {
  const escaped = String(prefix).replace(/([_%!])/g, "!$1");
  return quoteIdent(column) + " like '" + escaped + "%' escape '!'";
}

function columnIndexed(db, table, column) {
  try {
    const indexes = db.prepare("pragma index_list(" + quoteIdent(table) + ")").all();
    for (const index of indexes) {
      const name = String(index.name || "");
      if (!name) continue;
      const cols = db.prepare("pragma index_info(" + quoteIdent(name) + ")").all().map((row) => String(row.name));
      if (cols.includes(column)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function probeColumn(db, table, column, prefix, allowScan) {
  try {
    const sql = "select " + quoteIdent(column) + " from " + quoteIdent(table) + " where " + likeClause(column, prefix) + " limit 1";
    const plan = db.prepare("explain query plan " + sql).all();
    const scans = plan.some((row) => String(row.detail || "").toUpperCase().includes("SCAN"));
    if (scans && !allowScan && !columnIndexed(db, table, column)) return { hit: false, scans, skipped: true };
    const hit = db.prepare(sql).all().length > 0;
    return { hit, scans };
  } catch {
    return { hit: false, scans: true };
  }
}

function detectSchema(db, options) {
  const deep = Boolean(options && options.deep);
  const names = tableNames(db);
  const priority = ["session_v2", "session", "sessions", "session_v1"];
  const candidates = [];
  for (const name of names) {
    if (!deep && !/session/i.test(name) && !priority.includes(name)) continue;
    const columns = columnsOf(db, name);
    if (!columns.includes("id")) continue;
    const probe = probeColumn(db, name, "id", "ses_", true);
    // Also accept canonical priority tables when empty (0 rows yet) if they look like a session table
    const looksCanonical =
      priority.includes(name) &&
      (columns.includes("directory") || columns.includes("project_id") || columns.includes("title"));
    if (!probe.hit && !looksCanonical) continue;
    candidates.push({
      name,
      columns,
      hasRows: probe.hit,
      scans: probe.scans,
      rank: priority.includes(name) ? priority.indexOf(name) : priority.length,
    });
  }
  candidates.sort((a, b) => Number(b.hasRows) - Number(a.hasRows) || a.rank - b.rank || a.columns.length - b.columns.length);
  const session = candidates[0] || null;
  const columns = session ? session.columns : [];
  const pick = (list) => list.find((name) => columns.includes(name)) || null;
  const refs = [];
  let sequence = null;
  if (session && deep) {
    for (const name of names) {
      if (name === session.name) continue;
      const cols = columnsOf(db, name);
      const column = ["session_id", "sessionID", "sessionId", "session"].find((c) => cols.includes(c));
      if (!column) continue;
      refs.push({ table: name, column });
    }
    const probes = db
      .prepare("select id from " + quoteIdent(session.name) + " limit 3")
      .all()
      .map((row) => String(row.id));
    for (const name of names) {
      if (name === session.name || refs.some((ref) => ref.table === name)) continue;
      const info = db.prepare("pragma table_info(" + quoteIdent(name) + ")").all();
      const column = AGGREGATE_COLUMNS.find((candidate) => info.some((field) => String(field.name) === candidate));
      if (!column) continue;
      const primary = info.some((field) => String(field.name) === column && Number(field.pk) > 0);
      const seqColumn = info.some((field) => String(field.name) === "seq") ? "seq" : null;
      const hit = probes.length
        ? probes.some((value) =>
            db.prepare("select 1 from " + quoteIdent(name) + " where " + quoteIdent(column) + " = ? limit 1").get(value),
          )
        : Boolean(primary && seqColumn);
      if (!hit) continue;
      refs.push({ table: name, column, aggregate: true });
      if (primary && seqColumn) sequence = { table: name, column, seqColumn };
    }
  }
  return {
    sessionTable: session ? session.name : null,
    idColumn: "id",
    titleColumn: pick(["title", "name", "summary"]),
    timeColumn: pick(["time_updated", "updated_at", "time_created", "created_at"]),
    projectColumn: pick(["project_id", "projectID"]),
    directoryColumn: pick(["directory", "dir", "path"]),
    forkColumns: ["parent_id", "fork_session_id", "fork_boundary", "parentID", "forkID"].filter((name) => columns.includes(name)),
    refs,
    sequence,
    alternatives: candidates.map((item) => item.name),
  };
}

function openReadOnly(file) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("pragma busy_timeout = 5000");
  } catch {
    void 0;
  }
  return db;
}

function buildInfo(options) {
  const exe = findExe();
  const hasExe = exe && exe !== "opencode" ? existsSync(exe) : Boolean(exeCandidates().length);
  const version = hasExe ? detectVersion(exe) : null;
  const service = hasExe ? detectService(exe) : { running: false, url: "", pid: 0, version: "" };
  const provider = hasExe && service.running ? detectProvider(exe) : { id: "", baseURL: "", orgId: "" };
  const models = hasExe && service.running ? detectModels(exe) : [];
  const free = models.filter((row) => row.free).map((row) => row.id);
  const dbPath = findDatabase(options && options.db);
  let schema = null;
  if (dbPath) {
    let db = null;
    try {
      db = openReadOnly(dbPath);
      schema = detectSchema(db, { deep: false });
    } catch {
      schema = null;
    } finally {
      if (db) {
        try {
          db.close();
        } catch {
          void 0;
        }
      }
    }
  }
  const baseURL = provider.baseURL || DEFAULT_BASE;
  const preferred = free.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : free[0] || DEFAULT_MODEL;
  const dirs = dataDirs();
  return {
    exe,
    version: version ? version.raw : "",
    versionRaw: version ? version.raw : "",
    major: version ? version.major : 0,
    minor: version ? version.minor : 0,
    patch: version ? version.patch : 0,
    api: detectApiVersion(version),
    service,
    baseURL,
    gateway: baseURL + "/chat/completions",
    orgId: provider.orgId,
    providerId: provider.id,
    dbPath: dbPath || "",
    dataDir: dbPath ? dirname(dbPath) : dirs[0] || "",
    configDir: configDir(),
    models,
    freeModels: free,
    freeModel: preferred,
    modelCount: models.length,
    schema,
    detectedAt: Date.now(),
  };
}

function infoFile() {
  return join(configDir(), INFO_FILE);
}

function info(options) {
  const force = Boolean(options && options.refresh);
  const file = infoFile();
  if (!force && existsSync(file)) {
    try {
      const stat = statSync(file);
      const cached = JSON.parse(readFileSync(file, "utf8"));
      const age = Date.now() - Number(cached.detectedAt || 0);
      const exe = findExe();
      const fresh = age >= 0 && age < CACHE_TTL && cached.exe === exe && stat.size > 0;
      if (fresh) return cached;
    } catch {
      void 0;
    }
  }
  const built = buildInfo(options);
  try {
    ensureDir(dirname(file));
    writeFileSync(file, JSON.stringify(built, null, 2) + "\n", "utf8");
  } catch {
    void 0;
  }
  return built;
}

function messageTableOf(db) {
  const names = tableNames(db);
  for (const name of ["session_message", "message", "messages"]) {
    if (!names.includes(name)) continue;
    const cols = columnsOf(db, name);
    if (cols.includes("session_id")) return name;
  }
  return null;
}

function weightsBySession(db, table) {
  const out = new Map();
  if (!table) return out;
  try {
    const rows = db
      .prepare("select session_id as sid, count(*) as n, sum(length(cast(data as text))) as bytes from " + quoteIdent(table) + " group by session_id")
      .all();
    for (const row of rows) {
      out.set(String(row.sid), { messages: Number(row.n) || 0, bytes: Number(row.bytes) || 0 });
    }
  } catch {
    void 0;
  }
  return out;
}

function listSessions(dbPath, filter) {
  const db = openReadOnly(dbPath);
  try {
    const schema = detectSchema(db, { deep: false });
    if (!schema.sessionTable) return [];
    const table = quoteIdent(schema.sessionTable);
    const select = ["id"];
    if (schema.titleColumn) select.push(quoteIdent(schema.titleColumn) + " as title");
    if (schema.directoryColumn) select.push(quoteIdent(schema.directoryColumn) + " as directory");
    const time = schema.timeColumn ? quoteIdent(schema.timeColumn) : null;
    if (time) select.push(time + " as updated");
    const order = time ? " order by " + time + " desc" : "";
    const rows = db.prepare("select " + select.join(", ") + " from " + table + order + " limit 400").all();
    const weights = weightsBySession(db, messageTableOf(db));
    let resolvedFilter = filter || "";
    if (resolvedFilter) {
      try {
        const fs = require("node:fs");
        if (fs.existsSync(resolvedFilter)) resolvedFilter = fs.realpathSync(resolvedFilter);
      } catch {
        void 0;
      }
    }
    const want = resolvedFilter ? String(resolvedFilter).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() : "";
    const out = [];
    for (const row of rows) {
      const directory = row.directory ? String(row.directory) : "";
      if (want) {
        const value = directory.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
        if (value !== want && !value.startsWith(want + "/")) continue;
      }
      const weight = weights.get(String(row.id)) || { messages: 0, bytes: 0 };
      out.push({
        id: String(row.id),
        title: row.title ? String(row.title) : "",
        directory,
        updated: Number(row.updated) || 0,
        messages: weight.messages,
        bytes: weight.bytes,
      });
    }
    return out;
  } finally {
    db.close();
  }
}

function main() {
  const [action, extra] = process.argv.slice(2);
  if (!action || action === "info") {
    const refresh = extra === "--refresh" || extra === "-Refresh";
    console.log(JSON.stringify(info({ refresh })));
    return;
  }
  if (action === "schema") {
    const payload = info();
    console.log(JSON.stringify(payload.schema, null, 2));
    return;
  }
  if (action === "list") {
    const dbPath = findDatabase();
    if (!dbPath) {
      console.log(JSON.stringify({ error: "no database found" }));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(listSessions(dbPath, extra), null, 2));
    return;
  }
  console.log(JSON.stringify({ error: "unknown action: " + action }));
  process.exitCode = 2;
}

if (require.main === module) main();

module.exports = {
  findDatabase,
  findExe,
  exeCandidates,
  detectSchema,
  listSessions,
  quoteIdent,
  columnsOf,
  tableNames,
  info,
  infoFile,
  configDir,
  dataDirs,
};
