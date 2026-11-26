const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseSpec, modelJson } = require("../lib/model-switch.js");

test("parseSpec splits provider/model and variant", () => {
  assert.deepEqual(parseSpec("opencode/deepseek-v4.1-flash-free"), {
    providerID: "opencode",
    id: "deepseek-v4.1-flash-free",
    variant: "",
  });
  assert.deepEqual(parseSpec("openrouter/deepseek/deepseek-v4.1-flash#high"), {
    providerID: "openrouter",
    id: "deepseek/deepseek-v4.1-flash",
    variant: "high",
  });
  assert.throws(() => parseSpec(""), /empty/);
  assert.throws(() => parseSpec("noslash"), /provider\/model/);
  assert.throws(() => parseSpec("/model"), /provider\/model/);
});

test("modelJson includes variant only when present", () => {
  assert.deepEqual(modelJson({ providerID: "p", id: "m", variant: "" }), { id: "m", providerID: "p" });
  assert.deepEqual(modelJson({ providerID: "p", id: "m", variant: "v" }), { id: "m", providerID: "p", variant: "v" });
});
