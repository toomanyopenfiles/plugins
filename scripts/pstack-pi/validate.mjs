#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const WORKFLOW = ".github/workflows/pstack-pi-validate.yml";
export const WORKFLOW_NAME = "Validate pstack Pi candidate";
export const WRITE_ENVIRONMENT = "pstack-pi-write";

const PULL_REQUEST_SOURCE = [
  "github.event_name == 'pull_request'",
  "github.event.pull_request.head.repo.full_name == github.repository",
  "github.event.pull_request.head.ref == 'pi-candidate'",
];
const WORKFLOW_RUN_SOURCE = [
  "github.event_name == 'workflow_run'",
  "github.event.workflow_run.event == 'pull_request'",
  "github.event.workflow_run.head_branch == 'pi-candidate'",
  `github.event.workflow_run.path == '${WORKFLOW}'`,
  "github.event.workflow_run.repository.full_name == github.repository",
  "github.event.workflow_run.head_repository.full_name == github.repository",
  "github.event.workflow_run.pull_requests[0].base.ref == 'main'",
];

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

/** One trigger block under `on:`. */
function triggerSection(text, name) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start < 0) return null;
  const end = lines.findIndex(
    (line, index) => index > start && (/^\S/.test(line) || /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line)),
  );
  return lines.slice(start, end < 0 ? lines.length : end).join("\n");
}

/** Values in a YAML list nested one level under a trigger key. */
function listValues(section, key) {
  const lines = section.split("\n");
  const start = lines.findIndex((line) => line === `    ${key}:`);
  if (start < 0) return null;
  const values = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = /^      - (.*)$/.exec(lines[index]);
    if (!match) break;
    values.push(match[1].trim());
  }
  return values;
}

function sameList(actual, expected) {
  return actual !== null && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function compact(text) {
  return text.replace(/\s+/g, " ").trim();
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
 * YAML instead of triggering a remote workflow: the pull_request path validates with a
 * read-only token, and write access stays in a workflow_run report job behind the protected
 * pstack-pi-write Environment.
 */
export function workflowBoundaryProblems(text) {
  const problems = [];
  const validate = jobSection(text, "validate");
  const report = jobSection(text, "report");
  const compactValidate = validate ? compact(validate) : "";
  const compactReport = report ? compact(report) : "";

  if (!/^on:\s*$/m.test(text)) problems.push("workflow has no on block");
  if (!new RegExp(`^name: ${WORKFLOW_NAME}\\s*$`, "m").test(text)) {
    problems.push("workflow name does not match the workflow_run trigger");
  }

  const pullRequest = triggerSection(text, "pull_request");
  if (!pullRequest) {
    problems.push("workflow does not trigger on pull_request");
  } else {
    if (!sameList(listValues(pullRequest, "branches"), ["main"])) {
      problems.push("workflow is not limited to pull requests into main");
    }
    const types = listValues(pullRequest, "types") ?? [];
    for (const type of ["opened", "synchronize"]) {
      if (!types.includes(type)) problems.push(`pull_request trigger does not include ${type}`);
    }
  }

  const workflowRun = triggerSection(text, "workflow_run");
  if (!workflowRun) {
    problems.push("workflow does not trigger on workflow_run");
  } else {
    if (!sameList(listValues(workflowRun, "workflows"), [WORKFLOW_NAME])) {
      problems.push("workflow_run trigger does not name the validation workflow");
    }
    if (!sameList(listValues(workflowRun, "types"), ["completed"])) {
      problems.push("workflow_run trigger is not limited to completed runs");
    }
  }

  if (/\bpull_request_target\b/.test(text)) problems.push("workflow triggers on pull_request_target");
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
  }
  if (!validate || !report) return [...new Set(problems)];

  for (const term of PULL_REQUEST_SOURCE) {
    if (!compactValidate.includes(term)) {
      problems.push("validation job does not use the candidate pull_request source");
      break;
    }
  }
  if (/^    environment:/m.test(validate)) problems.push("validation job must not declare an Environment");
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
  if (/create-github-app-token/.test(validate)) problems.push("validation job mints the report App token");
  if (/generate\.mjs/.test(validate)) problems.push("validation job runs the package generator");
  if (!validate.includes("node scripts/pstack-pi/check.mjs")) {
    problems.push("validation job does not run the read-only Pi package check");
  }
  if (!validate.includes("node scripts/pstack-pi/test.mjs")) {
    problems.push("validation job does not run the deterministic Pi test entry");
  }

  for (const term of WORKFLOW_RUN_SOURCE) {
    if (!compactReport.includes(term)) {
      problems.push("report job does not use the trusted workflow_run source");
      break;
    }
  }
  if (compactReport.includes("github.event.pull_request")) {
    problems.push("report job uses the candidate pull_request event");
  }
  if (/^    needs:/m.test(report)) problems.push("report job must not depend on the candidate workflow job");
  if (!new RegExp(`^    environment: ${WRITE_ENVIRONMENT}\\s*$`, "m").test(report)) {
    problems.push(`report job must declare the ${WRITE_ENVIRONMENT} Environment`);
  }
  if (!/^    concurrency:\s*$/m.test(report)) problems.push("report job does not serialize report writes");
  if (!report.includes("group: pstack-pi-report-${{ github.event.workflow_run.pull_requests[0].number }}")) {
    problems.push("report job concurrency group is not tied to the candidate pull request");
  }
  if (!/^      cancel-in-progress: false\s*$/m.test(report)) {
    problems.push("report job can cancel an in-flight report write");
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
  if (!report.includes("app-id: ${{ vars.PSTACK_PI_APP_ID }}")) {
    problems.push("report job App id must be the shared PSTACK_PI_APP_ID");
  }
  if (!report.includes("private-key: ${{ secrets.PSTACK_PI_APP_PRIVATE_KEY }}")) {
    problems.push("report job App private key must be the shared PSTACK_PI_APP_PRIVATE_KEY");
  }
  const tokenStep = /^        id: ([A-Za-z0-9_-]+)\s*$/m.exec(report)?.[1];
  if (!tokenStep) problems.push("report job App token step has no id");
  else if (!report.includes(`GH_TOKEN: \${{ steps.${tokenStep}.outputs.token }}`)) {
    problems.push("report job does not pass the App token as GH_TOKEN");
  }
  if (!/^          ref: main\s*$/m.test(report)) {
    problems.push("report job does not check out trusted main");
  }
  if (!report.includes("persist-credentials: false")) problems.push("report job persists a checkout credential");
  if (!report.includes("node scripts/pstack-pi/report.mjs")) problems.push("report job does not run the report entry");
  if (runBlocks(report).length !== 1) problems.push("report job must have exactly one run step");
  for (const command of ["check.mjs", "test.mjs", "generate.mjs"]) {
    if (report.includes(command)) problems.push("report job runs candidate validation commands");
  }

  const controlledFields = [
    ["PR_NUMBER", "github.event.workflow_run.pull_requests[0].number"],
    ["EXPECTED_HEAD", "github.event.workflow_run.head_sha"],
    ["SOURCE_EVENT", "github.event.workflow_run.event"],
    ["SOURCE_BRANCH", "github.event.workflow_run.head_branch"],
    ["SOURCE_BASE", "github.event.workflow_run.pull_requests[0].base.ref"],
    ["SOURCE_REPO", "github.event.workflow_run.head_repository.full_name"],
    ["SOURCE_WORKFLOW", "github.event.workflow_run.path"],
    ["RUN_ID", "github.event.workflow_run.id"],
    ["RUN_ATTEMPT", "github.event.workflow_run.run_attempt"],
    ["VALIDATION_RESULT", "github.event.workflow_run.conclusion"],
  ];
  for (const [field, expression] of controlledFields) {
    if (!report.includes(`${field}: \${{ ${expression} }}`)) {
      const message = {
        EXPECTED_HEAD: "report job does not use the source run head",
        RUN_ID: "report job does not use the validation run id",
        RUN_ATTEMPT: "report job does not use the validation run attempt",
        VALIDATION_RESULT: "report job does not use the workflow_run conclusion",
      }[field];
      problems.push(message ?? `report job does not consume trusted ${field}`);
    }
  }
  const runUrl =
    "RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.event.workflow_run.id }}";
  if (!report.includes(runUrl)) problems.push("report job log link is not the validation run");

  if (report.includes("github.event.workflow_run.pull_requests[0].head.sha")) {
    problems.push("report job attributes the result to the mutable pull request association head");
  }

  const flags = [
    '--repo "$GITHUB_REPOSITORY"',
    '--pr "$PR_NUMBER"',
    '--head "$EXPECTED_HEAD"',
    '--outcome "$VALIDATION_RESULT"',
    '--source-event "$SOURCE_EVENT"',
    '--source-branch "$SOURCE_BRANCH"',
    '--source-base "$SOURCE_BASE"',
    '--source-repo "$SOURCE_REPO"',
    '--source-workflow "$SOURCE_WORKFLOW"',
    '--run-id "$RUN_ID"',
    '--run-attempt "$RUN_ATTEMPT"',
    '--run-url "$RUN_URL"',
  ];
  for (const flag of flags) {
    if (!report.includes(flag)) problems.push(`report entry does not pass ${flag.split(" ")[0]}`);
  }

  const secretLines = text.split(/\r?\n/).filter((line) => line.includes("${{ secrets."));
  if (secretLines.length !== 1) problems.push("the App private key must be referenced exactly once");
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
    console.log(
      `ok: ${WORKFLOW} keeps pull_request validation read-only and the report on the trusted workflow_run/Environment path`,
    );
  }
}
