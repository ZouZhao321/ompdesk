import assert from "node:assert/strict";
import test from "node:test";
import { Settings } from "@oh-my-pi/pi-coding-agent";
import { createJiti } from "jiti";
import { join } from "node:path";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { describeModelRole, formatRoleSelector, listModelRoles, readDefaultModelRole, writeModelRole } =
  await jiti.import(join(process.cwd(), "lib", "model-roles.ts"));

const availableModels = [
  { provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4", api: "anthropic" },
  { provider: "openai", id: "gpt-5-mini", api: "openai-responses" },
];

test("describes the built-in roles and reports unknown ones as undefined", () => {
  assert.equal(describeModelRole("default"), "Model used for ordinary turns.");
  assert.equal(describeModelRole("commit"), "Model that writes commit messages and changelogs.");
  assert.equal(describeModelRole("not-a-role"), undefined);
});

test("reads the default role as a provider/model pair without its thinking suffix", () => {
  const settings = Settings.isolated({ modelRoles: { default: "anthropic/claude-sonnet-4:high" } });
  assert.deepEqual(readDefaultModelRole(settings), { provider: "anthropic", modelId: "claude-sonnet-4" });

  assert.equal(readDefaultModelRole(Settings.isolated({})), undefined);
  assert.equal(readDefaultModelRole(Settings.isolated({ modelRoles: { default: "no-provider" } })), undefined);
  assert.equal(readDefaultModelRole(Settings.isolated({ modelRoles: { default: "/model-only" } })), undefined);
  assert.equal(readDefaultModelRole(Settings.isolated({ modelRoles: { default: "anthropic/" } })), undefined);
});

test("lists built-in and configured roles with their resolved model references", () => {
  const settings = Settings.isolated({
    modelRoles: {
      default: "anthropic/claude-sonnet-4:high",
      smol: "openai/gpt-5-mini",
      missing: "vendor/unknown-model",
    },
    modelTags: { reviewer: { name: "Reviewer", color: "accent", hidden: true } },
  });

  const roles = listModelRoles(settings, availableModels);
  const byRole = new Map(roles.map((role) => [role.role, role]));

  assert.deepEqual(byRole.get("default"), {
    role: "default",
    tag: "DEFAULT",
    name: "Default",
    color: "success",
    builtin: true,
    hidden: false,
    selector: "anthropic/claude-sonnet-4:high",
    source: "default",
    provenance: "runtime",
    resolved: {
      provider: "anthropic",
      modelId: "claude-sonnet-4",
      name: "Claude Sonnet 4",
      thinkingLevel: "high",
    },
  });

  assert.deepEqual(byRole.get("smol").resolved, { provider: "openai", modelId: "gpt-5-mini" });
  assert.equal(byRole.get("missing").resolved, undefined);
  assert.equal(byRole.get("missing").selector, "vendor/unknown-model");
  assert.equal(byRole.get("missing").builtin, false);

  assert.deepEqual(byRole.get("reviewer"), {
    role: "reviewer",
    name: "Reviewer",
    color: "accent",
    builtin: false,
    hidden: false,
    source: "default",
    provenance: "default",
  });

  const unconfigured = byRole.get("plan");
  assert.equal(unconfigured.selector, undefined);
  assert.equal(unconfigured.resolved, undefined);
  assert.equal(unconfigured.builtin, true);
});

test("writes and clears global role assignments", () => {
  const settings = Settings.isolated({});

  writeModelRole(settings, "slow", "anthropic/claude-sonnet-4", "global");
  assert.equal(settings.getModelRole("slow"), "anthropic/claude-sonnet-4");
  assert.equal(settings.getModelRoleProvenance("slow"), "global");

  writeModelRole(settings, "slow", undefined, "global");
  assert.equal(settings.getModelRole("slow"), undefined);
});

test("writes and clears project role assignments", () => {
  const settings = Settings.isolated({});

  writeModelRole(settings, "plan", "openai/gpt-5-mini", "project");
  assert.equal(settings.getModelRole("plan"), "openai/gpt-5-mini");
  assert.equal(settings.getModelRoleSource("plan"), "project");

  writeModelRole(settings, "plan", undefined, "project");
  assert.equal(settings.getModelRole("plan"), undefined);
});

test("formats selectors and leaves off/absent thinking levels off the selector", () => {
  assert.equal(formatRoleSelector({ provider: "a", modelId: "b" }, "high"), "a/b:high");
  assert.equal(formatRoleSelector({ provider: "a", modelId: "b" }, "off"), "a/b");
  assert.equal(formatRoleSelector({ provider: "a", modelId: "b" }), "a/b");
});
