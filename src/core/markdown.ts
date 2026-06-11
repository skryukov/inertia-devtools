/**
 * Formats a RequestRecord as markdown for pasting into AI chats,
 * GitHub issues, or Slack. Includes the raw page JSON so AI tools
 * can inspect exact prop values.
 */

import type { RequestRecord } from './types'
import { getFeatureInfo } from '../ui/shared/feature-info'
import { sortedHeaders } from '../ui/shared/network-format'

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

  const wire = formatWire(request)
  if (wire) {
    sections.push(wire)
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
  if (request.cached) lines.push('**Served from prefetch cache:** Yes (no request was made)')

  return lines.join('\n')
}

/** Actual wire data (headers/status/size) captured via Inertia's interceptors. */
function formatWire(request: RequestRecord): string | null {
  const wire = request.wire
  if (!wire?.request && !wire?.response) return null

  const lines: string[] = []

  const status = wire.response?.status ?? request.status
  if (status !== undefined) lines.push(`**Status:** ${status}`)
  if (wire.response?.bodySize !== undefined) lines.push(`**Response size:** ${wire.response.bodySize} bytes`)

  if (wire.request?.headers && Object.keys(wire.request.headers).length > 0) {
    const headerLines = sortedHeaders(wire.request.headers).map((h) => `${h.name}: ${h.value}`)
    lines.push(`**Request headers:**\n\n\`\`\`\n${headerLines.join('\n')}\n\`\`\``)
  }

  if (wire.response?.headers && Object.keys(wire.response.headers).length > 0) {
    const headerLines = sortedHeaders(wire.response.headers).map((h) => `${h.name}: ${h.value}`)
    lines.push(`**Response headers:**\n\n\`\`\`\n${headerLines.join('\n')}\n\`\`\``)
  }

  return lines.length > 0 ? `### Network\n\n${lines.join('\n\n')}` : null
}
