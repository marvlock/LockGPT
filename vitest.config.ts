import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Keep discovery and file access consistent when using a Windows junction.
const root = realpathSync(fileURLToPath(new URL('.', import.meta.url)));

export default defineConfig({
  root,
  server: {
    fs: { allow: [root] },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environmentOptions: { jsdom: { url: 'https://chatgpt.com/' } },
  },
});
