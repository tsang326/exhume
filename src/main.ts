import './style.css';

// Stub. Task 15 and later tasks build the real page.
new Worker(new URL('./web/worker/disk.worker.ts', import.meta.url), { type: 'module' });
