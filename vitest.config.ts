import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: path.resolve('./apps/web/node_modules/react'),
      'react-dom': path.resolve('./apps/web/node_modules/react-dom'),
      'react/jsx-runtime': path.resolve('./apps/web/node_modules/react/jsx-runtime'),
      'react/jsx-dev-runtime': path.resolve('./apps/web/node_modules/react/jsx-dev-runtime'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/server/**/*.test.ts', 'apps/web/src/**/*.test.tsx', 'apps/web/src/**/*.test.ts'],
    passWithNoTests: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['apps/web/**', 'jsdom'],
    ],
    setupFiles: ['apps/web/src/test/setup.ts'],
  },
});
