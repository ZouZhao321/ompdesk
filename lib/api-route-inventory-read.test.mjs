import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const API_ROOT = fileURLToPath(new URL("../app/api", import.meta.url));

// Agent streams own their lifecycle logging in the SSE ticket; everything else
// that answers GET must go through the shared request wrapper.
const SSE_ROUTES = new Set([
  "/api/agent/[id]/events",
  "/api/agent/running/events",
]);

function listRouteFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listRouteFiles(entryPath));
    else if (entry.name === "route.ts") files.push(entryPath);
  }
  return files;
}

function routeTemplate(filePath) {
  const relative = path.relative(API_ROOT, path.dirname(filePath));
  return `/api/${relative.split(path.sep).join("/")}`;
}

function isExported(node) {
  return Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function getExportShape(sourceFile) {
  const shapes = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === "GET" && isExported(statement)) {
      shapes.push({ kind: "function" });
      continue;
    }
    if (!ts.isVariableStatement(statement) || !isExported(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "GET") continue;
      const initializer = declaration.initializer;
      if (!initializer || !ts.isCallExpression(initializer)) {
        shapes.push({ kind: "invalid" });
        continue;
      }
      const callee = initializer.expression;
      const routeArgument = initializer.arguments[0];
      shapes.push({
        kind: "wrapped",
        callee: ts.isIdentifier(callee) ? callee.text : null,
        route: routeArgument && ts.isStringLiteral(routeArgument) ? routeArgument.text : null,
      });
    }
  }
  return shapes;
}

test("every GET route outside SSE is wrapped with its route template", () => {
  const problems = [];
  for (const filePath of listRouteFiles(API_ROOT)) {
    const route = routeTemplate(filePath);
    if (SSE_ROUTES.has(route)) continue;

    const source = fs.readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const shapes = getExportShape(sourceFile);
    const label = path.relative(path.resolve(API_ROOT, ".."), filePath);

    if (shapes.length === 0) continue;
    if (shapes.length > 1) {
      problems.push(`${label}: exports GET more than once`);
      continue;
    }
    const [shape] = shapes;
    if (shape.kind === "function") {
      problems.push(`${label}: GET is exported without withRequestLog`);
    } else if (shape.kind === "invalid") {
      problems.push(`${label}: GET is not initialised with withRequestLog`);
    } else if (shape.callee !== "withRequestLog") {
      problems.push(`${label}: GET uses ${shape.callee ?? "an unknown expression"} instead of withRequestLog`);
    } else if (shape.route !== route) {
      problems.push(`${label}: GET logs route ${JSON.stringify(shape.route)} but the route is ${JSON.stringify(route)}`);
    }
  }

  assert.deepEqual(problems, []);
});
