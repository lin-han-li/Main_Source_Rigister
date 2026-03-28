import fs from "node:fs";
import path from "node:path";
import { rootDir } from "./release-config.mjs";
import { logStep, resolvePython, runPython } from "./common.mjs";

const excludedSegments = new Set([
  "artifacts",
  "build",
  "__pycache__",
  "accounts",
  "codex_tokens",
  "node_modules"
]);

function collectPythonFiles(dirPath) {
  const results = [];

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (excludedSegments.has(entry.name)) {
        continue;
      }

      results.push(...collectPythonFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".py")) {
      results.push(fullPath);
    }
  }

  return results;
}

logStep("Python compile gate");
console.log("This repository has no static type system. Running Python compile checks as the release gate.");

const python = resolvePython();
const files = collectPythonFiles(rootDir).map((filePath) => path.relative(rootDir, filePath));

if (files.length === 0) {
  console.log("No Python files found.");
  process.exit(0);
}

runPython(python, ["-m", "py_compile", ...files], { cwd: rootDir });
console.log(`Compiled ${files.length} Python file(s).`);
