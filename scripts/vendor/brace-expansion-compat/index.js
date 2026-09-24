/*
 * brace-expansion compatibility shim (CommonJS entry).
 *
 * WHY THIS EXISTS
 * ---------------
 * GHSA-mh99-v99m-4gvg (high, CWE-400/770: unbounded expansion -> OOM) affects
 * brace-expansion <= 5.0.7. Only 5.0.8 is patched, so the repo pins every copy
 * to 5.0.8 via package.json `overrides`.
 *
 * But 5.0.8 is an ESM-first rewrite whose CommonJS build exports an OBJECT
 * ({ expand, EXPANSION_MAX, EXPANSION_MAX_LENGTH }), while minimatch@3 -- still
 * bundled by eslint, @eslint/config-array, @eslint/eslintrc, eslint-plugin-*,
 * and glob -- does `var expand = require('brace-expansion')` and then CALLS it.
 * That mismatch is what produced `TypeError: expand is not a function` and broke
 * eslint repo-wide.
 *
 * This shim resolves both constraints: it delegates 100% of the logic to the
 * patched 5.0.8 implementation (aliased as brace-expansion-upstream) while
 * presenting the legacy callable API. Downgrading to a callable 1.x/2.x instead
 * would reintroduce the advisory, since no release below 5.0.8 is patched.
 */

// This file MUST be CommonJS: it is the `require` target that minimatch@3 loads.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const upstream = require("brace-expansion-upstream");

function expand(...args) {
  return upstream.expand(...args);
}

// Re-expose the named surface (expand, EXPANSION_MAX, EXPANSION_MAX_LENGTH) on
// the callable so both `require(...)(str)` and `require(...).expand(str)` work.
Object.assign(expand, upstream);
expand.default = expand;

module.exports = expand;
