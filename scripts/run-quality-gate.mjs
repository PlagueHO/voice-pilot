#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";

/**
 * Root directory for the current workspace. Assumes the script is invoked from the
 * repository root via an npm script or VS Code task.
 */
const workspaceRoot = process.cwd();
/** Maximum wall-clock allocation for running the entire quality gate sequence. */
const runtimeBudgetMs = 15 * 60 * 1000; // 15 minutes

/**
 * Ordered set of quality gate tasks to execute. Tasks must be listed in their desired
 * execution order because early failures short-circuit the remaining checks.
 */
const tasks = [
  { label: "Validate Threat Register", command: "npm", args: ["run", "validate:threats"] },
  { label: "Lint Extension", command: "npm", args: ["run", "lint"] },
  { label: "Test Unit", command: "npm", args: ["run", "test:unit"] },
  { label: "Test Extension", command: "npm", args: ["run", "test:extension"] },
  {
    label: "Test Coverage",
    command: "npm",
    args: ["run", "test:coverage"],
    captureCoverage: true,
  },
  { label: "Test Performance", command: "npm", args: ["run", "test:perf"] },
];

/**
 * Spawns the given command and resolves to the exit code once the child process exits.
 *
 * @param {string} command - Executable to spawn.
 * @param {string[]} args - Command line arguments passed to the executable.
 * @returns {Promise<number>} The exit code from the command; `0` indicates success.
 */
function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * Normalizes coverage values collected from NYC output by rounding to the nearest
 * integer percentage while guarding against invalid or missing data.
 *
 * @param {number} value - Raw coverage percentage value reported by NYC.
 * @returns {number} Sanitized percentage within the inclusive range `[0, 100]`.
 */
function normalizeCoverageValue(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

/**
 * Reads and normalizes the aggregated NYC coverage snapshot for inclusion in the
 * telemetry report. When the snapshot is missing or unparsable, zero metrics are
 * returned so the quality gate can continue while signalling reduced coverage.
 *
 * @returns {Promise<{statements:number,branches:number,functions:number,lines:number}>}
 * Normalized coverage metrics.
 */
async function readCoverageSnapshot() {
  try {
    const coveragePath = path.join(
      workspaceRoot,
      "coverage",
      "coverage-summary.json",
    );
    const raw = await readFile(coveragePath, "utf8");
    const json = JSON.parse(raw);
    const totals = json.total ?? json;
    return {
      statements: normalizeCoverageValue(totals.statements?.pct),
      branches: normalizeCoverageValue(totals.branches?.pct),
      functions: normalizeCoverageValue(totals.functions?.pct),
      lines: normalizeCoverageValue(totals.lines?.pct),
    };
  } catch (error) {
    console.warn(
      "⚠️ Unable to read coverage summary – defaulting coverage metrics to 0",
      error?.message ?? error,
    );
    return {
      statements: 0,
      branches: 0,
      functions: 0,
      lines: 0,
    };
  }
}

/**
 * Entry point that orchestrates the sequential execution of quality gate tasks,
 * enforces the shared runtime budget, and persists telemetry artefacts for CI review.
 *
 * @returns {Promise<void>} Resolves when the gate completes; exits the process on failure.
 */
async function main() {
  const report = [];
  let exitCode = 0;
  let totalDuration = 0;

  for (const task of tasks) {
    console.log(`▶️  Running ${task.label}...`);
    const start = performance.now();
    const code = await runCommand(task.command, task.args);
    const durationMs = Math.round(performance.now() - start);
    totalDuration += durationMs;
    const entry = {
      task: task.label,
      status: code === 0 ? "pass" : "fail",
      durationMs,
    };

    if (task.captureCoverage) {
      entry.coverage = await readCoverageSnapshot();
    }

    report.push(entry);

    if (code !== 0) {
      exitCode = code;
      console.error(`❌ ${task.label} failed after ${durationMs}ms`);
      break;
    }

    console.log(`✅ ${task.label} completed in ${durationMs}ms`);
  }

  if (totalDuration > runtimeBudgetMs) {
    const seconds = Math.round(totalDuration / 1000);
    console.error(
      `❌ Quality gate exceeded runtime budget: ${seconds}s > ${runtimeBudgetMs / 1000}s`,
    );
    exitCode = exitCode || 1;
  }

  const telemetryDir = path.join(workspaceRoot, "telemetry");
  await mkdir(telemetryDir, { recursive: true });
  const reportPath = path.join(telemetryDir, "gate-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`📝 Quality gate report written to ${reportPath}`);

  if (exitCode !== 0) {
    process.exit(exitCode);
  }

  console.log("🎉 Quality gate sequence completed successfully");
}

main().catch((error) => {
  console.error("❌ Quality gate sequence failed to run", error);
  process.exit(1);
});
