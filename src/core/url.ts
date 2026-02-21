/** Normalize a URL to pathname + search for comparison. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url, 'http://localhost')
    return u.pathname + u.search
  } catch {
    return url
  }
}
