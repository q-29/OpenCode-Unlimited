const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { clear, verify, detect } = require("../lib/db-tools.js");

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma busy_timeout = 8000");
  db.exec(`
    create table project (id text primary key, worktree text, time_created integer);
    create table project_directory (project_id text, directory text, time_created integer);
    create table session_v2 (id text primary key, project_id text, directory text, title text, idle_outcome text, time_created integer, time_updated integer, revert text);
    create table session_message (id text primary key, session_id text, data text, type text, seq integer);
    create table session_inbox (session_id text, payload text);
  `);
  return db;
}

test("detect finds canonical tables", () => {
  const db = makeDb();
  const schema = detect(db);
  assert.equal(schema.sessionTable, "session_v2");
  assert.equal(schema.messageTable, "session_message");
  db.close();
});

test("clear strips free-limit errors and resets idle flags", () => {
  const db = makeDb();
  db.prepare("insert into project values ('p1', '/tmp/proj', 1)").run();
  db.prepare("insert into session_v2 values ('ses_1', 'p1', '/tmp/proj', 't', 'failed', 1, 1, null)").run();
  const bad = JSON.stringify({ type: "error", error: { type: "provider.free-limit", message: "Free usage limit reached" }, outcome: "failed", finish: "error" });
  db.prepare("insert into session_message values ('msg_1', 'ses_1', ?, 'idle', 1)").run(bad);
  const good = JSON.stringify({ type: "text", outcome: "succeeded" });
  db.prepare("insert into session_message values ('msg_2', 'ses_1', ?, 'idle', 2)").run(good);

  const message = clear(db, "");
  assert.match(message, /cleared: 1/);
  const row = db.prepare("select data from session_message where id = 'msg_1'").get();
  const parsed = JSON.parse(row.data);
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.outcome, "succeeded");
  assert.equal(parsed.finish, "stop");
  assert.deepEqual(parsed.content, []);
  const session = db.prepare("select idle_outcome from session_v2 where id = 'ses_1'").get();
  assert.equal(session.idle_outcome, "succeeded");
  db.close();
});

test("clear is scoped to a folder and matches /private/var style paths", () => {
  const db = makeDb();
  db.prepare("insert into project values ('p1', '/private/var/proj', 1)").run();
  db.prepare("insert into project values ('p2', '/other', 1)").run();
  db.prepare("insert into session_v2 values ('ses_1', 'p1', '/private/var/proj', 't', 'failed', 1, 1, null)").run();
  db.prepare("insert into session_v2 values ('ses_2', 'p2', '/other', 't', 'failed', 1, 1, null)").run();
  const bad = JSON.stringify({ error: { type: "provider.free-limit" }, outcome: "failed" });
  db.prepare("insert into session_message values ('msg_1', 'ses_1', ?, 'idle', 1)").run(bad);
  db.prepare("insert into session_message values ('msg_2', 'ses_2', ?, 'idle', 1)").run(bad);
  const message = clear(db, "/private/var/proj");
  assert.match(message, /cleared: 1/);
  const left = db.prepare("select data from session_message where id = 'msg_2'").get();
  assert.ok(JSON.parse(left.data).error, "other folder untouched");
  db.close();
});

test("verify reports no problems on a clean db and flags limit rows", () => {
  const db = makeDb();
  db.prepare("insert into project values ('p1', '/tmp/proj', 1)").run();
  db.prepare("insert into session_v2 values ('ses_1', 'p1', '/tmp/proj', 't', 'succeeded', 1, 1, null)").run();
  assert.deepEqual(verify(db, false), ["no problems found"]);
  const bad = JSON.stringify({ error: { type: "provider.free-limit" } });
  db.prepare("insert into session_message values ('msg_1', 'ses_1', ?, 'idle', 1)").run(bad);
  const lines = verify(db, false);
  assert.ok(lines.some((line) => line.includes("free-limit")));
  db.close();
});

test("verify --fix repairs invalid idle outcome", () => {
  const db = makeDb();
  db.prepare("insert into project values ('p1', '/tmp/proj', 1)").run();
  db.prepare("insert into session_v2 values ('ses_1', 'p1', '/tmp/proj', 't', 'succeeded', 1, 1, null)").run();
  db.prepare("insert into session_message values ('msg_1', 'ses_1', ?, 'idle', 1)").run(JSON.stringify({ outcome: "weird" }));
  const lines = verify(db, true);
  assert.ok(lines.some((line) => line.includes("invalid idle outcome")));
  const row = db.prepare("select data from session_message where id = 'msg_1'").get();
  assert.equal(JSON.parse(row.data).outcome, "succeeded");
  db.close();
});
