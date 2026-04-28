#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const GRAY = "\x1b[90m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

console.log(`\n${BOLD}${CYAN}Building letta-teams...${RESET}\n`);

// Run TypeScript compiler
execSync("tsc", { stdio: "inherit" });

// Count compiled files
function countFiles(dir) {
  let count = 0;
  for (const file of readdirSync(dir)) {
    const path = join(dir, file);
    if (statSync(path).isDirectory()) {
      count += countFiles(path);
    } else if (file.endsWith(".js")) {
      count++;
    }
  }
  return count;
}

const fileCount = countFiles("dist");

console.log(`\n${GREEN}✓${RESET} Build complete\n`);
console.log(`  ${GRAY}→${RESET} ${fileCount} files compiled to ${GRAY}dist/${RESET}\n`);
