import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(currentFile);
export const rootDir = path.resolve(scriptsDir, "..");
export const repoDir = path.resolve(rootDir, "..");
export const packageJsonPath = path.join(rootDir, "package.json");
export const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
export const releaseMetadata = packageJson.releaseMetadata ?? {};
export const version = packageJson.version;
export const tagPrefix = releaseMetadata.tagPrefix ?? "main-source-v";
export const publisher = releaseMetadata.publisher ?? packageJson.author?.name ?? "unknown";
export const maintainer =
  releaseMetadata.linux?.maintainer ??
  `${packageJson.author?.name ?? "unknown"} <${packageJson.author?.email ?? "unknown@example.com"}>`;

export const artifactsDir = path.join(rootDir, "artifacts");
export const buildDir = path.join(rootDir, "build");

export const apps = [
  {
    id: "register-only",
    displayName: "OpenAI Register Only",
    entry: "register_only.py",
    binaryBaseName: "Register_Only",
    windowsIcon: "assets/register_only_icon.ico",
    windowsInstallerScript: "register_only_installer.iss",
    windowsInstallerBaseName: "Register_Only_Setup",
    linuxPackageName: "openai-register-only",
    linuxCommandName: "openai-register-only",
    macFolderName: "OpenAI Register Only",
    macLauncherName: "Run OpenAI Register Only.command"
  },
  {
    id: "register-full",
    displayName: "OpenAI Register Full",
    entry: "register_success.py",
    binaryBaseName: "Register_Full",
    windowsIcon: "assets/register_full_icon.ico",
    windowsInstallerScript: "register_full_installer.iss",
    windowsInstallerBaseName: "Register_Full_Setup",
    linuxPackageName: "openai-register-full",
    linuxCommandName: "openai-register-full",
    macFolderName: "OpenAI Register Full",
    macLauncherName: "Run OpenAI Register Full.command"
  }
];

export function normalizeTarget(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "win" || normalized === "windows" || normalized === "win32") {
    return "win";
  }
  if (normalized === "linux") {
    return "linux";
  }
  if (normalized === "mac" || normalized === "macos" || normalized === "darwin") {
    return "mac";
  }
  throw new Error(`Unsupported target: ${value}`);
}

export function currentTarget() {
  return normalizeTarget(process.platform);
}

export function currentArchitecture() {
  if (process.arch === "x64") {
    return "x64";
  }
  if (process.arch === "arm64") {
    return "arm64";
  }
  return process.arch;
}

export function linuxDebArchitecture() {
  if (process.arch === "x64") {
    return "amd64";
  }
  if (process.arch === "arm64") {
    return "arm64";
  }
  throw new Error(`Unsupported Linux architecture for Debian packaging: ${process.arch}`);
}

export function getBinaryName(app, target = currentTarget()) {
  return target === "win" ? `${app.binaryBaseName}.exe` : app.binaryBaseName;
}

export function getArtifactRoot(target) {
  return path.join(artifactsDir, normalizeTarget(target));
}

export function getRuntimeSeedFiles() {
  return ["ak.txt", "rk.txt"];
}

export function getRuntimeSeedDirectories() {
  return ["accounts", "accounts/with_token", "accounts/without_token", "codex_tokens"];
}
