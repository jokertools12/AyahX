import { build } from 'esbuild';

// Compile once during deployment rather than keep a TypeScript loader and its
// helper process resident in every API/control/worker container.
await build({
  entryPoints: ['server/index.ts', 'server/worker.ts', 'server/renderControl.ts', 'server/renderChild.ts', 'server/db/setup.ts'],
  outdir: 'dist-server', outbase: 'server', outExtension: { '.js': '.cjs' },
  bundle: true, packages: 'external', platform: 'node', target: 'node22', format: 'cjs', sourcemap: false,
});
