#!/usr/bin/env bun

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_FILE_LINES = 300;
const MAX_FUNC_LINES = 50;
const MAX_POSITIONAL_PARAMS = 3;

const SRC_DIR = join(import.meta.dirname, '..', 'packages');

let violations = 0;

function* walkTsFiles(dir) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full, { throwIfNoEntry: false });
    if (!s) continue;
    if (s.isDirectory() && entry !== 'node_modules' && entry !== 'dist') {
      yield* walkTsFiles(full);
    } else if (s.isFile() && (entry.endsWith('.ts') || entry.endsWith('.mjs'))) {
      yield full;
    }
  }
}

function reportFileTooLarge(file, lines) {
  if (lines > MAX_FILE_LINES) {
    console.log(`FILE_TOO_LARGE: ${file} (${lines} lines, max ${MAX_FILE_LINES})`);
    violations++;
  }
}

function analyzeFunctions(filePath, lines) {
  const isTestFile = filePath.endsWith('.test.ts');
  const report = (line, name, msg) => {
    if (!isTestFile) {
      console.log(`${msg}: ${filePath}:${line} — ${name}`);
      violations++;
    }
  };

  // Track function boundaries using brace depth
  const funcStartRe = /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/;
  const arrowFuncRe = /^\s*(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let match = line.match(funcStartRe);
    let funcName = null;

    if (match) {
      funcName = match[1];
    } else {
      match = line.match(arrowFuncRe);
      if (match) {
        funcName = match[1];
        // Check param count for arrow functions at declaration
        const paramStr = (line.match(/\(([^)]*)\)/) || ['', ''])[1];
        const paramCount = paramStr.trim() ? paramStr.split(',').filter(p => p.trim()).length : 0;
        if (paramCount > MAX_POSITIONAL_PARAMS && !paramStr.includes('{')) {
          report(i + 1, funcName, `TOO_MANY_PARAMS (${paramCount})`);
        }
      }
    }

    if (funcName) {
      // Count brace depth to find function end
      let braceDepth = 0;
      let started = false;
      let j = i;
      let funcLines = 0;

      while (j < lines.length) {
        const l = lines[j];
        for (const ch of l) {
          if (ch === '{') { braceDepth++; started = true; }
          if (ch === '}') { braceDepth--; }
        }
        if (started && braceDepth === 0) {
          funcLines = j - i + 1;
          break;
        }
        j++;
      }

      if (funcLines > MAX_FUNC_LINES) {
        report(i + 1, funcName, `FUNC_TOO_LONG (${funcLines} lines)`);
      }

      // Check positional params at declaration
      if (match) { // was a regular function
        const declLine = line;
        const paramMatch = declLine.match(/function\s+\w+\s*\(([^)]*)\)/);
        if (paramMatch) {
          const paramStr = paramMatch[1];
          if (paramStr.trim() && !paramStr.includes('{') && !paramStr.includes('...')) {
            const params = paramStr.split(',').filter(p => p.trim());
            if (params.length > MAX_POSITIONAL_PARAMS) {
              report(i + 1, funcName, `TOO_MANY_PARAMS (${params.length})`);
            }
          }
        }
      }

      i = j + 1;
    } else {
      i++;
    }
  }
}

console.log('=== Code Metrics Check ===\n');

let filesScanned = 0;
for (const file of walkTsFiles(SRC_DIR)) {
  filesScanned++;
  const content = readFileSync(file, 'utf-8');
  const lines = content.split('\n');
  const relPath = file.replace(join(import.meta.dirname, '..') + '/', '');

  reportFileTooLarge(relPath, lines.length);
  analyzeFunctions(file, lines);
}

console.log(`\nScanned ${filesScanned} files.`);
console.log(`Total violations: ${violations}`);
if (violations > 0) {
  process.exit(1);
}
