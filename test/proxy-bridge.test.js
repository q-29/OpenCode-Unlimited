const { test } = require("node:test");
const assert = require("node:assert/strict");
const { splitHostPort, redactProxyUrl, buildSocks5TargetAddress } = require("../lib/proxy-bridge.js");

test("splitHostPort handles host, host:port, bracketed ipv6, bare ipv6", () => {
  assert.deepEqual(splitHostPort("example.com"), { host: "example.com", port: 80 });
  assert.deepEqual(splitHostPort("example.com:3128"), { host: "example.com", port: 3128 });
  assert.deepEqual(splitHostPort("[::1]:1080"), { host: "::1", port: 1080 });
  assert.deepEqual(splitHostPort("[2001:db8::1]"), { host: "2001:db8::1", port: 80 });
  assert.deepEqual(splitHostPort("::1"), { host: "::1", port: 80 });
  assert.equal(splitHostPort(""), null);
  assert.equal(splitHostPort("example.com:99999"), null);
  assert.equal(splitHostPort("[::1"), null);
});

test("redactProxyUrl masks credentials", () => {
  const redacted = redactProxyUrl("socks5://user:secret@127.0.0.1:1080");
  assert.ok(!redacted.includes("secret"));
  assert.ok(!redacted.includes("user"));
  assert.ok(redacted.includes("127.0.0.1"));
  assert.equal(redactProxyUrl(""), "");
  assert.equal(redactProxyUrl("http://127.0.0.1:3128"), "http://127.0.0.1:3128");
});

test("buildSocks5TargetAddress encodes ipv4, ipv6 and hostname ATYPs", () => {
  const v4 = buildSocks5TargetAddress("1.2.3.4");
  assert.equal(v4[0], 0x01);
  assert.deepEqual([...v4.subarray(1)], [1, 2, 3, 4]);
  const v6 = buildSocks5TargetAddress("::1");
  assert.equal(v6[0], 0x04);
  assert.equal(v6.length, 17);
  assert.equal(v6[16], 1);
  const host = buildSocks5TargetAddress("example.com");
  assert.equal(host[0], 0x03);
  assert.equal(host[1], "example.com".length);
  assert.equal(host.subarray(2).toString(), "example.com");
});
