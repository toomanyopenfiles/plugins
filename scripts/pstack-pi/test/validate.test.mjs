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

test("the checked-in validation workflow keeps the read-only validation and trusted report split", () => {
  assert.deepEqual(workflowBoundaryProblems(workflowSource()), []);
});

test("the workflow boundary check runs as a static entry", () => {
  const result = runScript("validate.mjs");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^ok: /);
});

test("the validator requires the pull_request validation entry to stay read-only", () => {
  expectProblem(
    (source) =>
      source.replace(
        "        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n          persist-credentials: false",
        "        with:\n          ref: ${{ github.event.pull_request.head.sha }}",
      ),
    /validation job persists checkout credentials/,
  );
  expectProblem(
    (source) => source.replace("    permissions:\n      contents: read\n    steps:", "    permissions:\n      contents: write\n    steps:"),
    /validation job grants contents: write/,
  );
  expectProblem(
    (source) => source.replace("      - name: Set up Node", "      - name: Leak a secret\n        run: echo ${{ secrets.ANY }}\n\n      - name: Set up Node"),
    /validation job receives a repository secret/,
  );
  expectProblem(
    (source) =>
      source.replace(
        "    permissions:\n      contents: read\n    steps:\n      - name: Check out the committed candidate head",
        "    environment: pstack-pi-write\n    permissions:\n      contents: read\n    steps:\n      - name: Check out the committed candidate head",
      ),
    /validation job must not declare an Environment/,
  );
  expectProblem(
    (source) =>
      source.replace(
        "    permissions:\n      contents: read\n    steps:\n      - name: Check out the committed candidate head",
        "    permissions:\n      contents: read\n    steps:\n      - uses: actions/create-github-app-token@v1\n\n      - name: Check out the committed candidate head",
      ),
    /validation job mints the report App token/,
  );
  expectProblem(
    (source) => source.replace("ref: ${{ github.event.pull_request.head.sha }}", "ref: main"),
    /validation job does not check out the committed candidate head/,
  );
});

test("the validator requires the report entry to come from the trusted workflow_run event", () => {
  expectProblem(
    (source) =>
      source.replace(
        "  workflow_run:\n    workflows:\n      - Validate pstack Pi candidate\n    types:\n      - completed\n",
        "",
      ),
    /workflow does not trigger on workflow_run/,
  );
  expectProblem(
    (source) => source.replace("name: Validate pstack Pi candidate", "name: Renamed validation workflow"),
    /workflow name does not match|workflow_run trigger/,
  );
  expectProblem(
    (source) => source.replace("      - Validate pstack Pi candidate\n", "      - Some other workflow\n"),
    /workflow_run trigger does not name the validation workflow/,
  );
  expectProblem(
    (source) => source.replace("      - completed\n", "      - requested\n"),
    /workflow_run trigger is not limited to completed runs/,
  );
  expectProblem(
    (source) => source.replace("      github.event_name == 'workflow_run' &&\n", ""),
    /report job does not use the trusted workflow_run source/,
  );
  expectProblem(
    (source) => source.replace("      github.event.workflow_run.event == 'pull_request' &&\n", ""),
    /report job does not use the trusted workflow_run source/,
  );
  expectProblem(
    (source) => source.replace("      github.event.workflow_run.path == '.github/workflows/pstack-pi-validate.yml' &&\n", ""),
    /report job does not use the trusted workflow_run source/,
  );
  expectProblem(
    (source) => source.replace("      github.event.workflow_run.head_branch == 'pi-candidate' &&\n", ""),
    /report job does not use the trusted workflow_run source/,
  );
  expectProblem(
    (source) => source.replace("      github.event_name == 'pull_request' &&\n", ""),
    /validation job does not use the candidate pull_request source/,
  );
  expectProblem(
    (source) => source.replace("      github.event.pull_request.head.ref == 'pi-candidate'\n", ""),
    /validation job does not use the candidate pull_request source/,
  );
  expectProblem(
    (source) => source.replace("      - main\n", "      - release\n"),
    /workflow is not limited to pull requests into main/,
  );
  expectProblem(
    (source) => source.replace("      github.event.workflow_run.repository.full_name == github.repository &&\n", ""),
    /report job does not use the trusted workflow_run source/,
  );
  expectProblem(
    (source) => source.replace("      github.event.workflow_run.head_repository.full_name == github.repository &&\n", ""),
    /report job does not use the trusted workflow_run source/,
  );
  expectProblem(
    (source) => source.replace("      github.event.workflow_run.pull_requests[0].base.ref == 'main'\n", ""),
    /report job does not use the trusted workflow_run source/,
  );
  expectProblem(
    (source) => source.replace("    environment: pstack-pi-write", "    needs: validate\n    environment: pstack-pi-write"),
    /report job must not depend on the candidate workflow/,
  );
});

test("the validator requires the report job to declare the protected write Environment", () => {
  expectProblem(
    (source) => source.replace("    environment: pstack-pi-write\n", ""),
    /report job must declare the pstack-pi-write Environment/,
  );
  expectProblem(
    (source) => source.replace("    environment: pstack-pi-write", "    environment: other-environment"),
    /report job must declare the pstack-pi-write Environment/,
  );
});

test("the validator keeps the report job on trusted workflow_run fields and the validation run", () => {
  expectProblem(
    (source) =>
      source.replace(
        "PR_NUMBER: ${{ github.event.workflow_run.pull_requests[0].number }}",
        "PR_NUMBER: ${{ github.event.pull_request.number }}",
      ),
    /report job uses the candidate pull_request event/,
  );
  expectProblem(
    (source) =>
      source.replace(
        "EXPECTED_HEAD: ${{ github.event.workflow_run.pull_requests[0].head.sha }}",
        "EXPECTED_HEAD: ${{ github.event.pull_request.head.sha }}",
      ),
    /report job uses the candidate pull_request event/,
  );
  expectProblem(
    (source) => source.replace("RUN_ID: ${{ github.event.workflow_run.id }}", "RUN_ID: ${{ github.run_id }}"),
    /report job does not use the validation run id/,
  );
  expectProblem(
    (source) => source.replace("RUN_ATTEMPT: ${{ github.event.workflow_run.run_attempt }}", "RUN_ATTEMPT: ${{ github.run_attempt }}"),
    /report job does not use the validation run attempt/,
  );
  expectProblem(
    (source) => source.replace("VALIDATION_RESULT: ${{ github.event.workflow_run.conclusion }}", "VALIDATION_RESULT: ${{ needs.validate.result }}"),
    /report job does not use the workflow_run conclusion/,
  );
  expectProblem(
    (source) =>
      source.replace(
        "RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.event.workflow_run.id }}",
        "RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
      ),
    /report job log link is not the validation run/,
  );
  expectProblem(
    (source) =>
      source.replace(
        "SOURCE_REPO: ${{ github.event.workflow_run.head_repository.full_name }}",
        "SOURCE_REPO: ${{ github.event.pull_request.head.repo.full_name }}",
      ),
    /report job uses the candidate pull_request event/,
  );
  for (const flag of ["--repo", "--pr", "--head", "--outcome", "--source-event", "--source-branch", "--source-base", "--source-repo", "--source-workflow", "--run-id", "--run-attempt", "--run-url"]) {
    expectProblem((source) => source.replace(`          ${flag} "$`, `          $`), /does not pass/);
  }
});

test("the validator rejects a report job that checks out or runs candidate content", () => {
  expectProblem(
    (source) => source.replace("ref: main", "ref: ${{ github.event.workflow_run.pull_requests[0].head.sha }}"),
    /report job does not check out trusted main/,
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
  expectProblem(
    (source) =>
      source.replace(
        "      - name: Set up Node",
        "      - uses: actions/upload-artifact@v4\n        with:\n          path: .\n\n      - name: Set up Node",
      ),
    /artifact/,
  );
  expectProblem((source) => source.replace("node scripts/pstack-pi/report.mjs", "git push origin HEAD && node scripts/pstack-pi/report.mjs"), /git push/);
});

test("the validator rejects a report job that grants its workflow token write access or misuses the App", () => {
  expectProblem(
    (source) =>
      source.replace(
        "    permissions:\n      contents: read\n    steps:\n      - name: Mint the pstack report App token",
        "    permissions:\n      contents: read\n      issues: write\n    steps:\n      - name: Mint the pstack report App token",
      ),
    /report job grants issues: write to its workflow token/,
  );
  expectProblem(
    (source) => source.replace("        uses: actions/create-github-app-token@v1\n", ""),
    /report job does not mint the App token/,
  );
  expectProblem(
    (source) => source.replace("vars.PSTACK_PI_APP_ID", "vars.ANOTHER_APP_ID"),
    /report job App id must be the shared PSTACK_PI_APP_ID/,
  );
  expectProblem(
    (source) => source.replace("secrets.PSTACK_PI_APP_PRIVATE_KEY", "secrets.ANOTHER_APP_PRIVATE_KEY"),
    /report job App private key must be the shared PSTACK_PI_APP_PRIVATE_KEY/,
  );
  expectProblem(
    (source) =>
      source.replace(
        "          GH_TOKEN: ${{ steps.report-token.outputs.token }}",
        "          GH_TOKEN: ${{ secrets.PSTACK_PI_APP_PRIVATE_KEY }}",
      ),
    /App private key must be referenced exactly once/,
  );
});

test("the validator rejects a report path without concurrency or the report entry", () => {
  expectProblem(
    (source) =>
      source.replace(
        "    concurrency:\n      group: pstack-pi-report-${{ github.event.workflow_run.pull_requests[0].number }}\n      cancel-in-progress: false\n",
        "",
      ),
    /report job does not serialize report writes/,
  );
  expectProblem(
    (source) => source.replace("      group: pstack-pi-report-${{ github.event.workflow_run.pull_requests[0].number }}", "      group: pstack-pi-report"),
    /report job concurrency group is not tied to the candidate pull request/,
  );
  expectProblem(
    (source) => source.replace("      cancel-in-progress: false", "      cancel-in-progress: true"),
    /report job can cancel an in-flight report write/,
  );
  expectProblem((source) => source.replace("node scripts/pstack-pi/report.mjs", ""), /report job does not run the report entry/);
  expectProblem(
    (source) =>
      source.replace(
        "      - name: Mint the pstack report App token",
        "      - name: Extra report command\n        run: echo extra\n\n      - name: Mint the pstack report App token",
      ),
    /report job must have exactly one run step/,
  );
});

test("the validator rejects shell interpolation and a write-capable validation command", () => {
  expectProblem(
    (source) => source.replace("          node scripts/pstack-pi/report.mjs", "          echo ${{ github.event.workflow_run.display_title }}\n          node scripts/pstack-pi/report.mjs"),
    /run step interpolates a workflow expression directly/,
  );
  expectProblem(
    (source) =>
      source.replace(
        "      - name: Check the committed Pi package without writing\n        run: node scripts/pstack-pi/check.mjs",
        "      - name: Regenerate the candidate branch\n        run: node scripts/pstack-pi/generate.mjs",
      ),
    /validation job does not run the read-only Pi package check|validation job.*generate/,
  );
  expectProblem((source) => source.replace("on:\n", "on:\n  pull_request_target:\n"), /pull_request_target/);
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

test("the README documents local installation, the trusted report boundary, and what was not run", () => {
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
    /workflow_run/,
    /pstack-pi-write/,
    /deployment branch policy/,
    /`main` only/,
    /PSTACK_PI_APP_ID/,
    /PSTACK_PI_APP_PRIVATE_KEY/,
    /PSTACK_PI_SYNC_APP_ID/,
    /same App/,
    /contents write permission/,
    /repository or organization level/,
    /not a substitute/,
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
