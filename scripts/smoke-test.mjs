import { rootDir } from "./release-config.mjs";
import { logStep, resolvePython, runPython } from "./common.mjs";

const python = resolvePython();

logStep("CLI smoke checks");
runPython(python, ["register_only.py", "--help"], { cwd: rootDir });
runPython(python, ["register_success.py", "--help"], { cwd: rootDir });

logStep("Import smoke checks");
runPython(
  python,
  [
    "-c",
    [
      "import register_only as only_app",
      "assert callable(only_app.main)",
      "assert only_app._resolve_output_path('accounts').endswith('accounts')",
      "print('register_only import smoke ok')"
    ].join("; ")
  ],
  { cwd: rootDir }
);

runPython(
  python,
  [
    "-c",
    [
      "import register_success as full_app",
      "assert callable(full_app.main)",
      "cfg = full_app._load_config()",
      "assert isinstance(cfg, dict)",
      "assert 'proxy' in cfg",
      "print('register_success import smoke ok')"
    ].join("; ")
  ],
  { cwd: rootDir }
);
