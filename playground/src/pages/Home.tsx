import { useEffect } from 'react'
import { router } from '@inertiajs/react'
import Nav from '../Nav'

interface HomeProps {
  appName: string
  serverTime: string
  assetVersion: string
  clientNote?: string
  flash?: Record<string, string>
}

export default function Home({ appName, serverTime, assetVersion, clientNote }: HomeProps) {
  // Prevented-visit test: cancel any visit whose URL contains '/blocked'.
  useEffect(() => {
    const onBefore = (event: Event) => {
      const detail = (event as CustomEvent<{ visit?: { url?: unknown } }>).detail
      const url = String(detail?.visit?.url ?? '')
      if (url.includes('/blocked')) {
        console.log('[playground] prevented visit to', url)
        event.preventDefault()
      }
    }
    document.addEventListener('inertia:before', onBefore)
    return () => document.removeEventListener('inertia:before', onBefore)
  }, [])

  const bumpThenNavigate = async () => {
    const res = await fetch('/api/bump')
    const { version } = await res.json()
    console.log(`[playground] server asset version is now "${version}" (client still has "${assetVersion}")`)
    // Client sends the stale X-Inertia-Version → server responds 409 with
    // X-Inertia-Location → Inertia performs a hard location visit.
    router.visit('/users')
  }

  const clientReplace = () => {
    router.replace({
      props: (current) => ({ ...current, clientNote: 'hello from router.replace' }),
    })
  }

  return (
    <div>
      <h1>{appName}</h1>
      <Nav />

      <p className="hint">
        Server time: {serverTime} · asset version: {assetVersion}
        {clientNote ? ` · clientNote: ${clientNote}` : ''}
      </p>

      <h2>Prevented visit</h2>
      <p className="hint">
        This page listens to <code>inertia:before</code> and cancels any visit containing "/blocked". The devtools
        should record a prevented visit.
      </p>
      <button onClick={() => router.visit('/blocked')}>Visit /blocked (will be prevented)</button>

      <h2>Client-side visit</h2>
      <p className="hint">
        <code>router.replace(&#123; props &#125;)</code> fires <code>inertia:clientVisit</code> — no network request,
        props updated in place (adds a "clientNote" prop above).
      </p>
      <button onClick={clientReplace}>router.replace with clientNote prop</button>

      <h2>Version conflict (409 flow)</h2>
      <p className="hint">
        The button below calls <code>GET /api/bump</code> (plain fetch) to flip the server's asset version, then
        navigates to /users. The stale <code>X-Inertia-Version</code> makes the server answer 409 +{' '}
        <code>X-Inertia-Location</code>, so Inertia does a full page reload.
      </p>
      <button onClick={bumpThenNavigate}>Bump version then navigate</button>
    </div>
  )
}
