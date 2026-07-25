import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// Real-browser e2e against the playground, driving the actual built devtools UI
// through its (open) shadow root. Uses Playwright's bundled Chromium so the same
// config runs locally and in CI with no system-Chrome dependency — run
// `npx playwright install chromium` once. Boots the playground on its fixed port
// (5199) via the webServer block below; the playground serves the devtools from
// the repo's built `dist/`, so `npm run build` must run before this.
const playgroundDir = fileURLToPath(new URL('../playground', import.meta.url))

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    headless: true,
    baseURL: 'http://localhost:5199',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    cwd: playgroundDir,
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    timeout: 120_000,
    // Point the source-link editor-open at a no-op so e2e never launches a real
    // editor on the runner; the endpoint still resolves + responds normally.
    env: { INERTIA_DEVTOOLS_EDITOR: 'true' },
  },
})
