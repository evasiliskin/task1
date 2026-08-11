import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
  plugins: [tsconfigPaths(), swc.vite()],
});
