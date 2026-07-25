import { useEffect } from 'react'
import { router } from '@inertiajs/react'
import Nav from '../Nav'

interface Props {
  time: number
  stats: { total: number; active: number }
  errors: Record<string, string>
  slow?: { finally: string }
}

/**
 * Intentionally buggy scenarios — each button reproduces a real-world bug the
 * devtools diagnostics claim to catch (the adversarial recall suite).
 */
export default function Bugs({ time, stats, errors, slow }: Props) {
  useEffect(() => {
    // The 'broken' deferred 500s on every mount — suppress Inertia's error
    // modal so the scenario buttons stay usable (devtools still records the
    // event; preventDefault only cancels the modal).
    const suppress = (e: Event) => e.preventDefault()
    document.addEventListener('inertia:httpException', suppress)
    return () => document.removeEventListener('inertia:httpException', suppress)
  }, [])

  const discardedResponse = () => {
    // Optimistic visits survive the cross-page cancelInFlight sweep (plain
    // async visits get cancelled → visit-cancelled, a different diagnostic).
    // The 1.5s response then lands after the app moved to Home — Inertia
    // discards it (shouldSetPage: component changed mid-flight). `optimistic`
    // takes an update callback; identity keeps the UI unchanged.
    router.reload({
      async: true,
      optimistic: (props: Record<string, unknown>) => props,
      only: ['slow'],
    } as Parameters<typeof router.reload>[0])
    setTimeout(() => router.visit('/'), 100)
  }

  return (
    <div>
      <h1>Bug scenarios</h1>
      <Nav />
      <p className="hint">
        Server time counter: {time} · stats.total: {stats.total}
        {slow ? ` · slow: ${slow.finally}` : ''}
      </p>

      {Object.keys(errors).length > 0 && (
        <p className="flash" style={{ background: '#fee2e2', borderColor: '#ef4444' }}>
          Errors: {JSON.stringify(errors)}
        </p>
      )}

      <h2>partial-prop-missing</h2>
      <p className="hint">The server never sends a "ghost" prop — devtools should warn.</p>
      <button onClick={() => router.reload({ only: ['ghost'] })}>Partial reload requesting "ghost"</button>

      <h2>Dot-path partial (healthy — must NOT warn)</h2>
      <button onClick={() => router.reload({ only: ['stats.total'] })}>Partial reload "stats.total"</button>

      <h2>stale-errors</h2>
      <p className="hint">
        Submit sets validation errors; the partial reload after it omits them, so the merge carries them over.
      </p>
      <button onClick={() => router.post('/bugs', {})}>1. Submit invalid form</button>
      <button onClick={() => router.reload({ only: ['time'] })}>2. Partial reload "time"</button>

      <h2>response-discarded</h2>
      <button onClick={discardedResponse}>Async reload, then navigate away</button>

      <p className="hint">
        Also: this page announces a deferred group "broken" whose reload always 500s — the deferred-failed diagnostic
        should appear on it automatically.
      </p>
    </div>
  )
}
