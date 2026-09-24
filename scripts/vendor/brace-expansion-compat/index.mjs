/*
 * brace-expansion compatibility shim (ESM entry).
 * See index.js for the full rationale (GHSA-mh99-v99m-4gvg + minimatch@3 API).
 *
 * Modern consumers (minimatch 5/10) import the named `expand`; legacy interop
 * paths take the default. Both are provided, and both delegate to the patched
 * 5.0.8 implementation.
 */

import * as upstream from "brace-expansion-upstream";

function expand(...args) {
  return upstream.expand(...args);
}

Object.assign(expand, {
  expand: upstream.expand,
  EXPANSION_MAX: upstream.EXPANSION_MAX,
  EXPANSION_MAX_LENGTH: upstream.EXPANSION_MAX_LENGTH,
});

export const EXPANSION_MAX = upstream.EXPANSION_MAX;
export const EXPANSION_MAX_LENGTH = upstream.EXPANSION_MAX_LENGTH;
export { expand };
export default expand;
