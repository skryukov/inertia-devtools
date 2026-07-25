import { Deferred } from '@inertiajs/react'
import Nav from '../Nav'

interface User {
  id: number
  name: string
  email: string
}

interface Stats {
  total: number
  active: number
  requestsServed: number
  generatedAt: string
}

export default function Users({ users, stats }: { users: User[]; stats?: Stats }) {
  return (
    <div>
      <h1>Users</h1>
      <Nav />

      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Email</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.id}</td>
              <td>{user.name}</td>
              <td>{user.email}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Stats (deferred prop, 300ms server delay)</h2>
      <Deferred data="stats" fallback={<p>Loading stats…</p>}>
        {stats && (
          <ul>
            <li>Total: {stats.total}</li>
            <li>Active: {stats.active}</li>
            <li>Requests served: {stats.requestsServed}</li>
            <li>Generated at: {stats.generatedAt}</li>
          </ul>
        )}
      </Deferred>
    </div>
  )
}
