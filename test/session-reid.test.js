const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { reid, reidAll, sessionId, messageId } = require("../lib/session-reid.js");

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma busy_timeout = 8000");
  db.exec(`
    create table project (id text primary key, worktree text, time_created integer);
    create table session_v2 (id text primary key, project_id text, directory text, title text, time_created integer, time_updated integer, parent_id text);
    create table session_message (id text primary key, session_id text, data text, seq integer);
    create table session_part (id text primary key, session_id text, message_id text, data text);
  `);
  db.prepare("insert into project values ('p1', '/tmp/proj', 1)").run();
  return db;
}

test("sessionId/messageId shapes", () => {
  assert.match(sessionId(), /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  assert.match(messageId(), /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
});

test("reid moves every referencing row and keeps messages", () => {
  const db = makeDb();
  db.prepare("insert into session_v2 values ('ses_old', 'p1', '/tmp/proj', 't', 1, 1, null)").run();
  db.prepare("insert into session_message values ('msg_1', 'ses_old', ?, 1)").run("{}");
  db.prepare("insert into session_message values ('msg_2', 'ses_old', ?, 2)").run("{}");
  db.prepare("insert into session_part values ('prt_1', 'ses_old', 'msg_1', ?)").run("{}");

  const result = reid(db, "ses_old", {});
  assert.notEqual(result.newId, "ses_old");
  assert.equal(result.messages, 2);
  assert.equal(db.prepare("select count(*) c from session_v2 where id = 'ses_old'").get().c, 0);
  assert.equal(db.prepare("select count(*) c from session_message where session_id = ?").get(result.newId).c, 2);
  assert.equal(db.prepare("select count(*) c from session_part where session_id = ?").get(result.newId).c, 1);
  db.close();
});

test("reidAll dry run reports without writing", () => {
  const db = makeDb();
  db.prepare("insert into session_v2 values ('ses_a', 'p1', '/tmp/proj', 't', 1, 1, null)").run();
  db.prepare("insert into session_v2 values ('ses_b', 'p1', '/tmp/proj/sub', 't', 1, 1, null)").run();
  db.prepare("insert into session_v2 values ('ses_c', 'p1', '/elsewhere', 't', 1, 1, null)").run();
  const dry = reidAll(db, "/tmp/proj", { dryRun: true });
  assert.equal(dry.total, 2);
  assert.equal(db.prepare("select count(*) c from session_v2 where id = 'ses_a'").get().c, 1);
  const done = reidAll(db, "/tmp/proj", {});
  assert.equal(done.reid, 2);
  assert.equal(db.prepare("select count(*) c from session_v2 where id = 'ses_c'").get().c, 1);
  db.close();
});

test("reid throws for a missing session", () => {
  const db = makeDb();
  assert.throws(() => reid(db, "ses_missing", {}), /not found/);
  db.close();
});
