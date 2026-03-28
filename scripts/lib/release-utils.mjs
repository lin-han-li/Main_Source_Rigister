import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);

export const ROOT_DIR = path.resolve(path.dirname(THIS_FILE), "..", "..");
export const DESKTOP_WORKFLOW_RELATIVE_PATH = path.join(".github", "workflows", "build-desktop.yml");

function assignArgValue(result, key, value) {
  if (!(key in result)) {
    result[key] = value;
    return;
  }

  if (Array.isArray(result[key])) {
    result[key].push(value);
    return;
  }

  result[key] = [result[key], value];
}

export function parseArgs(argv) {
  const result = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      result._.push(token);
      continue;
    }

    const body = token.slice(2);
    const equalsIndex = body.indexOf("=");
    if (equalsIndex >= 0) {
      assignArgValue(result, body.slice(0, equalsIndex), body.slice(equalsIndex + 1));
      continue;
    }

    const nextToken = argv[index + 1];
    if (nextToken && !nextToken.startsWith("--")) {
      assignArgValue(result, body, nextToken);
      index += 1;
      continue;
    }

    assignArgValue(result, body, true);
  }

  return result;
}

export function normalizeTargetPlatform(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return getHostPlatform();
  }

  if (["win", "windows", "win32"].includes(normalized)) {
    return "win";
  }

  if (["linux", "ubuntu"].includes(normalized)) {
    return "linux";
  }

  if (["mac", "macos", "darwin", "osx"].includes(normalized)) {
    return "mac";
  }

  throw new Error(`Unsupported target platform: ${value}`);
}

export function getHostPlatform() {
  return normalizeTargetPlatform(process.platform);
}

export function assertTargetMatchesHost(target, host = getHostPlatform()) {
  if (target !== host) {
    throw new Error(
      `Refusing to build ${target} packages on ${host}. Use a native ${target} build host or runner.`,
    );
  }
}

export function getArchitectureInfo() {
  switch (process.arch) {
    case "x64":
      return { label: "x64", nfpm: "amd64", rpm: "x86_64" };
    case "arm64":
      return { label: "arm64", nfpm: "arm64", rpm: "aarch64" };
    default:
      throw new Error(`Unsupported CPU architecture for packaging: ${process.arch}`);
  }
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function loadDesktopReleaseConfig() {
  const packageJson = await readJson(path.join(ROOT_DIR, "package.json"));
  const releaseConfig = packageJson.desktopRelease;

  if (!releaseConfig || !Array.isArray(releaseConfig.apps) || releaseConfig.apps.length === 0) {
    throw new Error("package.json is missing desktopRelease.apps");
  }

  return {
    packageJson,
    version: packageJson.version,
    author: packageJson.author || {},
    homepage: packageJson.homepage || "",
    publisher: releaseConfig.publisher || packageJson.author?.name || "",
    publisherUrl: releaseConfig.publisherUrl || packageJson.homepage || "",
    vendor: releaseConfig.vendor || packageJson.author?.name || "",
    linux: releaseConfig.linux || {},
    macos: releaseConfig.macos || {},
    apps: releaseConfig.apps,
  };
}

export function selectApps(config, requestedApps) {
  if (!requestedApps || requestedApps === "all") {
    return config.apps;
  }

  const rawValues = Array.isArray(requestedApps) ? requestedApps : [requestedApps];
  const requestedIds = rawValues
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  const selected = config.apps.filter(
    (app) => requestedIds.includes(app.id) || requestedIds.includes(app.binaryName),
  );

  if (selected.length !== requestedIds.length) {
    const found = new Set(selected.flatMap((app) => [app.id, app.binaryName]));
    const missing = requestedIds.filter((value) => !found.has(value));
    throw new Error(`Unknown app id(s): ${missing.join(", ")}`);
  }

  return selected;
}

export function binaryFileName(app, platform) {
  return platform === "win" ? `${app.binaryName}.exe` : app.binaryName;
}

export function safeArtifactName(value) {
  return String(value)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveDesktopWorkflowPath(options = {}) {
  const allowLegacyParent = options.allowLegacyParent !== false;
  const repoRootPath = path.join(ROOT_DIR, DESKTOP_WORKFLOW_RELATIVE_PATH);

  if (await pathExists(repoRootPath)) {
    return { path: repoRootPath, location: "repo-root" };
  }

  if (allowLegacyParent) {
    const legacyParentPath = path.join(ROOT_DIR, "..", DESKTOP_WORKFLOW_RELATIVE_PATH);
    if (await pathExists(legacyParentPath)) {
      return { path: legacyParentPath, location: "legacy-parent" };
    }
  }

  const legacyHint = allowLegacyParent ? ` or ${path.join("..", DESKTOP_WORKFLOW_RELATIVE_PATH)}` : "";
  throw new Error(
    `Could not find desktop workflow at ${DESKTOP_WORKFLOW_RELATIVE_PATH}${legacyHint}.`,
  );
}

export async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
  return targetPath;
}

export async function rmrf(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
}

export async function emptyDir(targetPath) {
  await rmrf(targetPath);
  await ensureDir(targetPath);
}

export async function writeTextFile(targetPath, content) {
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, content, "utf8");
}

export async function copyFile(sourcePath, targetPath) {
  await ensureDir(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
}

export async function copyDir(sourcePath, targetPath) {
  await ensureDir(path.dirname(targetPath));
  await fs.cp(sourcePath, targetPath, { recursive: true });
}

export async function chmod(targetPath, mode) {
  await fs.chmod(targetPath, mode);
}

export async function run(command, args = [], options = {}) {
  const cwd = options.cwd || ROOT_DIR;
  const env = { ...process.env, ...options.env };
  const display = [command, ...args].join(" ");
  console.log(`> ${display}`);

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: options.stdio || "inherit",
      shell: options.shell || false,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} exited with code ${code ?? "null"}${signal ? ` (signal ${signal})` : ""}`,
        ),
      );
    });
  });
}

export async function capture(command, args = [], options = {}) {
  const cwd = options.cwd || ROOT_DIR;
  const env = { ...process.env, ...options.env };

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: options.shell || false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      reject(
        new Error(
          `${command} exited with code ${code ?? "null"}${signal ? ` (signal ${signal})` : ""}${
            output ? `\n${output}` : ""
          }`,
        ),
      );
    });
  });
}

export async function resolvePythonCommand() {
  const candidates =
    process.platform === "win32"
      ? [
          ["python"],
          ["py", "-3.11"],
          ["py", "-3"],
          ["py"],
        ]
      : [
          ["python3"],
          ["python"],
        ];

  for (const candidate of candidates) {
    try {
      await capture(candidate[0], [...candidate.slice(1), "--version"]);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("Python 3.11+ was not found in PATH.");
}

export function assertSemver(version) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(version || "").trim())) {
    throw new Error(`Invalid package.json version: ${version}`);
  }
}

export function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function buildWindowsVersionFile(app, releaseConfig) {
  const versionParts = String(releaseConfig.version)
    .split(/[+-]/)[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));

  while (versionParts.length < 4) {
    versionParts.push(0);
  }

  const versionTuple = versionParts.slice(0, 4).join(", ");
  const publisher = releaseConfig.publisher || releaseConfig.author?.name || "Unknown";
  const originalFilename = binaryFileName(app, "win");

  return `
VSVersionInfo(
  ffi=FixedFileInfo(
    filevers=(${versionTuple}),
    prodvers=(${versionTuple}),
    mask=0x3F,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo([
      StringTable(
        "040904B0",
        [
          StringStruct("CompanyName", "${publisher}"),
          StringStruct("FileDescription", "${app.productName}"),
          StringStruct("FileVersion", "${releaseConfig.version}"),
          StringStruct("InternalName", "${app.binaryName}"),
          StringStruct("OriginalFilename", "${originalFilename}"),
          StringStruct("ProductName", "${app.productName}"),
          StringStruct("ProductVersion", "${releaseConfig.version}")
        ]
      )
    ]),
    VarFileInfo([VarStruct("Translation", [1033, 1200])])
  ]
)
`.trimStart();
}
