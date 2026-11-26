const fs = require("node:fs");
const path = require("node:path");

function stripJsonc(input) {
  const src = String(input ?? "").replace(/^\uFEFF/, "");
  let out = "";
  let i = 0;
  let inString = false;
  let escaped = false;

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }

    // Single-line comment
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < src.length && src[i] !== "\n" && src[i] !== "\r") {
        i += 1;
      }
      continue;
    }

    // Block comment
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n" || src[i] === "\r") out += src[i];
        i += 1;
      }
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }

  // Strip trailing commas outside strings before } or ]
  let cleaned = "";
  inString = false;
  escaped = false;
  for (let idx = 0; idx < out.length; idx += 1) {
    const ch = out[idx];
    if (inString) {
      cleaned += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      cleaned += ch;
      continue;
    }
    if (ch === ",") {
      let look = idx + 1;
      while (look < out.length && /\s/.test(out[look])) look += 1;
      if (out[look] === "}" || out[look] === "]") {
        continue;
      }
    }
    cleaned += ch;
  }

  return cleaned;
}

function parseJsonc(text) {
  const cleaned = stripJsonc(text).trim();
  if (!cleaned) return {};
  return JSON.parse(cleaned);
}

function findTopLevelProperty(src, propName) {
  let i = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let rootStart = -1;
  let rootEnd = -1;

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      i += 2;
      while (i < src.length && src[i] !== "\n" && src[i] !== "\r") i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) rootStart = i;
      depth += 1;
      i += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        rootEnd = i;
        break;
      }
      i += 1;
      continue;
    }

    if (ch === "[" || ch === "]") {
      if (ch === "[") depth += 1;
      else depth -= 1;
      i += 1;
      continue;
    }

    if (ch === '"') {
      const strStart = i;
      i += 1;
      let strEsc = false;
      while (i < src.length) {
        if (strEsc) strEsc = false;
        else if (src[i] === "\\") strEsc = true;
        else if (src[i] === '"') break;
        i += 1;
      }
      const rawKey = src.slice(strStart, i + 1);
      i += 1;

      if (depth === 1) {
        let k = i;
        while (k < src.length) {
          if (/\s/.test(src[k])) {
            k += 1;
          } else if (src[k] === "/" && src[k + 1] === "/") {
            k += 2;
            while (k < src.length && src[k] !== "\n" && src[k] !== "\r") k += 1;
          } else if (src[k] === "/" && src[k + 1] === "*") {
            k += 2;
            while (k < src.length && !(src[k] === "*" && src[k + 1] === "/")) k += 1;
            k += 2;
          } else {
            break;
          }
        }
        if (src[k] === ":") {
          let parsedKey = "";
          try {
            parsedKey = JSON.parse(rawKey);
          } catch {
            parsedKey = "";
          }
          let vStart = k + 1;
          while (vStart < src.length && /\s/.test(src[vStart])) vStart += 1;
          const vEnd = scanValueEnd(src, vStart);
          if (parsedKey === propName && vEnd > vStart) {
            return {
              found: true,
              keyStart: strStart,
              valueStart: vStart,
              valueEnd: vEnd,
              rootStart,
              rootEnd: findRootEnd(src, vEnd, 1),
            };
          }
          i = vEnd > vStart ? vEnd : k + 1;
          continue;
        }
      }
      continue;
    }

    i += 1;
  }

  return { found: false, rootStart, rootEnd };
}

function findRootEnd(src, fromIdx, currentDepth) {
  let i = fromIdx;
  let depth = currentDepth;
  let inString = false;
  let escaped = false;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < src.length && src[i] !== "\n" && src[i] !== "\r") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

function scanValueEnd(src, start) {
  let i = start;
  while (i < src.length) {
    if (/\s/.test(src[i])) {
      i += 1;
    } else if (src[i] === "/" && src[i + 1] === "/") {
      i += 2;
      while (i < src.length && src[i] !== "\n" && src[i] !== "\r") i += 1;
    } else if (src[i] === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
    } else {
      break;
    }
  }
  if (i >= src.length) return i;

  const ch = src[i];
  if (ch === '"') {
    i += 1;
    let esc = false;
    while (i < src.length) {
      if (esc) esc = false;
      else if (src[i] === "\\") esc = true;
      else if (src[i] === '"') return i + 1;
      i += 1;
    }
    return i;
  }

  if (ch === "{" || ch === "[") {
    const end = findRootEnd(src, i + 1, 1);
    return end >= 0 ? end + 1 : src.length;
  }

  // primitive: true, false, null, number
  while (i < src.length && !/[\s,}\]/]/.test(src[i])) {
    i += 1;
  }
  return i;
}

function indentJson(value, indentSpaces = 2) {
  const formatted = JSON.stringify(value, null, 2);
  if (indentSpaces <= 0) return formatted;
  const pad = " ".repeat(indentSpaces);
  return formatted
    .split("\n")
    .map((line, idx) => (idx === 0 ? line : pad + line))
    .join("\n");
}

function setTopLevelProperty(rawText, propName, value) {
  const src = String(rawText ?? "").replace(/^\uFEFF/, "");
  if (!src.trim()) {
    const obj = { [propName]: value };
    return JSON.stringify(obj, null, 2) + "\n";
  }

  // Ensure file is valid JSONC first
  const currentObj = parseJsonc(src);
  const loc = findTopLevelProperty(src, propName);

  if (loc.found) {
    const lineStart = src.lastIndexOf("\n", loc.keyStart) + 1;
    const indentMatch = src.slice(lineStart, loc.keyStart).match(/^[ \t]*/);
    const indentLen = indentMatch ? indentMatch[0].length : 2;
    const replacement = indentJson(value, indentLen);
    return src.slice(0, loc.valueStart) + replacement + src.slice(loc.valueEnd);
  }

  if (loc.rootStart >= 0 && loc.rootEnd > loc.rootStart) {
    const keys = Object.keys(currentObj);
    const formattedVal = indentJson(value, 2);
    const entry = `  ${JSON.stringify(propName)}: ${formattedVal}`;
    if (keys.length === 0) {
      const inner = src.slice(loc.rootStart + 1, loc.rootEnd);
      if (!inner.includes("//") && !inner.includes("/*")) {
        return `${src.slice(0, loc.rootStart + 1)}\n${entry}\n${src.slice(loc.rootEnd)}`;
      }
    }

    // Find last non-whitespace/non-comment character before rootEnd to see if a comma is needed
    let scan = loc.rootEnd - 1;
    let lastCodeIdx = -1;
    // Scan forward from rootStart + 1 to rootEnd tracking last non-ws/non-comment char at depth 1
    let p = loc.rootStart + 1;
    let d = 1;
    let inStr = false;
    let esc = false;
    while (p < loc.rootEnd) {
      const c = src[p];
      const n = src[p + 1];
      if (inStr) {
        lastCodeIdx = p;
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        p += 1;
        continue;
      }
      if (c === '"') {
        inStr = true;
        lastCodeIdx = p;
        p += 1;
        continue;
      }
      if (c === "/" && n === "/") {
        p += 2;
        while (p < loc.rootEnd && src[p] !== "\n" && src[p] !== "\r") p += 1;
        continue;
      }
      if (c === "/" && n === "*") {
        p += 2;
        while (p < loc.rootEnd && !(src[p] === "*" && src[p + 1] === "/")) p += 1;
        p += 2;
        continue;
      }
      if (!/\s/.test(c)) {
        lastCodeIdx = p;
      }
      if (c === "{" || c === "[") d += 1;
      else if (c === "}" || c === "]") d -= 1;
      p += 1;
    }
    void scan;

    if (lastCodeIdx >= 0 && src[lastCodeIdx] !== ",") {
      const withComma = src.slice(0, lastCodeIdx + 1) + "," + src.slice(lastCodeIdx + 1, loc.rootEnd);
      const needsNewline = !withComma.endsWith("\n");
      return withComma + (needsNewline ? "\n" : "") + entry + "\n" + src.slice(loc.rootEnd);
    }
    const beforeRootEnd = src.slice(0, loc.rootEnd);
    const needsNewline = !beforeRootEnd.endsWith("\n");
    return beforeRootEnd + (needsNewline ? "\n" : "") + entry + "\n" + src.slice(loc.rootEnd);
  }

  currentObj[propName] = value;
  return JSON.stringify(currentObj, null, 2) + "\n";
}

function readJsoncFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8");
  return parseJsonc(raw);
}

function updateJsoncFile(filePath, updates) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let text = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  for (const [key, val] of Object.entries(updates)) {
    text = setTopLevelProperty(text, key, val);
  }
  if (!text.endsWith("\n")) text += "\n";
  fs.writeFileSync(filePath, text, "utf8");
}

module.exports = {
  stripJsonc,
  parseJsonc,
  setTopLevelProperty,
  readJsoncFile,
  updateJsoncFile,
};
