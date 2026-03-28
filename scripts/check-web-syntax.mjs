import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rootDir } from "./release-config.mjs";
import { logStep, pathExists, resolvePython, runCommand, runPython, writeTextFile } from "./common.mjs";

const excludedSegments = new Set([
  "artifacts",
  "build",
  "__pycache__",
  "accounts",
  "codex_tokens",
  "node_modules"
]);

function collectFiles(dirPath, results = { html: [], js: [] }) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") {
      continue;
    }

    if (excludedSegments.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      collectFiles(fullPath, results);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();

    if (extension === ".html" || extension === ".htm") {
      results.html.push(fullPath);
      continue;
    }

    if ([".js", ".mjs", ".cjs"].includes(extension)) {
      results.js.push(fullPath);
    }
  }

  return results;
}

function checkJavaScript(filePath) {
  runCommand("node", ["--check", filePath], { cwd: rootDir });
}

function parseHtmlFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const srcPattern = /\bsrc\s*=\s*["']([^"']+)["']/i;
  const typePattern = /\btype\s*=\s*["']([^"']+)["']/i;
  let matchIndex = 0;

  for (const match of content.matchAll(scriptPattern)) {
    matchIndex += 1;
    const attributes = match[1] ?? "";
    const body = match[2] ?? "";
    const srcMatch = attributes.match(srcPattern);
    const typeMatch = attributes.match(typePattern);
    const isModule = (typeMatch?.[1] ?? "").trim().toLowerCase() === "module";

    if (srcMatch) {
      const rawSrc = srcMatch[1];

      if (/^(https?:)?\/\//i.test(rawSrc)) {
        continue;
      }

      const resolved = path.resolve(path.dirname(filePath), rawSrc);

      if (!pathExists(resolved)) {
        throw new Error(`Referenced script does not exist: ${rawSrc} in ${path.relative(rootDir, filePath)}`);
      }

      checkJavaScript(resolved);
      continue;
    }

    if (!body.trim()) {
      continue;
    }

    const tempName = isModule ? `inline-${Date.now()}-${matchIndex}.mjs` : `inline-${Date.now()}-${matchIndex}.cjs`;
    const tempPath = path.join(os.tmpdir(), tempName);

    try {
      writeTextFile(tempPath, body);
      checkJavaScript(tempPath);
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
  }
}

logStep("Web syntax scan");

const discovered = collectFiles(rootDir);

if (discovered.html.length === 0 && discovered.js.length === 0) {
  console.log("No local HTML or JavaScript assets were found in Main_source. Skipping web syntax checks.");
  process.exit(0);
}

for (const filePath of discovered.js) {
  checkJavaScript(filePath);
}

for (const filePath of discovered.html) {
  parseHtmlFile(filePath);
}

const python = resolvePython();
runPython(
  python,
  [
    "-c",
    "import pathlib, sys; [pathlib.Path(p).read_text(encoding='utf-8') for p in sys.argv[1:]]",
    ...discovered.html.map((filePath) => path.relative(rootDir, filePath))
  ],
  { cwd: rootDir }
);

console.log(`Checked ${discovered.html.length} HTML file(s) and ${discovered.js.length} JavaScript file(s).`);
