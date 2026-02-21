/**
 * Formats a RequestRecord as markdown for pasting into AI chats,
 * GitHub issues, or Slack. Includes the raw page JSON so AI tools
 * can inspect exact prop values.
 */

import type { RequestRecord } from './types'
import { getFeatureInfo } from '../ui/shared/feature-info'

/** Full snapshot — context header + raw page JSON */
export function requestToMarkdown(request: RequestRecord): string {
  const sections: string[] = [formatHeader(request)]

  if (request.features.length > 0) {
    const lines = request.features.map((f) => {
      const info = getFeatureInfo(f.type)
      return `- **${f.type}**${info ? ` — ${info.description}` : ''}`
    })
    sections.push(`### Features\n\n${lines.join('\n')}`)
  }

  if (request.error) {
    sections.push(`### Error\n\n\`\`\`\n${String(request.error)}\n\`\`\``)
  }

  if (request.page) {
    sections.push(`### Page Object\n\n\`\`\`json\n${JSON.stringify(request.page, null, 2)}\n\`\`\``)
  }

  return sections.join('\n\n')
}

function formatHeader(request: RequestRecord): string {
  const method = request.method ?? 'GET'
  const isInitial = request.type === 'full' && request.duration === 0 && request.completed
  const isClient = request.type === 'client'

  let timing: string
  if (isInitial) {
    timing = 'initial page load'
  } else if (isClient) {
    timing = 'client-side'
  } else if (request.duration != null) {
    timing = `${Math.round(request.duration)}ms`
  } else if (request.finishedAt && request.startedAt) {
    timing = `${Math.round(request.finishedAt - request.startedAt)}ms`
  } else {
    timing = 'in-flight'
  }

  let nav = `${method} ${request.url}`
  if (request.status) nav += ` → ${request.status}`
  nav += ` (${timing})`

  const lines = ['## Inertia Request', '', `**Navigation:** ${nav}`]

  if (request.page) {
    lines.push(`**Component:** ${request.page.component}`)
  }

  lines.push(`**Type:** ${request.type}`)

  if (request.only?.length) {
    lines.push(`**Only:** ${request.only.map((s) => `\`${s}\``).join(', ')}`)
  }
  if (request.except?.length) {
    lines.push(`**Except:** ${request.except.map((s) => `\`${s}\``).join(', ')}`)
  }

  if (request.cancelled) lines.push('**Cancelled:** Yes')
  if (request.interrupted) lines.push('**Interrupted:** Yes')

  return lines.join('\n')
}
