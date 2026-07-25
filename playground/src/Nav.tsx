import { Link } from '@inertiajs/react'

export default function Nav() {
  return (
    <nav>
      <Link href="/">Home</Link>
      <Link href="/users" prefetch cacheFor="30s">
        Users (prefetch, 30s cache)
      </Link>
      <Link href="/posts">Posts</Link>
      <Link href="/poll">Poll</Link>
      <Link href="/bugs">Bugs</Link>
    </nav>
  )
}
