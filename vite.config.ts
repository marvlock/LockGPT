import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

// Match resolved module paths when the checkout is accessed through a junction.
const root = realpathSync(fileURLToPath(new URL('.', import.meta.url)));

export default defineConfig({ root, plugins: [crx({ manifest })] });
