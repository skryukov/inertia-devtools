// Manual side-effect import (the plugin's auto-injection now survives
// re-transforms and would also work; keeping the explicit import makes the
// playground exercise the manual-import path). The plugin intercepts this
// bare import and routes it through its init virtual module.
import 'inertia-devtools'
import { createInertiaApp } from '@inertiajs/react'
import { createRoot } from 'react-dom/client'

import Home from './pages/Home'
import Users from './pages/Users'
import Posts from './pages/Posts'
import Poll from './pages/Poll'
import Bugs from './pages/Bugs'

const pages: Record<string, React.ComponentType<never>> = { Home, Users, Posts, Poll, Bugs }

createInertiaApp({
  resolve: (name) => {
    const page = pages[name]
    if (!page) throw new Error(`Unknown page: ${name}`)
    return page
  },
  setup({ el, App, props }) {
    createRoot(el).render(<App {...props} />)
  },
})
