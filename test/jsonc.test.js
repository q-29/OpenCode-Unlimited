const { test } = require("node:test");
const assert = require("node:assert/strict");
const { stripJsonc, parseJsonc, setTopLevelProperty } = require("../lib/jsonc.js");

test("stripJsonc removes line and block comments but keeps comment-like strings", () => {
  const src = '{\n  // a comment\n  "url": "https://example.com/a//b", /* block */\n  "n": 1,\n}\n';
  const cleaned = stripJsonc(src);
  assert.ok(!cleaned.includes("a comment"));
  assert.ok(cleaned.includes("https://example.com/a//b"));
  const parsed = JSON.parse(cleaned);
  assert.equal(parsed.url, "https://example.com/a//b");
  assert.equal(parsed.n, 1);
});

test("parseJsonc handles trailing commas and empty input", () => {
  assert.deepEqual(parseJsonc('{"a": 1, "b": [1, 2,],}'), { a: 1, b: [1, 2] });
  assert.deepEqual(parseJsonc(""), {});
  assert.deepEqual(parseJsonc("  \n"), {});
});

test("setTopLevelProperty replaces an existing property and preserves comments", () => {
  const src = '{\n  // keep me\n  "plugins": ["./plugins/old"],\n  "theme": "dark"\n}\n';
  const out = setTopLevelProperty(src, "plugins", ["./plugins/unlimited-shield"]);
  assert.ok(out.includes("// keep me"));
  assert.ok(out.includes("unlimited-shield"));
  assert.ok(!out.includes("./plugins/old"));
  assert.deepEqual(parseJsonc(out).plugins, ["./plugins/unlimited-shield"]);
});

test("setTopLevelProperty inserts a missing property into an object", () => {
  const out = setTopLevelProperty('{\n  "theme": "dark"\n}\n', "plugins", ["x"]);
  assert.deepEqual(parseJsonc(out), { theme: "dark", plugins: ["x"] });
});

test("setTopLevelProperty creates a document from empty input", () => {
  const out = setTopLevelProperty("", "plugins", ["x"]);
  assert.deepEqual(parseJsonc(out), { plugins: ["x"] });
});

test("setTopLevelProperty handles nested values without breaking siblings", () => {
  const src = '{"commands": {"a": {"description": "x", "template": "y"}}, "other": 1}';
  const out = setTopLevelProperty(src, "commands", { b: { description: "z" } });
  const parsed = parseJsonc(out);
  assert.deepEqual(parsed.commands, { b: { description: "z" } });
  assert.equal(parsed.other, 1);
});
