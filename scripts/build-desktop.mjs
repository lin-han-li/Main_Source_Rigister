import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBinaries } from "./build-server-binary.mjs";
import { runVerification } from "./verify-desktop.mjs";
import {
  ROOT_DIR,
  assertTargetMatchesHost,
  binaryFileName,
  chmod,
  copyDir,
  copyFile,
  emptyDir,
  ensureDir,
  getArchitectureInfo,
  getHostPlatform,
  loadDesktopReleaseConfig,
  normalizeTargetPlatform,
  parseArgs,
  pathExists,
  run,
  safeArtifactName,
  selectApps,
  writeTextFile,
} from "./lib/release-utils.mjs";

function yamlQuote(value) {
  return JSON.stringify(String(value));
}

function yamlNumber(value) {
  return String(Number(value));
}

function createLinuxLauncher(app) {
  return `#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="\${XDG_DATA_HOME:-$HOME/.local/share}/${app.linux.packageName}"
mkdir -p "$RUNTIME_DIR/accounts/with_token" "$RUNTIME_DIR/accounts/without_token" "$RUNTIME_DIR/codex_tokens"
export OPENAI_REGISTER_RUNTIME_DIR="$RUNTIME_DIR"

exec "/opt/${app.linux.packageName}/bundle/${app.binaryName}" "$@"
`;
}

function createDesktopFile(app) {
  return `[Desktop Entry]
Type=Application
Version=1.0
Name=${app.productName}
Comment=${app.description}
Exec=/usr/bin/${app.linux.commandName}
Terminal=true
Categories=Utility;
Icon=/opt/${app.linux.packageName}/resources/${path.basename(app.linux.icon)}
`;
}

function createMacLauncher(app) {
  return `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="$HOME/Library/Application Support/${app.runtimeDirName}"
mkdir -p "$RUNTIME_DIR/accounts/with_token" "$RUNTIME_DIR/accounts/without_token" "$RUNTIME_DIR/codex_tokens"
export OPENAI_REGISTER_RUNTIME_DIR="$RUNTIME_DIR"

chmod +x "$SCRIPT_DIR/${app.binaryName}"
exec "$SCRIPT_DIR/${app.binaryName}" "$@"
`;
}

function createMacInstallNote(app) {
  return `Install ${app.productName}

1. Open this DMG.
2. Drag the "${app.macos.folderName}" folder to a writable location such as your Desktop or Documents.
3. Open "${app.macos.launcherName}" to start the app in Terminal.

This build is unsigned by default. Future signing and notarization can be added later via the macOS signing environment variables described in README.md.
`;
}

async function resolveIsccPath() {
  const candidates = [
    "D:\\Inno Setup 6\\ISCC.exe",
    path.join(process.env["ProgramFiles(x86)"] || "", "Inno Setup 6", "ISCC.exe"),
    path.join(process.env.ProgramFiles || "", "Inno Setup 6", "ISCC.exe"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error("ISCC.exe not found. Install Inno Setup 6 before running dist:win.");
}

async function packageWindows(config, buildResult) {
  const outputDir = path.join(ROOT_DIR, "dist", "releases", "win");
  const isccPath = await resolveIsccPath();
  const arch = getArchitectureInfo().label;
  const artifacts = [];

  await ensureDir(outputDir);

  for (const item of buildResult.apps) {
    const app = item.app;
    const outputBaseName = `${safeArtifactName(app.binaryName)}-${config.version}-windows-${arch}-setup`;
    const installerScript = path.join(ROOT_DIR, app.windows.installerScript);
    const installerPath = path.join(outputDir, `${outputBaseName}.exe`);

    await run(isccPath, [
      `/DMyAppVersion=${config.version}`,
      `/DMyAppPublisher=${config.publisher}`,
      `/DMyAppPublisherURL=${config.publisherUrl}`,
      `/DMyAppSourceExe=${item.binaryPath}`,
      `/DMyOutputDir=${outputDir}`,
      `/DMyOutputBaseFilename=${outputBaseName}`,
      installerScript,
    ]);

    if (!(await pathExists(installerPath))) {
      throw new Error(`Windows installer was not created: ${installerPath}`);
    }

    artifacts.push(installerPath);
  }

  return artifacts;
}

async function packageLinux(config, buildResult) {
  const outputDir = path.join(ROOT_DIR, "dist", "releases", "linux");
  const stageRoot = path.join(ROOT_DIR, "build", "package", "linux");
  const arch = getArchitectureInfo();
  const artifacts = [];

  await ensureDir(outputDir);
  await ensureDir(stageRoot);

  for (const item of buildResult.apps) {
    const app = item.app;
    const appStageRoot = path.join(stageRoot, app.id);
    const rootfsDir = path.join(appStageRoot, "rootfs");
    const bundleDir = path.join(rootfsDir, "opt", app.linux.packageName, "bundle");
    const resourceDir = path.join(rootfsDir, "opt", app.linux.packageName, "resources");
    const launcherPath = path.join(rootfsDir, "usr", "bin", app.linux.commandName);
    const desktopFilePath = path.join(rootfsDir, "usr", "share", "applications", app.linux.desktopFileName);
    const binaryTarget = path.join(bundleDir, binaryFileName(app, "linux"));
    const iconTarget = path.join(resourceDir, path.basename(app.linux.icon));
    const nfpmConfigPath = path.join(appStageRoot, "nfpm.yaml");
    const debTarget = path.join(outputDir, `${app.linux.packageName}_${config.version}_${arch.nfpm}.deb`);
    const rpmTarget = path.join(outputDir, `${app.linux.packageName}-${config.version}.${arch.rpm}.rpm`);

    await emptyDir(appStageRoot);
    await copyFile(item.binaryPath, binaryTarget);
    await chmod(binaryTarget, 0o755);
    await copyFile(path.join(ROOT_DIR, app.linux.icon), iconTarget);
    await writeTextFile(launcherPath, createLinuxLauncher(app));
    await chmod(launcherPath, 0o755);
    await writeTextFile(desktopFilePath, createDesktopFile(app));

    const nfpmConfig = [
      `name: ${yamlQuote(app.linux.packageName)}`,
      `arch: ${yamlQuote(arch.nfpm)}`,
      `platform: "linux"`,
      `version: ${yamlQuote(config.version)}`,
      `release: "1"`,
      `section: ${yamlQuote(config.linux.section || "utils")}`,
      `priority: ${yamlQuote(config.linux.priority || "optional")}`,
      `maintainer: ${yamlQuote(config.linux.maintainer)}`,
      `description: ${yamlQuote(app.description)}`,
      `vendor: ${yamlQuote(config.vendor)}`,
      `homepage: ${yamlQuote(config.publisherUrl || config.homepage || "")}`,
      `license: ${yamlQuote(config.packageJson.license || "UNLICENSED")}`,
      "contents:",
      `  - src: ${yamlQuote(binaryTarget)}`,
      `    dst: ${yamlQuote(`/opt/${app.linux.packageName}/bundle/${binaryFileName(app, "linux")}`)}`,
      "    file_info:",
      `      mode: ${yamlNumber(0o755)}`,
      `  - src: ${yamlQuote(iconTarget)}`,
      `    dst: ${yamlQuote(`/opt/${app.linux.packageName}/resources/${path.basename(app.linux.icon)}`)}`,
      "    file_info:",
      `      mode: ${yamlNumber(0o644)}`,
      `  - src: ${yamlQuote(launcherPath)}`,
      `    dst: ${yamlQuote(`/usr/bin/${app.linux.commandName}`)}`,
      "    file_info:",
      `      mode: ${yamlNumber(0o755)}`,
      `  - src: ${yamlQuote(desktopFilePath)}`,
      `    dst: ${yamlQuote(`/usr/share/applications/${app.linux.desktopFileName}`)}`,
      "    file_info:",
      `      mode: ${yamlNumber(0o644)}`,
      "",
    ].join("\n");

    await writeTextFile(nfpmConfigPath, nfpmConfig);

    await run("nfpm", ["package", "--config", nfpmConfigPath, "--packager", "deb", "--target", debTarget]);
    await run("nfpm", ["package", "--config", nfpmConfigPath, "--packager", "rpm", "--target", rpmTarget]);

    if (!(await pathExists(debTarget))) {
      throw new Error(`Linux .deb package was not created: ${debTarget}`);
    }

    if (!(await pathExists(rpmTarget))) {
      throw new Error(`Linux .rpm package was not created: ${rpmTarget}`);
    }

    artifacts.push(debTarget, rpmTarget);
  }

  return artifacts;
}

async function maybeCodesignMacBinary(config, binaryPath) {
  const identityEnv = config.macos?.signing?.identityEnv || "MACOS_SIGN_IDENTITY";
  const identity = process.env[identityEnv];

  if (!identity) {
    console.log(`[dist:mac] ${binaryPath} will remain unsigned.`);
    return;
  }

  console.log(`[dist:mac] Signing ${binaryPath} with identity ${identity}`);
  await run("codesign", ["--force", "--sign", identity, binaryPath]);
}

async function packageMac(config, buildResult) {
  const outputDir = path.join(ROOT_DIR, "dist", "releases", "mac");
  const stageRoot = path.join(ROOT_DIR, "build", "package", "mac");
  const arch = getArchitectureInfo().label;
  const artifacts = [];

  await ensureDir(outputDir);
  await ensureDir(stageRoot);

  for (const item of buildResult.apps) {
    const app = item.app;
    const appStageRoot = path.join(stageRoot, app.id);
    const packageDir = path.join(appStageRoot, app.macos.folderName);
    const dmgRoot = path.join(appStageRoot, "dmg-root");
    const binaryTarget = path.join(packageDir, app.binaryName);
    const launcherPath = path.join(packageDir, app.macos.launcherName);
    const dmgTarget = path.join(
      outputDir,
      `${safeArtifactName(app.binaryName)}-${config.version}-macos-${arch}.dmg`,
    );

    await emptyDir(appStageRoot);
    await ensureDir(packageDir);
    await copyFile(item.binaryPath, binaryTarget);
    await chmod(binaryTarget, 0o755);
    await maybeCodesignMacBinary(config, binaryTarget);
    await copyFile(path.join(ROOT_DIR, app.linux.icon), path.join(packageDir, path.basename(app.linux.icon)));
    await writeTextFile(launcherPath, createMacLauncher(app));
    await chmod(launcherPath, 0o755);
    await writeTextFile(path.join(packageDir, "INSTALL.txt"), createMacInstallNote(app));

    if (await pathExists(path.join(ROOT_DIR, "README.md"))) {
      await copyFile(path.join(ROOT_DIR, "README.md"), path.join(packageDir, "README.md"));
    }

    await emptyDir(dmgRoot);
    await copyDir(packageDir, path.join(dmgRoot, app.macos.folderName));

    await run("hdiutil", [
      "create",
      "-volname",
      app.productName,
      "-srcfolder",
      dmgRoot,
      "-ov",
      "-format",
      "UDZO",
      dmgTarget,
    ]);

    if (!(await pathExists(dmgTarget))) {
      throw new Error(`macOS DMG was not created: ${dmgTarget}`);
    }

    artifacts.push(dmgTarget);
  }

  return artifacts;
}

export async function buildDesktopPackages(options = {}) {
  const config = await loadDesktopReleaseConfig();
  const target = normalizeTargetPlatform(options.target || getHostPlatform());

  assertTargetMatchesHost(target);

  if (!options.skipVerify) {
    await runVerification();
  }

  const selectedApps = selectApps(config, options.app);
  const buildResult = await buildBinaries({
    target,
    app: selectedApps.map((app) => app.id),
  });

  switch (target) {
    case "win":
      return packageWindows(config, buildResult);
    case "linux":
      return packageLinux(config, buildResult);
    case "mac":
      return packageMac(config, buildResult);
    default:
      throw new Error(`Unsupported packaging target: ${target}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifacts = await buildDesktopPackages({
    target: args.target,
    app: args.app,
    skipVerify: Boolean(args["skip-verify"]),
  });

  console.log("");
  console.log("Desktop artifacts:");
  for (const artifact of artifacts) {
    console.log(`- ${artifact}`);
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch((error) => {
    console.error(`[build-desktop] ${error.message}`);
    process.exitCode = 1;
  });
}
