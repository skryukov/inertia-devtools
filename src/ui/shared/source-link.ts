/**
 * Ask the dev server to open a component's source file in the editor. The Vite
 * plugin mounts this endpoint only in dev when source links are enabled, and
 * the UI gates the call on the `sourceLinks` capability — so a 404 here means
 * "no file found for this component name" (e.g. a non-default pages layout),
 * not "feature off". Returns a short message for the panel's status toast.
 */
export async function openComponentSource(component: string): Promise<{ ok: boolean; message: string }> {
  if (!component) return { ok: false, message: 'No component to open' }
  try {
    const response = await fetch(`/__inertia-devtools/open?component=${encodeURIComponent(component)}`)
    if (response.ok) {
      const data = (await response.json().catch(() => ({}))) as { resolved?: string }
      const name = data.resolved ? (data.resolved.split(/[/\\]/).pop() ?? component) : component
      return { ok: true, message: `Opening ${name}…` }
    }
    if (response.status === 404) {
      return { ok: false, message: `No source file found for ${component}` }
    }
    return { ok: false, message: `Could not open source (${response.status})` }
  } catch {
    // Endpoint absent (production/non-Vite) or network failure — never throw
    // into a click handler; the component name just falls back to plain text.
    return { ok: false, message: 'Source links unavailable' }
  }
}
