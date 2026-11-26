const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const { execFileSync } = require("node:child_process");
const { join, dirname } = require("node:path");
const { configDir, ensureDir } = require("./paths.js");
const proxyHealth = require("./proxy-health.js");
const egress = require("./egress.js");

const MAX_POOL = 200;
const LIST_TTL_MS = 6 * 3600000;
const DEFAULT_LIST_URL = "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt";
const TRACE_URL = "https://cloudflare.com/cdn-cgi/trace";

function poolFile() {
  return join(configDir(), "proxies.txt");
}

function cacheFile() {
  return join(configDir(), "unlimited-proxy-list.json");
}

function normalizeProxyUrl(value, defaultScheme) {
  let text = String(value || "").trim();
  if (!text || text.startsWith("#")) return "";
  // Strip trailing punctuation that often comes from pasted lists
  text = text.replace(/[,;]+$/, "");
  if (!text) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    const scheme = defaultScheme || "socks5";
    text = scheme + "://" + text;
  }
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return "";
  }
  if (!["socks5:", "socks5h:", "http:", "https:"].includes(parsed.protocol)) return "";
  if (!parsed.hostname) return "";
  const port = Number(parsed.port || (parsed.protocol === "http:" ? 80 : 1080));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "";
  parsed.port = String(port);
  return parsed.toString().replace(/\/$/, "");
}

function parseProxyList(text, defaultScheme) {
  const out = [];
  const seen = new Set();
  for (const line of String(text || "").split(/\r?\n/)) {
    // A line may contain several ip:port tokens; pull each one out.
    const tokens = line.match(/(?:socks5h?:\/\/|https?:\/\/)?[^\s,;]+/gi) || [];
    for (const token of tokens) {
      const url = normalizeProxyUrl(token, defaultScheme);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push(url);
      if (out.length >= MAX_POOL) return out;
    }
  }
  return out;
}

function loadPool() {
  const file = poolFile();
  if (!fs.existsSync(file)) return [];
  const out = [];
  const seen = new Set();
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const url = normalizeProxyUrl(line);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function savePool(list) {
  const file = poolFile();
  ensureDir(dirname(file));
  const clean = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const url = normalizeProxyUrl(item);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    clean.push(url);
    if (clean.length >= MAX_POOL) break;
  }
  fs.writeFileSync(file, clean.length ? clean.join("\n") + "\n" : "", "utf8");
  return clean;
}

function addToPool(url) {
  const normalized = normalizeProxyUrl(url);
  if (!normalized) throw new Error("not a usable proxy url: " + String(url || ""));
  const pool = loadPool();
  if (!pool.includes(normalized)) pool.push(normalized);
  savePool(pool);
  return { pool: loadPool(), added: normalized };
}

function clearPool() {
  const file = poolFile();
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const cache = cacheFile();
  if (fs.existsSync(cache)) fs.unlinkSync(cache);
  return { cleared: true, poolFile: file };
}

function loadCache() {
  const file = cacheFile();
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function saveCache(url, proxies) {
  const file = cacheFile();
  ensureDir(dirname(file));
  const payload = { url: String(url || ""), at: Date.now(), proxies: Array.isArray(proxies) ? proxies : [] };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

function fetchText(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = Number(timeoutMs || 15000);
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.get(url, { timeout, headers: { "User-Agent": "opencode-unlimited/1.0" } }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        reject(new Error("list fetch failed: HTTP " + res.statusCode));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          res.destroy();
          reject(new Error("list too large"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("timeout", () => req.destroy(new Error("list fetch timed out")));
    req.on("error", reject);
  });
}

async function fetchList(url, options = {}) {
  const target = String(url || DEFAULT_LIST_URL);
  const cached = loadCache();
  const fresh =
    cached &&
    cached.url === target &&
    Date.now() - Number(cached.at || 0) < LIST_TTL_MS &&
    Array.isArray(cached.proxies) &&
    cached.proxies.length > 0;
  if (fresh && !options.force) {
    return { url: target, proxies: cached.proxies, cached: true, at: cached.at };
  }
  const text = await fetchText(target, options.timeoutMs || 15000);
  const proxies = parseProxyList(text, options.defaultScheme);
  if (!proxies.length) throw new Error("list fetch returned no usable proxies, pool left untouched");
  saveCache(target, proxies);
  // Merge into the pool without dropping manual entries.
  const merged = [...new Set([...loadPool(), ...proxies])].slice(0, MAX_POOL);
  savePool(merged);
  return { url: target, proxies, cached: false, at: Date.now() };
}

function findCurl() {
  for (const candidate of ["/usr/bin/curl", "/usr/local/bin/curl", "/opt/homebrew/bin/curl"]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const out = execFileSync("/usr/bin/which", ["curl"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const first = String(out || "").trim().split(/\r?\n/)[0];
    if (first && fs.existsSync(first)) return first;
  } catch {
    void 0;
  }
  return "curl";
}

function parseTrace(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function testProxyTcp(url, timeoutMs) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      resolve({ ok: false, ms: 0, ip: "", country: "", error: String(error.message || error) });
      return;
    }
    const started = Date.now();
    const socket = net.connect({ host: parsed.hostname.replace(/^\[|\]$/g, ""), port: Number(parsed.port || 1080) });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, ms: Date.now() - started, ip: "", country: "", error: "timeout" });
    }, Number(timeoutMs || 6000));
    socket.once("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, ms: Date.now() - started, ip: "", country: "", error: String(error.message || error) });
    });
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve({ ok: true, ms: Date.now() - started, ip: "", country: "", error: "" });
    });
  });
}

function testProxy(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 8000);
  const curl = findCurl();
  const started = Date.now();
  try {
    const out = execFileSync(
      curl,
      ["-s", "--max-time", String(Math.max(3, Math.ceil(timeoutMs / 1000))), "--proxy", url, TRACE_URL],
      { encoding: "utf8", timeout: timeoutMs + 5000, stdio: ["ignore", "pipe", "ignore"] },
    );
    const trace = parseTrace(out);
    const ms = Date.now() - started;
    if (trace.ip) {
      return { ok: true, ms, ip: trace.ip, country: String(trace.loc || "").toUpperCase(), error: "" };
    }
    return { ok: false, ms, ip: "", country: "", error: "no egress ip in trace response" };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, ip: "", country: "", error: String((error && error.message) || error).slice(0, 120) };
  }
}

async function testProxyAsync(url, options = {}) {
  const result = testProxy(url, options);
  if (result.ok || options.tcpOnly) return result;
  // curl missing or blocked: fall back to a bare TCP reachability check.
  const tcp = await testProxyTcp(url, options.timeoutMs || 6000);
  if (tcp.ok) return { ...tcp, ip: "", country: "" };
  return result;
}

async function testPool(options = {}) {
  const pool = options.pool || loadPool();
  const top = Number(options.top || options.limit || 0);
  const ranked = proxyHealth.rank(pool, { limit: top > 0 ? top : 0 });
  const targets = ranked.proxies;
  const results = [];
  for (const url of targets) {
    const result = await testProxyAsync(url, { timeoutMs: options.timeoutMs || 8000 });
    const slow = result.ok && result.ms > proxyHealth.SLOW_MS;
    proxyHealth.record({ url, ok: result.ok && !slow, ms: result.ms, reason: result.ok ? (slow ? "slow" : "") : result.error || "failed" });
    results.push({ url, ...result, slow });
  }
  return { total: targets.length, ok: results.filter((row) => row.ok && !row.slow).length, results };
}

async function hunt(options = {}) {
  const pool = options.pool || loadPool();
  const ranked = proxyHealth.rank(pool, { limit: 0 });
  const wantCountry = String(options.country || "").trim().toUpperCase();
  const wantPrefix = String(options.prefix || "").trim().toLowerCase();
  const limit = Number(options.limit || 0);
  const attempts = [];
  let tried = 0;
  for (const url of ranked.proxies) {
    if (limit > 0 && tried >= limit) break;
    tried += 1;
    const result = await testProxyAsync(url, { timeoutMs: options.timeoutMs || 8000 });
    const slow = result.ok && result.ms > proxyHealth.SLOW_MS;
    proxyHealth.record({ url, ok: result.ok && !slow, ms: result.ms, reason: result.ok ? (slow ? "slow" : "") : result.error || "failed" });
    const entry = { url, ...result, slow, tried };
    attempts.push(entry);
    if (!result.ok || slow) continue;
    if (wantCountry && result.country && result.country !== wantCountry) continue;
    if (wantPrefix && result.ip && !result.ip.toLowerCase().startsWith(wantPrefix)) continue;
    if (result.ip) {
      const state = egress.check({ ip: result.ip });
      entry.spent = state.spent;
      if (state.spent) continue;
    }
    return { found: true, proxy: url, ip: result.ip, country: result.country, ms: result.ms, attempts };
  }
  return { found: false, proxy: "", ip: "", country: "", ms: 0, attempts };
}

function main() {
  const [action, ...rest] = process.argv.slice(2);
  (async () => {
    try {
      if (!action || action === "pool") {
        console.log(JSON.stringify({ poolFile: poolFile(), proxies: loadPool() }, null, 2));
        return;
      }
      if (action === "add") {
        console.log(JSON.stringify(addToPool(rest[0]), null, 2));
        return;
      }
      if (action === "clear") {
        console.log(JSON.stringify(clearPool(), null, 2));
        return;
      }
      if (action === "fetch") {
        console.log(JSON.stringify(await fetchList(rest[0], { force: rest.includes("--force") }), null, 2));
        return;
      }
      if (action === "test") {
        console.log(JSON.stringify(await testPool({ top: Number(rest[0] || 0) }), null, 2));
        return;
      }
      if (action === "hunt") {
        const opts = {};
        for (let i = 0; i < rest.length; i += 1) {
          if (rest[i] === "--country") opts.country = rest[++i];
          else if (rest[i] === "--prefix") opts.prefix = rest[++i];
          else if (rest[i] === "--limit") opts.limit = Number(rest[++i]);
        }
        console.log(JSON.stringify(await hunt(opts), null, 2));
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
  poolFile,
  cacheFile,
  normalizeProxyUrl,
  parseProxyList,
  loadPool,
  savePool,
  addToPool,
  clearPool,
  loadCache,
  fetchList,
  testProxy,
  testProxyAsync,
  testPool,
  hunt,
  DEFAULT_LIST_URL,
  MAX_POOL,
};
