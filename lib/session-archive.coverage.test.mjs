import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { createJiti } from "jiti";
import { getAgentDir, setAgentDir } from "@oh-my-pi/pi-utils/dirs";

const sandboxRoot = join(process.cwd(), ".tmp", "lib-logic-one", "session-archive");
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { readArchivedIds, setSessionArchived } = await jiti.import(join(process.cwd(), "lib", "session-archive.ts"));

let restore;

before(() => {
  restore = { agentDir: getAgentDir(), env: process.env.PI_CODING_AGENT_DIR };
});

after(() => {
  setAgentDir(restore.agentDir);
  if (restore.env === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = restore.env;
  rmSync(sandboxRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function useAgentDir(name) {
  const dir = join(sandboxRoot, name);
  mkdirSync(dir, { recursive: true });
  setAgentDir(dir);
  return dir;
}

test("returns an empty set when the registry has never been written", () => {
  useAgentDir("missing");

  assert.deepEqual([...readArchivedIds()], []);
});

test("returns an empty set when the agent directory itself does not exist", () => {
  setAgentDir(join(sandboxRoot, "absent-agent-dir"));

  assert.deepEqual([...readArchivedIds()], []);
});

test("reads the registry, keeping only string ids", () => {
  const dir = useAgentDir("valid");
  writeFileSync(
    join(dir, "ompdesk-archived.json"),
    JSON.stringify({ archived: ["s-1", 7, null, { id: "s-2" }, "s-3"] }),
  );

  assert.deepEqual([...readArchivedIds()], ["s-1", "s-3"]);
});

test("falls back to the legacy registry file name", () => {
  const dir = useAgentDir("legacy");
  writeFileSync(join(dir, "omp-web-archived.json"), JSON.stringify({ archived: ["legacy-1"] }));

  assert.deepEqual([...readArchivedIds()], ["legacy-1"]);
});

test("prefers the current registry file when both exist", () => {
  const dir = useAgentDir("both");
  writeFileSync(join(dir, "ompdesk-archived.json"), JSON.stringify({ archived: ["current"] }));
  writeFileSync(join(dir, "omp-web-archived.json"), JSON.stringify({ archived: ["legacy"] }));

  assert.deepEqual([...readArchivedIds()], ["current"]);
});

test("treats corrupt or unexpected registry content as empty", () => {
  const dir = useAgentDir("corrupt");

  writeFileSync(join(dir, "ompdesk-archived.json"), "{not json");
  assert.deepEqual([...readArchivedIds()], []);

  writeFileSync(join(dir, "ompdesk-archived.json"), "null");
  assert.deepEqual([...readArchivedIds()], []);

  writeFileSync(join(dir, "ompdesk-archived.json"), JSON.stringify({ archived: { 0: "s-1" } }));
  assert.deepEqual([...readArchivedIds()], []);

  writeFileSync(join(dir, "ompdesk-archived.json"), JSON.stringify({ archived: "s-1" }));
  assert.deepEqual([...readArchivedIds()], []);
});

test("writes archived ids sorted and creates the agent directory on demand", () => {
  const dir = join(sandboxRoot, "write", "nested");
  setAgentDir(dir);

  setSessionArchived("s-3", true);
  setSessionArchived("s-1", true);
  setSessionArchived("s-2", true);

  assert.deepEqual([...readArchivedIds()], ["s-1", "s-2", "s-3"]);
  const persisted = JSON.parse(readFileSync(join(dir, "ompdesk-archived.json"), "utf8"));
  assert.deepEqual(persisted, { archived: ["s-1", "s-2", "s-3"] });
  assert.deepEqual(
    readdirSync(dir).filter((name) => name.endsWith(".tmp")),
    [],
  );
});

test("removing an id leaves the other archived entries untouched", () => {
  const dir = useAgentDir("remove");
  writeFileSync(join(dir, "ompdesk-archived.json"), JSON.stringify({ archived: ["keep", "drop"] }));

  setSessionArchived("drop", false);

  assert.deepEqual([...readArchivedIds()], ["keep"]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "ompdesk-archived.json"), "utf8")), { archived: ["keep"] });
});

test("archiving an already-archived id keeps a single entry", () => {
  const dir = useAgentDir("dedupe");

  setSessionArchived("same", true);
  setSessionArchived("same", true);

  assert.deepEqual([...readArchivedIds()], ["same"]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "ompdesk-archived.json"), "utf8")), { archived: ["same"] });
});
