/**
 * Copy text to the clipboard. Resolves `true` only if it actually landed.
 *
 * Three ways the bare `navigator.clipboard.writeText(text)` this replaced went
 * wrong, all of them in the host app's name:
 *
 * - On a non-secure origin — `http://192.168.1.x:5173`, the standard way to
 *   test a dev server from a phone — `navigator.clipboard` is `undefined`, so
 *   it threw a synchronous TypeError out of a click handler and into the app's
 *   `window.onerror` / Sentry.
 * - Popped out into the PiP window, `navigator` is the *opener's* and its
 *   document is not focused, so `writeText` rejects `NotAllowedError` — an
 *   unhandled rejection, while the panel still cheerfully said "Copied!".
 * - `Permissions-Policy: clipboard-write=()` fails the same silent way.
 *
 * Callers get a boolean so the toast can tell the truth instead of guessing.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // In the PiP popup the panel lives in a different document than the
    // `navigator` we would otherwise reach, and only the focused one may write.
    const target = globalThis.navigator
    if (!target?.clipboard?.writeText) return false
    await target.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
