import { cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  publicDir: false,
  server: { port: 5173, strictPort: true },
  plugins: [{
    // tour.js builds its image and clip paths at runtime, so Vite can't see them to bundle.
    name: 'copy-tour-assets',
    apply: 'build',
    writeBundle(options) {
      cpSync(resolve('assets'), resolve(options.dir, 'assets'), { recursive: true });
    },
  }],
});
