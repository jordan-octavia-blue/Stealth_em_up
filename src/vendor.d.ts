// Ambient declarations for the vendored libraries that are still consumed as globals
// rather than as npm packages.

export {};

declare global {
  /**
   * Pixi.js v3, vendored at `bin/pixi.js` and loaded by a plain <script> tag in the host
   * page. Typed as `any` on purpose: v3 predates its own bundled typings, and the
   * roadmap (§2.3) keeps it at arm's length rather than upgrading it now. Once rendering
   * is behind `src/render/`, this becomes a real import with real types.
   */
  var PIXI: any;
}
