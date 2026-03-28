import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { parseArgs, resolveDesktopWorkflowPath } from "./lib/release-utils.mjs";

function normalizePathValue(value) {
  return String(value || "").replace(/\\/g, "/");
}

function findStepByUses(steps, needle) {
  return (steps || []).find((step) => String(step.uses || "").includes(needle));
}

export async function checkReleaseWorkflow() {
  const resolvedWorkflow = await resolveDesktopWorkflowPath({ allowLegacyParent: true });
  const workflowPath = resolvedWorkflow.path;
  const workflowLocation = resolvedWorkflow.location;

  if (workflowLocation === "legacy-parent") {
    console.warn(
      `[check-workflow] Using legacy workflow path outside repo root: ${path.relative(process.cwd(), workflowPath)}`,
    );
  }

  const raw = await fs.readFile(workflowPath, "utf8");
  const workflow = parse(raw);
  const triggers = workflow.on || workflow["on"] || {};

  if (!("workflow_dispatch" in triggers)) {
    throw new Error("build-desktop.yml is missing workflow_dispatch");
  }

  const pushTags = triggers.push?.tags || [];
  if (!Array.isArray(pushTags) || !pushTags.some((item) => String(item).includes("v"))) {
    throw new Error("build-desktop.yml is missing a push.tags trigger for release tags");
  }

  const jobs = workflow.jobs || {};
  const buildJob = Object.values(jobs).find((job) => Array.isArray(job?.strategy?.matrix?.include));
  if (!buildJob) {
    throw new Error("build-desktop.yml is missing a matrix build job");
  }

  const matrixInclude = buildJob.strategy.matrix.include;
  const osValues = new Set(matrixInclude.map((item) => item.os));
  const targetValues = new Set(matrixInclude.map((item) => item.target));

  for (const requiredOs of ["windows-latest", "ubuntu-latest", "macos-latest"]) {
    if (!osValues.has(requiredOs)) {
      throw new Error(`Matrix is missing ${requiredOs}`);
    }
  }

  for (const requiredTarget of ["win", "linux", "mac"]) {
    if (!targetValues.has(requiredTarget)) {
      throw new Error(`Matrix is missing target ${requiredTarget}`);
    }
  }

  const buildSteps = buildJob.steps || [];
  const verifyStep = buildSteps.find((step) => String(step.run || "").includes("verify:desktop"));
  if (!verifyStep) {
    throw new Error("Matrix build job is missing verify:desktop");
  }

  const distStep = buildSteps.find((step) => String(step.run || "").includes("dist:${{ matrix.target }}"));
  if (!distStep) {
    throw new Error("Matrix build job is missing dist:${{ matrix.target }}");
  }

  const setupNodeStep = findStepByUses(buildSteps, "actions/setup-node");
  if (!setupNodeStep) {
    throw new Error("Matrix build job is missing actions/setup-node");
  }

  const cacheDependencyPath = normalizePathValue(setupNodeStep.with?.["cache-dependency-path"]);
  if (!cacheDependencyPath) {
    throw new Error("actions/setup-node is missing cache-dependency-path");
  }

  if (workflowLocation === "repo-root") {
    if (cacheDependencyPath.includes("Main_source/")) {
      throw new Error(
        `Standalone repo workflow should not use Main_source-prefixed cache path: ${cacheDependencyPath}`,
      );
    }
  } else if (!cacheDependencyPath.includes("Main_source/")) {
    throw new Error(`Legacy parent workflow should use Main_source-prefixed cache path: ${cacheDependencyPath}`);
  }

  const uploadArtifactStep = findStepByUses(buildSteps, "actions/upload-artifact");
  if (!uploadArtifactStep) {
    throw new Error("Matrix build job is missing actions/upload-artifact");
  }

  const uploadPath = normalizePathValue(uploadArtifactStep.with?.path);
  if (!uploadPath.includes("dist/releases")) {
    throw new Error(`Unexpected artifact path (missing dist/releases): ${uploadPath}`);
  }

  if (workflowLocation === "repo-root") {
    if (uploadPath.includes("Main_source/")) {
      throw new Error(`Standalone repo workflow should not use Main_source-prefixed artifact path: ${uploadPath}`);
    }
  } else if (!uploadPath.includes("Main_source/dist/releases")) {
    throw new Error(`Legacy parent workflow should use Main_source-prefixed artifact path: ${uploadPath}`);
  }

  const releaseJob = Object.values(jobs).find((job) =>
    (job.steps || []).some((step) => String(step.uses || "").includes("action-gh-release")),
  );
  if (!releaseJob) {
    throw new Error("build-desktop.yml is missing the GitHub Release upload job");
  }

  const releaseSteps = releaseJob.steps || [];
  const downloadArtifactStep = findStepByUses(releaseSteps, "actions/download-artifact");
  if (!downloadArtifactStep) {
    throw new Error("Release job is missing actions/download-artifact");
  }

  const releaseStep = findStepByUses(releaseSteps, "action-gh-release");
  const releaseFiles = String(releaseStep?.with?.files || "");
  if (!releaseFiles.includes("release-assets")) {
    throw new Error(`Unexpected release files path: ${releaseFiles}`);
  }

  for (const ext of [".exe", ".deb", ".rpm", ".dmg"]) {
    if (!releaseFiles.includes(ext)) {
      throw new Error(`Release files configuration is missing ${ext} artifacts`);
    }
  }

  console.log(`[check-workflow] Workflow syntax and artifact paths look valid (${workflowLocation}).`);
}

async function main() {
  parseArgs(process.argv.slice(2));
  await checkReleaseWorkflow();
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch((error) => {
    console.error(`[check-workflow] ${error.message}`);
    process.exitCode = 1;
  });
}
