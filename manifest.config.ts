import type { ManifestV3Export } from '@crxjs/vite-plugin';

export default {
  manifest_version: 3,
  name: 'LockGPT',
  version: '0.1.1',
  description: 'Hide your existing ChatGPT conversations while someone borrows your browser.',
  permissions: ['storage', 'scripting', 'webNavigation'],
  host_permissions: ['https://chatgpt.com/*'],
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  icons: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  action: { default_title: 'LockGPT', default_popup: 'src/popup/index.html', default_icon: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png' } },
  content_scripts: [{ matches: ['https://chatgpt.com/*'], js: ['src/content/bootstrap.ts'], css: ['src/content/guard.css'], run_at: 'document_start' }]
} satisfies ManifestV3Export;
