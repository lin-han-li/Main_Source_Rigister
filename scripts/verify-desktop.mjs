import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROOT_DIR,
  assertSemver,
  getNpmCommand,
  loadDesktopReleaseConfig,
  parseArgs,
  resolvePythonCommand,
  run,
} from "./lib/release-utils.mjs";

async function runNodeScript(scriptName) {
  await run(process.execPath, [path.join(ROOT_DIR, "scripts", scriptName)], { cwd: ROOT_DIR });
}

export async function runVerification() {
  const config = await loadDesktopReleaseConfig();
  const pythonCommand = await resolvePythonCommand();
  const npmCommand = getNpmCommand();

  assertSemver(config.version);

  console.log("[verify] Running type check...");
  if (process.platform === "win32") {
    await run("cmd.exe", ["/d", "/s", "/c", `${npmCommand} run typecheck`], { cwd: ROOT_DIR });
  } else {
    await run(npmCommand, ["run", "typecheck"], { cwd: ROOT_DIR });
  }

  console.log("[verify] Checking Python syntax...");
  await run(
    pythonCommand[0],
    [...pythonCommand.slice(1), "-m", "py_compile", "register_only.py", "register_success.py"],
    { cwd: ROOT_DIR },
  );

  console.log("[verify] Checking HTML pages and inline scripts...");
  await runNodeScript("check-web-syntax.mjs");

  console.log("[verify] Running CLI smoke tests...");
  await runNodeScript("smoke-test.mjs");

  console.log("[verify] Validating GitHub Actions workflow...");
  await runNodeScript("check-release-workflow.mjs");

  console.log("[verify] Desktop verification passed.");
}

async function main() {
  parseArgs(process.argv.slice(2));
  await runVerification();
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch((error) => {
    console.error(`[verify] ${error.message}`);
    process.exitCode = 1;
  });
}
