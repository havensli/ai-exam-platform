import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    env: {
      // src/db/index.ts calls neon(process.env.DATABASE_URL!) at import time,
      // which throws synchronously if unset — and that module is now
      // transitively imported by src/lib/auth.ts. neon() only validates the
      // string is non-empty here; it doesn't connect until a query actually
      // runs, so a placeholder is enough for tests that never touch `db`.
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    },
  },
});
