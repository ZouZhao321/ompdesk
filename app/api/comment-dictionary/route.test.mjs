import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { getAgentDir, setAgentDir } from "@oh-my-pi/pi-utils";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { PUT, DELETE } = await jiti.import("./route.ts");
const { GET: getCommentEntries } = await jiti.import("../comment-entries/route.ts");
const { allowFileRoot, getAdditionalAllowedRoots, normalizeSlashes } =
  await jiti.import("@/lib/allowed-roots.ts");

function request(method, body) {
  return new Request("http://localhost:30141/api/comment-dictionary", {
    method,
    headers: { host: "localhost:30141", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "ompdesk-dictionary-route-"));
  const agentDir = join(root, "agent");
  const project = join(root, "project");
  mkdirSync(agentDir);
  mkdirSync(project);
  writeFileSync(join(project, "a.ts"), "// 中文说明\nconst a = 1;\n");
  const normalizedProject = normalizeSlashes(project);
  allowFileRoot(project);

  const previousAgentDir = getAgentDir();
  const previousEnv = process.env.PI_CODING_AGENT_DIR;
  setAgentDir(agentDir);
  t.after(() => {
    setAgentDir(previousAgentDir);
    if (previousEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousEnv;
    getAdditionalAllowedRoots().delete(normalizedProject);
    globalThis.__ompAllowedRootsCache?.roots.delete(normalizedProject);
    rmSync(root, { recursive: true, force: true });
  });
  return { project };
}

async function listEntries(project) {
  const { NextRequest } = await import("next/server");
  const response = await getCommentEntries(
    new NextRequest(
      `http://localhost:30141/api/comment-entries?cwd=${encodeURIComponent(project)}`,
      {
        headers: { host: "localhost:30141" },
      },
    ),
  );
  assert.equal(response.status, 200);
  return response.json();
}

test("saving a manual translation makes it readable with the project entries", async (t) => {
  const { project } = await createFixture(t);

  const saved = await PUT(
    request("PUT", {
      original: "中文说明",
      originalLanguage: "zh",
      targetLanguage: "en",
      translation: "Chinese note",
    }),
  );
  assert.equal(saved.status, 200);
  const record = await saved.json();
  assert.equal(record.origin, "manual");
  assert.equal(record.model, null);

  const payload = await listEntries(project);
  assert.equal(payload.entries.length, 1);
  assert.equal(payload.translations[record.key].translation, "Chinese note");
});

test("deleting the dictionary removes translations from later reads", async (t) => {
  const { project } = await createFixture(t);
  await PUT(
    request("PUT", {
      original: "中文说明",
      originalLanguage: "zh",
      targetLanguage: "en",
      translation: "Chinese note",
    }),
  );

  const deleted = await DELETE(request("DELETE"));
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deleted: true });

  const payload = await listEntries(project);
  assert.deepEqual(payload.translations, {});

  const again = await DELETE(request("DELETE"));
  assert.deepEqual(await again.json(), { deleted: false });
});

test("invalid translations are rejected without writing the dictionary", async (t) => {
  const { project } = await createFixture(t);

  const empty = await PUT(
    request("PUT", {
      original: "中文说明",
      originalLanguage: "zh",
      targetLanguage: "en",
      translation: "   ",
    }),
  );
  assert.equal(empty.status, 400);

  const sameLanguage = await PUT(
    request("PUT", {
      original: "中文说明",
      originalLanguage: "zh",
      targetLanguage: "zh",
      translation: "中文说明",
    }),
  );
  assert.equal(sameLanguage.status, 400);

  const payload = await listEntries(project);
  assert.deepEqual(payload.translations, {});
});
