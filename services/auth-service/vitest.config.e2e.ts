import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Set before any test file (and therefore AppModule -> ConfigModule.forRoot's
    // validate step) is evaluated — setting these inside the spec file itself is
    // too late, since ES module imports are fully evaluated before that file's
    // own top-level statements run, and AppModule's decorator calls
    // ConfigModule.forRoot() (which validates env) at import/class-definition
    // time, not at Test.createTestingModule() call time.
    env: {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/auth_e2e_test',
      JWT_SECRET: 'e2e-test-secret-not-for-production-use-only-in-ci',
    },
  },
});
