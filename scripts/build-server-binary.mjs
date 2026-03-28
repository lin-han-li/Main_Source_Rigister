import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROOT_DIR,
  assertTargetMatchesHost,
  binaryFileName,
  buildWindowsVersionFile,
  copyFile,
  emptyDir,
  ensureDir,
  getHostPlatform,
  loadDesktopReleaseConfig,
  normalizeTargetPlatform,
  parseArgs,
  pathExists,
  resolvePythonCommand,
  run,
  selectApps,
  writeTextFile,
} from "./lib/release-utils.mjs";

export async function buildBinaries(options = {}) {
  const config = await loadDesktopReleaseConfig();
  const target = normalizeTargetPlatform(options.target || getHostPlatform());
  const selectedApps = selectApps(config, options.app);
  const pythonCommand = await resolvePythonCommand();

  assertTargetMatchesHost(target);

  const distRoot = path.join(ROOT_DIR, "dist", "binaries", target);
  const workRoot = path.join(ROOT_DIR, "build", "pyinstaller", target);
  const versionRoot = path.join(ROOT_DIR, "build", "version-info", target);

  await ensureDir(distRoot);
  await ensureDir(workRoot);
  await ensureDir(versionRoot);

  const results = [];

  for (const app of selectedApps) {
    const appDistDir = path.join(distRoot, app.id);
    const appWorkDir = path.join(workRoot, app.id);
    const binaryPath = path.join(appDistDir, binaryFileName(app, target));
    const pyinstallerArgs = [
      ...pythonCommand.slice(1),
      "-m",
      "PyInstaller",
      "--noconfirm",
      "--clean",
      "--onefile",
      "--name",
      app.binaryName,
      "--distpath",
      appDistDir,
      "--workpath",
      appWorkDir,
      "--specpath",
      appWorkDir,
      "--collect-all",
      "curl_cffi",
    ];

    await emptyDir(appDistDir);
    await emptyDir(appWorkDir);

    if (target === "win" && app.windows?.icon) {
      pyinstallerArgs.push("--icon", path.join(ROOT_DIR, app.windows.icon));

      const versionFile = path.join(versionRoot, `${app.id}.txt`);
      await writeTextFile(versionFile, buildWindowsVersionFile(app, config));
      pyinstallerArgs.push("--version-file", versionFile);
    }

    pyinstallerArgs.push(path.join(ROOT_DIR, app.entry));

    console.log(`[build-server] Building ${app.productName} for ${target}...`);
    await run(pythonCommand[0], pyinstallerArgs, {
      env: {
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
    });

    if (!(await pathExists(binaryPath))) {
      throw new Error(`Expected binary not found after PyInstaller build: ${binaryPath}`);
    }

    console.log(`[build-server] Smoke testing ${binaryPath} --help`);
    await run(binaryPath, ["--help"], {
      cwd: path.dirname(binaryPath),
      env: {
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        OPENAI_REGISTER_RUNTIME_DIR: path.join(ROOT_DIR, "build", "smoke-runtime", app.id, target),
      },
    });

    if (options.syncRoot) {
      const rootCopyPath = path.join(ROOT_DIR, binaryFileName(app, target));
      await copyFile(binaryPath, rootCopyPath);
      console.log(`[build-server] Synced root binary ${rootCopyPath}`);
    }

    results.push({
      app,
      binaryPath,
      distDir: appDistDir,
      target,
    });
  }

  return {
    target,
    apps: results,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await buildBinaries({
    target: args.target,
    app: args.app,
    syncRoot: Boolean(args["sync-root"]),
  });

  console.log("");
  console.log("Native binaries:");
  for (const item of result.apps) {
    console.log(`- ${item.binaryPath}`);
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch((error) => {
    console.error(`[build-server] ${error.message}`);
    process.exitCode = 1;
  });
}
