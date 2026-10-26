#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPackage, OUTPUT, PiPackageError, reportProblems } from "./lib.mjs";

const root = resolveRoot(process.argv.slice(2));

try {
  const result = inspectPackage(root);
  if (result.problems.length > 0) {
    console.error(reportProblems(result.problems.slice(0, 40)));
    if (result.problems.length > 40) console.error(`... and ${result.problems.length - 40} more problems`);
    process.exit(1);
  }
  console.log(
    `ok: ${result.pstackSkills} pstack + ${result.bundled} bundled skills, ${result.agents} agents, ${result.files} files, no drift`,
  );
} catch (error) {
  if (error instanceof PiPackageError) {
    console.error(reportProblems(error.problems));
  } else {
    console.error(`FAIL ${error.message}`);
  }
  process.exit(1);
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
