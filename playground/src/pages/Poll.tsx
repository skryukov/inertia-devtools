import { usePoll } from '@inertiajs/react'
import Nav from '../Nav'

export default function Poll({ time, serverTime }: { time: number; serverTime: string }) {
  usePoll(2000, { only: ['time'] })

  return (
    <div>
      <h1>Poll</h1>
      <Nav />

      <p className="hint">
        This page polls every 2s with <code>usePoll(2000, &#123; only: ['time'] &#125;)</code> — the devtools should
        mark these requests as polls.
      </p>
      <p>
        Server counter: <strong>{time}</strong>
      </p>
      <p>Last full load: {serverTime}</p>
    </div>
  )
}
