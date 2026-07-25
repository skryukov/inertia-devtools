import { router } from '@inertiajs/react'
import Nav from '../Nav'

interface Post {
  id: number
  title: string
}

interface PostsProps {
  posts: Post[]
  loadedAt: string
  flash?: { success?: string }
}

export default function Posts({ posts, loadedAt, flash }: PostsProps) {
  return (
    <div>
      <h1>Posts</h1>
      <Nav />

      {flash?.success && <div className="flash">{flash.success}</div>}

      <p className="hint">Loaded at: {loadedAt}</p>
      <ul>
        {posts.map((post) => (
          <li key={post.id}>
            #{post.id} — {post.title}
          </li>
        ))}
      </ul>

      <button onClick={() => router.reload({ only: ['posts'] })}>Partial reload (only: posts)</button>
      <button onClick={() => router.post('/posts', { title: `Created at ${new Date().toLocaleTimeString()}` })}>
        Create post (POST → 303 → flash)
      </button>
    </div>
  )
}
