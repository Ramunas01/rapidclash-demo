// Scoped to this package on purpose: tools/bot-crowd is deliberately NOT in the root
// vitest.config.ts's `include` globs (it is not part of the deployed app — see README.md
// "Not shipped"). Run this package's tests with `pnpm --filter @rapidclash/bot-crowd test`
// (or `pnpm test` from this directory); the root `pnpm -w run test` does not (and should not)
// pick these up, same as it does not run the root `tsc -b`/build over `tools/*`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
