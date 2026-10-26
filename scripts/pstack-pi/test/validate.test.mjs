import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { repoRoot, runScript } from "./helpers.mjs";
import { WORKFLOW, workflowBoundaryProblems } from "../validate.mjs";

function workflowSource() {
  return readFileSync(join(repoRoot, WORKFLOW), "utf8");
}

function expectProblem(mutate, pattern) {
  const source = workflowSource();
  const mutated = mutate(source);
  assert.notEqual(mutated, source, "the mutation did not change the workflow");
  const problems = workflowBoundaryProblems(mutated);
  assert.ok(
    problems.some((problem) => pattern.test(problem)),
    `expected a problem matching ${pattern}; got ${JSON.stringify(problems)}`,
  );
}

test("the checked-in validation workflow keeps the read-only validation and write-only report split", () => {
  assert.deepEqual(workflowBoundaryProblems(workflowSource()), []);
});

test("the workflow boundary check runs as a static entry", () => {
  const result = runScript("validate.mjs");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^ok: /);
});

test("the validator rejects a candidate checkout with persisted credentials", () => {
  expectProblem(
    (source) =>
      source.replace(
        "        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n          persist-credentials: false",
        "        with:\n          ref: ${{ github.event.pull_request.head.sha }}",
      ),
    /validation job persists checkout credentials/,
  );
});

test("the validator rejects validation writes and secrets", () => {
  expectProblem(
    (source) => source.replace("    permissions:\n      contents: read\n    steps:", "    permissions:\n      contents: write\n    steps:"),
    /validation job grants contents: write/,
  );
  expectProblem(
    (source) => source.replace("      - name: Set up Node", "      - name: Leak a secret\n        run: echo ${{ secrets.ANY }}\n\n      - name: Set up Node"),
    /validation job receives a repository secret/,
  );
});

test("the validator rejects pull_request_target and artifact uploads", () => {
  expectProblem((source) => source.replace("on:\n", "on:\n  pull_request_target:\n"), /pull_request_target/);
  expectProblem(
    (source) =>
      source.replace(
        "      - name: Set up Node",
        "      - uses: actions/upload-artifact@v4\n        with:\n          path: .\n\n      - name: Set up Node",
      ),
    /artifact/,
  );
});

test("the validator rejects a report job that checks out or runs the candidate", () => {
  expectProblem(
    (source) => source.replace("ref: ${{ github.event.pull_request.base.sha }}", "ref: ${{ github.event.pull_request.head.sha }}"),
    /report job checks out the candidate head/,
  );
  expectProblem(
    (source) =>
      source.replace(
        "node scripts/pstack-pi/report.mjs",
        "node scripts/pstack-pi/check.mjs && node scripts/pstack-pi/report.mjs",
      ),
    /report job runs candidate validation commands/,
  );
  expectProblem(
    (source) =>
      source.replace("node scripts/pstack-pi/report.mjs", "node scripts/generate-pstack-harness-trees.mjs --check && node scripts/pstack-pi/report.mjs"),
    /harness generator/,
  );
});

test("the validator rejects a report job that grants its own token write access", () => {
  expectProblem(
    (source) =>
      source.replace(
        "    permissions:\n      contents: read\n    steps:\n      - name: Mint the pstack report App token",
        "    permissions:\n      contents: read\n      issues: write\n    steps:\n      - name: Mint the pstack report App token",
      ),
    /report job grants issues: write to its workflow token/,
  );
});

test("the validator rejects a report path without the App identity or controlled result", () => {
  expectProblem(
    (source) => source.replace("        uses: actions/create-github-app-token@v1\n", ""),
    /report job does not mint the App token/,
  );
  expectProblem(
    (source) => source.replace("VALIDATION_RESULT: ${{ needs.validate.result }}", "VALIDATION_RESULT: success"),
    /controlled validation result/,
  );
  expectProblem(
    (source) =>
      source.replace(
        "          GH_TOKEN: ${{ steps.report-token.outputs.token }}",
        "          GH_TOKEN: ${{ secrets.PSTACK_PI_APP_PRIVATE_KEY }}",
      ),
    /App private key must be referenced exactly once/,
  );
  expectProblem((source) => source.replace("    needs: validate\n", ""), /report job does not depend on the validation job/);
  expectProblem((source) => source.replace("if: always() &&", "if:"), /report job does not always run/);
  expectProblem(
    (source) =>
      source.replace(
        "    concurrency:\n      group: pstack-pi-report-${{ github.event.pull_request.number }}\n      cancel-in-progress: false\n",
        "",
      ),
    /report job does not serialize report writes/,
  );
});

test("the validator rejects shell interpolation and a write-capable validation command", () => {
  expectProblem(
    (source) => source.replace("          node scripts/pstack-pi/report.mjs", "          echo ${{ github.event.pull_request.title }}\n          node scripts/pstack-pi/report.mjs"),
    /run step interpolates a workflow expression directly/,
  );
  expectProblem((source) => source.replace("node scripts/pstack-pi/report.mjs", "git push origin HEAD && node scripts/pstack-pi/report.mjs"), /git push/);
  expectProblem(
    (source) =>
      source.replace(
        "      - name: Check the committed Pi package without writing\n        run: node scripts/pstack-pi/check.mjs",
        "      - name: Regenerate the candidate branch\n        run: node scripts/pstack-pi/generate.mjs",
      ),
    /validation job does not run the read-only Pi package check|validation job.*generate/,
  );
});

test("the report entry has no way to start a process or evaluate candidate text", () => {
  const source = readFileSync(join(repoRoot, "scripts", "pstack-pi", "report.mjs"), "utf8");
  for (const pattern of [
    /node:child_process/,
    /\bspawn(?:Sync)?\s*\(/,
    /(?<![.\w])exec(?:File|FileSync|Sync)?\s*\(/,
    /\beval\s*\(/,
    /\bnew Function\b/,
    /\bimport\s*\(/,
  ]) {
    assert.doesNotMatch(source, pattern, `report.mjs matches ${pattern}`);
  }
});

test("the README documents local installation, the report boundary, and what was not run", () => {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  for (const pattern of [
    /## Pi candidate package/,
    /absolute path/,
    /"packages":/,
    /pi-candidate/,
    /git pull/,
    /Restart Pi/,
    /new session/,
    /merge it into `main` by hand/,
    /does not publish npm/,
    /second Pi configuration/,
    /stable\/candidate switcher/,
    /`pstack-pi-validate\.yml`/,
    /link to the Actions run/,
    /PSTACK_PI_APP_ID/,
    /PSTACK_PI_APP_PRIVATE_KEY/,
    /current head again/,
    /stale run cannot overwrite/,
    /did not install the App/,
    /generate-pstack-harness-trees\.mjs --check/,
    /poteto-mode/,
    /how or interrogate/,
    /reflect/,
    /nested or isolated write task/,
    /MCP connectivity/,
    /none is an acceptance condition/,
  ]) {
    assert.match(readme, pattern);
  }
});
