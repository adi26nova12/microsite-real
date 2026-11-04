import { cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// One tour per page: The Aurelle at the root, Opus One under /opus-one/.
const TOURS = ['.', 'opus-one'];

export default defineConfig({
  base: './',
  publicDir: false,
  server: { port: 5173, strictPort: true },
  build: {
    rollupOptions: { input: Object.fromEntries(TOURS.map(t => [t === '.' ? 'main' : t, resolve(t, 'index.html')])) },
  },
  plugins: [{
    // tour.js builds its image, clip and frame paths at runtime, so Vite can't see them to bundle.
    name: 'copy-tour-assets',
    apply: 'build',
    writeBundle(options) {
      for (const t of TOURS) cpSync(resolve(t, 'assets'), resolve(options.dir, t, 'assets'), { recursive: true });
    },
  }],
});
