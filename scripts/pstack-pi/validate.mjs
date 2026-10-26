#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const WORKFLOW = ".github/workflows/pstack-pi-validate.yml";
const CANDIDATE =
  "github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.head.ref == 'pi-candidate'";

/** The section of one job, so checks cannot read a permission from a different job. */
function jobSection(text, name) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start < 0) return null;
  const end = lines.findIndex(
    (line, index) => index > start && (/^\S/.test(line) || /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line)),
  );
  return lines.slice(start, end < 0 ? lines.length : end).join("\n");
}

function permissionEntries(section, indent) {
  const prefix = " ".repeat(indent);
  const lines = section.split("\n");
  const start = lines.findIndex((line) => line === `${prefix}permissions:`);
  if (start < 0) return null;
  const entries = [];
  const pattern = new RegExp(`^ {${indent + 2}}([a-z-]+):\\s*(\\S+)\\s*$`);
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = pattern.exec(lines[index]);
    if (!match) break;
    entries.push([match[1], match[2]]);
  }
  return entries;
}

/** Every shell body, including folded `run: >-` blocks, so an inline expression cannot hide. */
function runBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)run:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const indent = match[1].length;
    const block = [match[2]];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (line.trim() === "") {
        block.push(line);
        continue;
      }
      const lineIndent = /^(\s*)/.exec(line)[1].length;
      if (lineIndent <= indent) break;
      block.push(line);
    }
    blocks.push(block.join("\n"));
  }
  return blocks;
}

/**
 * Static boundary check for the candidate validation workflow. It inspects the checked-in
 * YAML instead of triggering a remote workflow: validation must be read-only, and the only
 * write identity is the App token used by the report job after a head check.
 */
export function workflowBoundaryProblems(text) {
  const problems = [];
  const validate = jobSection(text, "validate");
  const report = jobSection(text, "report");

  if (!/^on:\s*$/m.test(text)) problems.push("workflow has no on block");
  if (!/^  pull_request:\s*$/m.test(text)) problems.push("workflow is not triggered by pull_request");
  if (!/^    branches:\s*\n^      - main\s*$/m.test(text)) problems.push("workflow is not limited to pull requests into main");
  if (/\bpull_request_target\b/.test(text)) problems.push("workflow triggers on pull_request_target");
  if (/\bworkflow_run\b/.test(text)) problems.push("workflow triggers on workflow_run");
  if (/\b(?:upload|download)-artifact\b/.test(text)) {
    problems.push("workflow moves candidate content through artifacts instead of using the candidate branch");
  }
  if (/\bgit\s+push\b/.test(text)) problems.push("workflow executes a git push");
  if (/generate-pstack-harness-trees/.test(text)) problems.push("workflow runs the inherited whole-tree harness generator");
  if (/\bwrite-all\b/.test(text)) problems.push("workflow grants write-all permissions");
  if (!/^permissions: \{\}\s*$/m.test(text)) problems.push("workflow does not declare permissions: {} at the top level");

  for (const [name, section] of [
    ["validation", validate],
    ["report", report],
  ]) {
    if (!section) problems.push(`workflow has no ${name} job`);
    else if (!section.includes(CANDIDATE)) problems.push(`${name} job does not use the candidate head branch condition`);
  }
  if (!validate || !report) return [...new Set(problems)];

  const validatePermissions = permissionEntries(validate, 4);
  if (!validatePermissions) {
    problems.push("validation job has no permissions block");
  } else {
    if (!validatePermissions.some(([key, value]) => key === "contents" && value === "read")) {
      problems.push("validation job does not grant contents: read");
    }
    for (const [key, value] of validatePermissions) {
      if (key !== "contents" || value !== "read") problems.push(`validation job grants ${key}: ${value}`);
    }
  }
  if (!validate.includes("ref: ${{ github.event.pull_request.head.sha }}")) {
    problems.push("validation job does not check out the committed candidate head");
  }
  if (!validate.includes("persist-credentials: false")) problems.push("validation job persists checkout credentials");
  if (/\$\{\{\s*secrets\./.test(validate)) problems.push("validation job receives a repository secret");
  const secretLines = text.split(/\r?\n/).filter((line) => line.includes("${{ secrets."));
  if (secretLines.length !== 1) problems.push("the App private key must be referenced exactly once");
  if (/create-github-app-token/.test(validate)) problems.push("validation job mints the report App token");
  if (/generate\.mjs/.test(validate)) problems.push("validation job runs the package generator");
  if (!validate.includes("node scripts/pstack-pi/check.mjs")) {
    problems.push("validation job does not run the read-only Pi package check");
  }
  if (!validate.includes("node scripts/pstack-pi/test.mjs")) {
    problems.push("validation job does not run the deterministic Pi test entry");
  }

  if (!/^    needs: validate\s*$/m.test(report)) problems.push("report job does not depend on the validation job");
  if (!/^    if: always\(\)/m.test(report)) problems.push("report job does not always run after validation");
  if (!/^    concurrency:\s*$/m.test(report)) problems.push("report job does not serialize report writes");
  if (!report.includes("group: pstack-pi-report-${{ github.event.pull_request.number }}")) {
    problems.push("report job concurrency group is not tied to the pull request");
  }
  const reportPermissions = permissionEntries(report, 4);
  if (!reportPermissions) {
    problems.push("report job has no permissions block");
  } else {
    if (!reportPermissions.some(([key, value]) => key === "contents" && value === "read")) {
      problems.push("report job does not grant contents: read");
    }
    for (const [key, value] of reportPermissions) {
      if (key !== "contents" || value !== "read") problems.push(`report job grants ${key}: ${value} to its workflow token`);
    }
  }
  if (!/uses: actions\/create-github-app-token@v\d+/.test(report)) problems.push("report job does not mint the App token");
  if (!/app-id: \$\{\{ vars\.[A-Za-z0-9_]+ \}\}/.test(report)) {
    problems.push("report job App id must come from repository variables");
  }
  if (!/private-key: \$\{\{ secrets\.[A-Za-z0-9_]+ \}\}/.test(report)) {
    problems.push("report job App private key must come from repository secrets");
  }
  const tokenStep = /^        id: ([A-Za-z0-9_-]+)\s*$/m.exec(report)?.[1];
  if (!tokenStep) problems.push("report job App token step has no id");
  else if (!report.includes(`GH_TOKEN: \${{ steps.${tokenStep}.outputs.token }}`)) {
    problems.push("report job does not pass the App token as GH_TOKEN");
  }
  if (!report.includes("ref: ${{ github.event.pull_request.base.sha }}")) {
    problems.push("report job does not check out the trusted base revision");
  }
  if (report.includes("ref: ${{ github.event.pull_request.head.sha }}")) problems.push("report job checks out the candidate head");
  if (!report.includes("persist-credentials: false")) problems.push("report job persists a checkout credential");
  if (!report.includes("node scripts/pstack-pi/report.mjs")) problems.push("report job does not run the report entry");
  for (const command of ["check.mjs", "test.mjs", "generate.mjs"]) {
    if (report.includes(command)) problems.push("report job runs candidate validation commands");
  }
  if (!report.includes("VALIDATION_RESULT: ${{ needs.validate.result }}")) {
    problems.push("report job does not pass the controlled validation result");
  }

  if (/\$\{\{\s*secrets\./.test(text.replace(report, ""))) problems.push("secrets are used outside the report job");
  if (runBlocks(text).some((block) => block.includes("${{"))) {
    problems.push("a run step interpolates a workflow expression directly");
  }

  return [...new Set(problems)];
}

export function inspectWorkflow(root) {
  try {
    return workflowBoundaryProblems(readFileSync(resolve(root, WORKFLOW), "utf8"));
  } catch {
    return [`missing ${WORKFLOW}`];
  }
}

export function reportProblems(problems) {
  return problems.map((problem) => `FAIL ${problem}`).join("\n");
}

function resolveRoot(args) {
  const index = args.indexOf("--root");
  if (index >= 0) {
    const value = args[index + 1];
    if (!value) {
      console.error("FAIL --root needs a directory");
      process.exit(2);
    }
    return resolve(value);
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = inspectWorkflow(resolveRoot(process.argv.slice(2)));
  if (problems.length > 0) {
    console.error(reportProblems(problems));
    process.exitCode = 1;
  } else {
    console.log(`ok: ${WORKFLOW} keeps validation read-only and writes behind the pstack App token`);
  }
}
