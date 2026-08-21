/**
 * Verifies every named import in the module resolves to a real export.
 *
 * A patch that silently fails to insert a function leaves an import dangling,
 * which breaks the entire ES module graph at load time — Foundry just shows the
 * module as inactive with no obvious cause. Catching it here is far cheaper.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = path.join(root, 'scripts');

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.js') ? [full] : [];
  });
}

/** Named exports declared by a file. */
function exportsOf(source) {
  const names = new Set();
  for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_$]+)/gm)) {
    names.add(m[1]);
  }
  for (const m of source.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/gm)) {
    names.add(m[1]);
  }
  // export { a, b as c }
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/** Relative named imports made by a file. */
function importsOf(source) {
  const found = [];
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const names = m[1]
      .split(',')
      .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    found.push({ names, from: m[2] });
  }
  return found;
}

const files = walk(scripts);
const exportCache = new Map();
let failed = 0;
let checked = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const { names, from } of importsOf(source)) {
    const target = path.resolve(path.dirname(file), from);
    if (!exportCache.has(target)) {
      let targetSource;
      try {
        targetSource = readFileSync(target, 'utf8');
      } catch {
        failed = 1;
        console.error(`FAIL ${path.relative(root, file)} imports missing file ${from}`);
        exportCache.set(target, new Set());
        continue;
      }
      exportCache.set(target, exportsOf(targetSource));
    }
    const available = exportCache.get(target);
    for (const name of names) {
      checked += 1;
      if (!available.has(name)) {
        failed = 1;
        console.error(
          `FAIL ${path.relative(root, file)} imports "${name}" from ${from}, which does not export it`,
        );
      }
    }
  }
}

if (!failed) console.log(`ok  ${checked} named imports across ${files.length} files all resolve`);

/*
 * Catch a helper that is used but never imported.
 *
 * Resolving imports is not enough: a forgotten import line leaves the
 * identifier simply undefined, which only fails at runtime, in Foundry, as a
 * ReferenceError deep inside a click handler.
 */
const exportedBy = new Map();
for (const [file, names] of exportCache) {
  for (const name of names) if (!exportedBy.has(name)) exportedBy.set(name, file);
}
/** Strip comments and string literals: prose is not a use of a binding. */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

for (const file of files) {
  const source = codeOnly(readFileSync(file, 'utf8'));
  const imported = new Set(
    importsOf(readFileSync(file, 'utf8')).flatMap(({ names }) => names),
  );
  // Anything declared locally is obviously not a missing import.
  const declared = new Set([
    ...[...source.matchAll(/(?:function|class)\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1]),
    ...[...source.matchAll(/(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1]),
    ...exportsOf(source),
  ]);

  for (const [name, from] of exportedBy) {
    if (from === file || imported.has(name) || declared.has(name)) continue;
    // Only flag a real bare reference. A preceding dot or quote means it is a
    // property access or part of a string such as 'PFAI.Influence.Tab', not a
    // use of the imported binding.
    if (!new RegExp(`(?<![.\\w'"\`])${name}\\s*[(.]`).test(source)) continue;
    failed = 1;
    console.error(
      `FAIL ${path.relative(root, file)} uses "${name}" but never imports it (exported by ${path.relative(root, from)})`,
    );
  }
}

/*
 * ApplicationV2 registers actions by referencing private static methods. If one
 * is registered but never defined, the class body itself is a SyntaxError and
 * the whole module fails to load — so check the two lists agree.
 */
let actionsChecked = 0;
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const defined = new Set(
    [...source.matchAll(/static\s+(?:async\s+)?(#on[A-Za-z0-9_$]+)\s*\(/g)].map((m) => m[1]),
  );
  const registered = new Set(
    [...source.matchAll(/:\s*[A-Za-z0-9_$]+\.(#on[A-Za-z0-9_$]+)\s*,/g)].map((m) => m[1]),
  );
  for (const name of registered) {
    actionsChecked += 1;
    if (!defined.has(name)) {
      failed = 1;
      console.error(`FAIL ${path.relative(root, file)} registers action ${name} but never defines it`);
    }
  }
  // A handler nobody can reach is dead weight worth knowing about.
  for (const name of defined) {
    if (!registered.has(name) && !source.includes(`${name}(`)) {
      console.warn(`warn ${path.relative(root, file)} defines ${name} but nothing references it`);
    }
  }
}
if (!failed) console.log(`ok  ${actionsChecked} registered actions all have handlers`);
else console.error(`\nFAILED - fix the above before anything else; a dangling import disables the whole module.`);

process.exit(failed);
