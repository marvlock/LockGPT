import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const source = new URL('../dist/', import.meta.url);
const output = new URL('../dist-firefox/', import.meta.url);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });

const manifestUrl = new URL('manifest.json', output);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
const worker = manifest.background?.service_worker;
if (!worker) throw new Error('The Chrome build did not produce a background worker.');

// Firefox MV3 uses an event page rather than Chrome's extension service worker.
manifest.background = { scripts: [worker], type: 'module' };
manifest.browser_specific_settings ??= {};
manifest.browser_specific_settings.gecko_android = { strict_min_version: '142.0' };
await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`);
