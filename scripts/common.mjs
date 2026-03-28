import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function logStep(message) {
  console.log(`\n==> ${message}`);
}

export function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

export function removeIfExists(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

export function cleanDir(targetPath) {
  removeIfExists(targetPath);
  ensureDir(targetPath);
}

export function copyFile(source, destination) {
  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);
}

export function copyRecursive(source, destination) {
  ensureDir(path.dirname(destination));
  fs.cpSync(source, destination, { recursive: true, force: true });
}

export function pathExists(targetPath) {
  return fs.existsSync(targetPath);
}

export function makeExecutable(targetPath) {
  if (process.platform !== "win32" && pathExists(targetPath)) {
    fs.chmodSync(targetPath, 0o755);
  }
}

export function writeTextFile(targetPath, content) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, content, "utf8");
}

export function readJson(targetPath) {
  return JSON.parse(fs.readFileSync(targetPath, "utf8"));
}

export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell: options.shell ?? false,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8"
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 0) !== 0 && !options.allowFailure) {
    const commandText = [command, ...args].join(" ");
    const stdout = result.stdout ? `\n${result.stdout}` : "";
    const stderr = result.stderr ? `\n${result.stderr}` : "";
    throw new Error(`Command failed (${result.status}): ${commandText}${stdout}${stderr}`);
  }

  return result;
}

function canRun(command, args) {
  try {
    const result = spawnSync(command, args, { stdio: "ignore" });
    return !result.error;
  } catch {
    return false;
  }
}

export function resolvePython() {
  const explicit = process.env.PYTHON?.trim();
  const candidates = [];

  if (explicit) {
    candidates.push({ command: explicit, args: [] });
  }

  if (process.platform === "win32") {
    candidates.push(
      { command: "python", args: [] },
      { command: "py", args: ["-3.11"] },
      { command: "py", args: ["-3"] }
    );
  } else {
    candidates.push(
      { command: "python3", args: [] },
      { command: "python", args: [] }
    );
  }

  for (const candidate of candidates) {
    if (canRun(candidate.command, [...candidate.args, "--version"])) {
      return candidate;
    }
  }

  throw new Error("Python 3.11+ was not found on PATH.");
}

export function runPython(python, args, options = {}) {
  return runCommand(python.command, [...python.args, ...args], options);
}

export function resolveInnoSetup() {
  if (process.platform !== "win32") {
    throw new Error("Inno Setup is only available on Windows.");
  }

  const explicit = process.env.ISCC_PATH?.trim();
  const candidates = [
    explicit,
    "D:\\Inno Setup 6\\ISCC.exe",
    path.join(process.env["ProgramFiles(x86)"] ?? "", "Inno Setup 6", "ISCC.exe"),
    path.join(process.env.ProgramFiles ?? "", "Inno Setup 6", "ISCC.exe")
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error("ISCC.exe was not found. Install Inno Setup 6 or set ISCC_PATH.");
}

export function createZipArchive(sourceDir, outputFile, rootName) {
  const script = [
    "import pathlib",
    "import shutil",
    "import sys",
    "",
    "source = pathlib.Path(sys.argv[1]).resolve()",
    "output = pathlib.Path(sys.argv[2]).resolve()",
    "root_name = sys.argv[3]",
    "output.parent.mkdir(parents=True, exist_ok=True)",
    "base_name = output.with_suffix('')",
    "shutil.make_archive(str(base_name), 'zip', root_dir=source.parent, base_dir=root_name)"
  ].join("\n");

  const tempScript = path.join(os.tmpdir(), `codex-register-zip-${Date.now()}.py`);
  writeTextFile(tempScript, script);

  try {
    const python = resolvePython();
    runPython(python, [tempScript, sourceDir, outputFile, rootName]);
  } finally {
    fs.rmSync(tempScript, { force: true });
  }
}

export function createTarGzArchive(sourceDir, outputFile, rootName) {
  const script = [
    "import pathlib",
    "import tarfile",
    "import sys",
    "",
    "source = pathlib.Path(sys.argv[1]).resolve()",
    "output = pathlib.Path(sys.argv[2]).resolve()",
    "root_name = sys.argv[3]",
    "output.parent.mkdir(parents=True, exist_ok=True)",
    "with tarfile.open(output, 'w:gz') as archive:",
    "    archive.add(source, arcname=root_name)"
  ].join("\n");

  const tempScript = path.join(os.tmpdir(), `codex-register-tar-${Date.now()}.py`);
  writeTextFile(tempScript, script);

  try {
    const python = resolvePython();
    runPython(python, [tempScript, sourceDir, outputFile, rootName]);
  } finally {
    fs.rmSync(tempScript, { force: true });
  }
}

export function writeArtifactManifest(targetPath, manifest) {
  writeTextFile(targetPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
