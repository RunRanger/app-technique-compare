#!/usr/bin/env node
/**
 * Verifies that every native dependency matches the version Expo ships for this
 * SDK, as recorded in `expo/bundledNativeModules.json`.
 *
 * This exists because a mismatched native package does not fail to install, does
 * not fail to typecheck, and does not fail to bundle — it fails at runtime on
 * device with a `NoClassDefFoundError` deep inside the Expo module registry,
 * which takes the whole app down before the first screen renders. A package
 * whose major version does not track the SDK (an SDK-53-era `expo-image-picker`
 * against SDK 57, say) is exactly that trap.
 *
 * `npx expo install` normally prevents this by resolving versions from Expo's
 * API. Where that API is unreachable and versions are pinned by hand, this is
 * the check that replaces it.
 *
 * Exits non-zero on any mismatch.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const bundled = require('expo/bundledNativeModules.json');
const pkg = require('../package.json');

const declared = { ...pkg.dependencies, ...pkg.devDependencies };

/** Leading major version, ignoring a `~` or `^` range prefix. */
const major = (version) => String(version).replace(/^[~^]/, '').split('.')[0];

const rows = [];
let mismatches = 0;

for (const [name, range] of Object.entries(declared)) {
  const expected = bundled[name];
  // Not in the list means Expo does not pin it — a pure-JS library. Skip.
  if (!expected) continue;

  let installed;
  try {
    installed = require(`${name}/package.json`).version;
  } catch {
    installed = null;
  }

  // Both have to line up, for different reasons:
  //  - the installed version is what actually runs on device right now;
  //  - the declared range is what a fresh `npm install` elsewhere would resolve,
  //    so a wrong range is a mismatch waiting to happen on someone else's
  //    machine or in CI even while the local tree is fine.
  const installedOk = installed != null && major(expected) === major(installed);
  const declaredOk = major(expected) === major(range);
  const ok = installedOk && declaredOk;
  if (!ok) mismatches++;
  rows.push({
    name,
    expected,
    declared: range,
    installed: installed ?? 'not installed',
    ok,
    installedOk,
    declaredOk,
  });
}

const width = Math.max(...rows.map((row) => row.name.length), 4);
for (const row of rows) {
  const mark = row.ok ? '  ok  ' : '  FAIL';
  const why = row.ok
    ? ''
    : `   <- ${[!row.declaredOk && 'package.json range', !row.installedOk && 'installed version']
        .filter(Boolean)
        .join(' and ')} wrong`;
  console.log(
    `${mark}  ${row.name.padEnd(width)}  expected ${String(row.expected).padEnd(12)} declared ${String(row.declared).padEnd(12)} installed ${row.installed}${why}`
  );
}

if (mismatches > 0) {
  console.error(
    `\n${mismatches} dependency/dependencies do not match Expo SDK ${major(pkg.dependencies.expo)}.\n` +
      `Fix with:  npx expo install <package>\n` +
      `or pin the version shown as "expected" above.\n` +
      `A mismatch here surfaces as a runtime NoClassDefFoundError on device, not a build error.`
  );
  process.exit(1);
}

console.log(`\nAll ${rows.length} native dependencies match Expo SDK ${major(pkg.dependencies.expo)}.`);
