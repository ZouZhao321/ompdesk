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

function shapeOfDeclaration(declaration) {
  if (ts.isFunctionDeclaration(declaration)) return { kind: "function" };
  if (!ts.isVariableDeclaration(declaration)) return { kind: "invalid" };
  const initializer = declaration.initializer;
  if (!initializer || !ts.isCallExpression(initializer)) return { kind: "invalid" };
  const callee = initializer.expression;
  const routeArgument = initializer.arguments[0];
  return {
    kind: "wrapped",
    callee: ts.isIdentifier(callee) ? callee.text : null,
    route: routeArgument && ts.isStringLiteral(routeArgument) ? routeArgument.text : null,
  };
}

/**
 * Collect every exported `GET`, whether it is declared inline or exported
 * separately with `export { GET }` / `export default GET`. A re-export from
 * another module cannot be verified here and is reported as such.
 */
function getExportShape(sourceFile) {
  const declared = new Map();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === "GET") {
      declared.set("GET", shapeOfDeclaration(statement));
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "GET") continue;
      declared.set("GET", shapeOfDeclaration(declaration));
    }
  }

  const shapes = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === "GET" && isExported(statement)) {
      shapes.push(declared.get("GET"));
      continue;
    }
    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === "GET") {
          shapes.push(declared.get("GET"));
        }
      }
      continue;
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.name.text !== "GET") continue;
        const shape = statement.moduleSpecifier ? { kind: "re-export" } : declared.get("GET") ?? { kind: "re-export" };
        shapes.push(shape);
      }
      continue;
    }
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression) && statement.expression.text === "GET") {
      shapes.push(declared.get("GET") ?? { kind: "re-export" });
    }
  }
  return shapes;
}

test("recognizes separate named and default GET exports", () => {
  const shapeFor = (source) => getExportShape(
    ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  );

  assert.deepEqual(shapeFor('export const GET = withRequestLog("/api/x", handle);'), [
    { kind: "wrapped", callee: "withRequestLog", route: "/api/x" },
  ]);
  assert.deepEqual(shapeFor('const GET = withRequestLog("/api/x", handle);\nexport { GET };'), [
    { kind: "wrapped", callee: "withRequestLog", route: "/api/x" },
  ]);
  assert.deepEqual(shapeFor('const GET = withRequestLog("/api/x", handle);\nexport default GET;'), [
    { kind: "wrapped", callee: "withRequestLog", route: "/api/x" },
  ]);
  assert.deepEqual(shapeFor("export function GET() {}"), [{ kind: "function" }]);
  assert.deepEqual(shapeFor("function GET() {}\nexport { GET };"), [{ kind: "function" }]);
  assert.deepEqual(shapeFor('export { GET } from "./handler";'), [{ kind: "re-export" }]);
  assert.deepEqual(shapeFor("export const POST = withRequestLog(\"/api/x\", handle);"), []);
});

test("every GET route outside SSE is wrapped with its route template", () => {
  const problems = [];
  let scannedRoutes = 0;
  for (const filePath of listRouteFiles(API_ROOT)) {
    const route = routeTemplate(filePath);
    if (SSE_ROUTES.has(route)) continue;

    const source = fs.readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const shapes = getExportShape(sourceFile);
    const label = path.relative(path.resolve(API_ROOT, ".."), filePath);

    if (shapes.length === 0) continue;
    scannedRoutes += 1;
    if (shapes.length > 1) {
      problems.push(`${label}: exports GET more than once`);
      continue;
    }
    const [shape] = shapes;
    if (shape.kind === "function") {
      problems.push(`${label}: GET is exported without withRequestLog`);
    } else if (shape.kind === "invalid") {
      problems.push(`${label}: GET is not initialised with withRequestLog`);
    } else if (shape.kind === "re-export") {
      problems.push(`${label}: GET is re-exported from another module, so the wrapper cannot be verified`);
    } else if (shape.callee !== "withRequestLog") {
      problems.push(`${label}: GET uses ${shape.callee ?? "an unknown expression"} instead of withRequestLog`);
    } else if (shape.route !== route) {
      problems.push(`${label}: GET logs route ${JSON.stringify(shape.route)} but the route is ${JSON.stringify(route)}`);
    }
  }

  assert.deepEqual(problems, []);
  // A silent scanner regression (no files matched) would make this test pass
  // vacuously; keep a floor close to the real route count.
  assert.ok(scannedRoutes >= 30, `expected at least 30 exported GET routes, scanned ${scannedRoutes}`);
});
