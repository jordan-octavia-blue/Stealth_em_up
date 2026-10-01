import { cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * Runtime asset directories that the game loads by plain relative URL at runtime
 * (`images/shell.png`, `maps/bank_1.jomap`, `bin/pixi.js`, ...).
 *
 * They are deliberately *not* moved into a Vite `public/` folder: those paths are baked
 * into a decade of ES5 string literals and into the standalone pages (`index.html`,
 * `menu.html`), and a rename would churn every one of them for no gain. The dev server
 * already serves anything under the project root, so this only has to put the same
 * directories next to the built HTML.
 */
const ASSET_DIRS = ['bin', 'images', 'icons', 'index_assets', 'maps', 'movie_clips', 'sound'];

function copyAssetDirs(): Plugin {
  let outDir = 'dist';
  return {
    name: 'stealth-em-up:copy-asset-dirs',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async closeBundle() {
      for (const dir of ASSET_DIRS) {
        await cp(resolve(root, dir), resolve(root, outDir, dir), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  // The repo root is the site root: game.html, menu.html and the asset folders all sit
  // where they always have, so the deployed URLs are unchanged.
  root,
  publicDir: false,
  plugins: [copyAssetDirs()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(root, 'index.html'),
        game: resolve(root, 'game.html'),
        menu: resolve(root, 'menu.html'),
        keybindings: resolve(root, 'keybindings.html'),
        editor: resolve(root, 'editor.html'),
      },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/setup.ts'],
  },
});
