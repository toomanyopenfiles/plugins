#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const failures = [];

runNodeTest("existing pstack deterministic tests", pstackTests());
runNodeTest("Pi package regressions", piTests());
runCommand("read-only generated package check", [join("scripts", "pstack-pi", "check.mjs")]);

if (failures.length > 0) {
  console.error(`\npstack-pi suite failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\npstack-pi suite passed");

function runNodeTest(label, files) {
  if (files.length === 0) {
    console.error(`FAIL ${label}: no test files found`);
    failures.push(label);
    return;
  }
  runCommand(label, ["--test", ...files]);
}

function runCommand(label, args) {
  console.log(`\n== ${label}`);
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", timeout: 600_000 });
  if (result.status !== 0) failures.push(label);
}

function pstackTests() {
  const skills = join(root, "pstack", "skills");
  if (!existsSync(skills)) return [];
  return readdirSync(skills, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const dir = join(skills, entry.name, "scripts", "test");
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((name) => name.endsWith(".test.mjs"))
        .map((name) => join("pstack", "skills", entry.name, "scripts", "test", name));
    })
    .sort();
}

function piTests() {
  const dir = join(root, "scripts", "pstack-pi", "test");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => join("scripts", "pstack-pi", "test", name))
    .sort();
}
