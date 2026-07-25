import { test, expect } from '@playwright/test'

// SPIKE — real-browser e2e against the playground. This is the coverage the
// `inertia-compat` matrix only *looks* like it has: these assertions run
// against a live @inertiajs/react app and the actual built devtools UI, so a
// protocol/event-shape drift that jsdom+synthetic-CustomEvent tests miss would
// fail here. The panel mounts in an OPEN shadow root, so Playwright locators
// pierce it automatically — every assertion below is scoped to the shadow host.

/** The devtools shadow host — chaining from it keeps assertions off the app DOM. */
const panel = (page: import('@playwright/test').Page) => page.locator('#inertia-devtools-host')

async function openPanel(page: import('@playwright/test').Page) {
  await page.goto('/')
  // The launcher button is always present (even while the panel is closed).
  await panel(page).getByLabel('Toggle Inertia DevTools (Alt+Shift+D)').click()
  // The header logo proves the panel chrome actually mounted inside the shadow.
  await expect(panel(page).getByText('Inertia', { exact: true })).toBeVisible()
}

test('a client-side Inertia visit is captured and its detail tabs render', async ({ page }) => {
  await openPanel(page)

  // Drive a real Inertia client visit (not a full page load).
  await page.getByRole('link', { name: 'Users' }).click()

  // A request row appears — data-visit-id is the stable per-record hook.
  const row = panel(page).locator('[data-visit-id]').first()
  await expect(row).toBeVisible()
  await row.click()

  // The Props/Network/Events tab strip only renders after a row is selected.
  await expect(panel(page).getByRole('tab', { name: 'Props' })).toBeVisible()
  await expect(panel(page).getByRole('tab', { name: 'Network' })).toBeVisible()
  await expect(panel(page).getByRole('tab', { name: 'Events' })).toBeVisible()
})

test('the /bugs deferred-500 makes the diagnostics engine fire in a real browser', async ({ page }) => {
  await openPanel(page)

  // /bugs ships a deferred prop group whose resolver 500s on the server.
  await page.getByRole('link', { name: 'Bugs' }).click()

  // The diagnostics engine should flag it — this is the product's actual value,
  // proven end-to-end rather than against a hand-built CustomEvent.
  await expect(panel(page).getByText('Deferred props failed to load')).toBeVisible({ timeout: 10_000 })
})
