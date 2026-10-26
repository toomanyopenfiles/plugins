#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePackage, OUTPUT, PiPackageError, reportProblems } from "./lib.mjs";

const root = resolveRoot(process.argv.slice(2));

try {
  const result = generatePackage(root);
  console.log(
    `generated ${OUTPUT}: ${result.pstackSkills} pstack + ${result.bundled} bundled skills, ${result.files} files`,
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
