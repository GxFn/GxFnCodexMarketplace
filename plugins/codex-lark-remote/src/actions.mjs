import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { nowIso } from "./config.mjs";

const execFileP = promisify(execFile);

export async function runApprovedAction({ queue, config, commandId, action }) {
  const existing = await queue.get(commandId);
  if (!existing) throw new Error(`Task not found: ${commandId}`);

  if (action === "review") return queue.approve(commandId, action);
  ensureReadyForAction(existing, action);
  const command = await queue.approve(commandId, action);

  if (action === "test") return runTestAction({ queue, config, command });
  if (action === "commit") return runCommitAction({ queue, command });
  if (action === "push") return runPushAction({ queue, config, command });
  throw new Error(`Unsupported approval action: ${action}`);
}

export async function runTestAction({ queue, config, command }) {
  const repo = config.repos?.[command.repoKey] || {};
  const testCommand = repo.testCommand;
  if (!testCommand) throw new Error(`No testCommand configured for repo: ${command.repoKey}`);

  const result = await runConfiguredCommand(testCommand, { cwd: command.worktreePath });
  const summary = summarizeCommand(result);
  return queue.update(
    command.id,
    {
      status: "waiting_review",
      testSummary: summary,
      error: result.exitCode === 0 ? "" : summary,
    },
    result.exitCode === 0 ? "approved_test_passed" : "approved_test_failed",
  );
}

export async function runCommitAction({ queue, command }) {
  const porcelain = await git(["status", "--porcelain"], { cwd: command.worktreePath });
  if (!porcelain.stdout.trim()) {
    return queue.update(
      command.id,
      {
        status: "completed",
        result: appendLine(command.result, "No changes to commit."),
        completedAt: nowIso(),
      },
      "approved_commit_noop",
    );
  }

  await git(["add", "-A"], { cwd: command.worktreePath });
  const subject = `Codex Lark task ${command.id}`;
  const details = (command.normalizedTask || command.prompt || "").slice(0, 500);
  const commit = await git(["commit", "-m", subject, "-m", details], { cwd: command.worktreePath });
  const hash = await git(["rev-parse", "--short", "HEAD"], { cwd: command.worktreePath });
  return queue.update(
    command.id,
    {
      status: "completed",
      result: appendLine(command.result, `Committed ${hash.stdout.trim() || "changes"}.`),
      error: "",
      completedAt: nowIso(),
      commitOutput: commit.stdout || commit.stderr || "",
    },
    "approved_commit_completed",
  );
}

export async function runPushAction({ queue, config, command }) {
  const repo = config.repos?.[command.repoKey] || {};
  const remote = repo.remote || "origin";
  if (!command.branchName) throw new Error(`Task has no branchName: ${command.id}`);
  const pushed = await git(["push", remote, command.branchName], { cwd: command.worktreePath });
  return queue.update(
    command.id,
    {
      status: "completed",
      result: appendLine(command.result, `Pushed ${command.branchName} to ${remote}.`),
      error: "",
      completedAt: nowIso(),
      pushOutput: pushed.stdout || pushed.stderr || "",
    },
    "approved_push_completed",
  );
}

export async function runConfiguredCommand(commandText, { cwd }) {
  const [command, ...args] = splitCommand(commandText);
  if (!command) throw new Error("Configured command is empty");
  try {
    const { stdout, stderr } = await execFileP(command, args, { cwd, maxBuffer: 1024 * 1024 * 4 });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    return {
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout || "",
      stderr: error.stderr || error.message || "",
    };
  }
}

export function splitCommand(commandText) {
  const input = String(commandText || "").trim();
  const parts = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  if (quote) throw new Error("Unclosed quote in configured command");
  return parts;
}

function ensureReadyForAction(command, action) {
  if (!["waiting_review", "completed"].includes(command.status)) {
    throw new Error(`Cannot approve ${action} while task is ${command.status}`);
  }
  if (!command.worktreePath) throw new Error(`Task has no worktreePath: ${command.id}`);
}

async function git(args, { cwd }) {
  try {
    const { stdout, stderr } = await execFileP("git", args, { cwd, maxBuffer: 1024 * 1024 * 4 });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    throw new Error((error.stderr || error.message || "").trim());
  }
}

function summarizeCommand(result) {
  const head = result.exitCode === 0 ? "passed" : `failed (${result.exitCode})`;
  const output = `${result.stdout || ""}${result.stderr ? `\n${result.stderr}` : ""}`.trim();
  const tail = output.length > 2000 ? output.slice(-2000) : output;
  return [`Command ${head}.`, tail].filter(Boolean).join("\n");
}

function appendLine(base, line) {
  return [base, line].filter(Boolean).join("\n");
}
