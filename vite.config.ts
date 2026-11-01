import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/leaguelab/' : '/',
  test: { include: ['tests/**/*.test.{ts,tsx}'] },
});
