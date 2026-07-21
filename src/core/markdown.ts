/**
 * Formats a RequestRecord as markdown/JSON for pasting into AI chats,
 * GitHub issues, or Slack. Includes the raw page JSON so AI tools
 * can inspect exact prop values.
 */

import type { RequestRecord, CapturedEvent } from './types'
import { diffProps, type DiffNode } from './diff'
import { getFeatureInfo } from './feature-info'
import { sortedHeaders } from './headers'

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

/** One-line navigation summary: `GET /users → 200 (45ms)` */
function navigationLine(request: RequestRecord): string {
  const method = request.method ?? 'GET'
  const isInitial = request.initial === true
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
  return `${nav} (${timing})`
}

function formatHeader(request: RequestRecord): string {
  const lines = ['## Inertia Request', '', `**Navigation:** ${navigationLine(request)}`]

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
  if (request.prevented) lines.push('**Prevented:** Yes (an inertia:before listener called preventDefault)')
  if (request.cached) lines.push('**Served from prefetch cache:** Yes (no request was made)')

  return lines.join('\n')
}

/**
 * Actual wire data (headers/status/size) captured via Inertia's interceptors,
 * plus Server-Timing metrics from the Resource Timing entry.
 */
function formatWire(request: RequestRecord): string | null {
  const body = wireBody(request)
  return body ? `### Network\n\n${body}` : null
}

/** Wire section body without the heading — shared by requestToMarkdown and networkToMarkdown. */
function wireBody(request: RequestRecord): string | null {
  const wire = request.wire
  const serverTiming = request.network?.serverTiming
  if (!wire?.request && !wire?.response && !serverTiming?.length) return null

  const lines: string[] = []

  const status = wire?.response?.status ?? request.status
  if (status !== undefined) lines.push(`**Status:** ${status}`)
  if (wire?.response?.bodySize !== undefined) lines.push(`**Response size:** ${wire.response.bodySize} bytes`)

  if (wire?.request?.headers && Object.keys(wire.request.headers).length > 0) {
    const headerLines = sortedHeaders(wire.request.headers).map((h) => `${h.name}: ${h.value}`)
    lines.push(`**Request headers:**\n\n\`\`\`\n${headerLines.join('\n')}\n\`\`\``)
  }

  if (wire?.response?.headers && Object.keys(wire.response.headers).length > 0) {
    const headerLines = sortedHeaders(wire.response.headers).map((h) => `${h.name}: ${h.value}`)
    lines.push(`**Response headers:**\n\n\`\`\`\n${headerLines.join('\n')}\n\`\`\``)
  }

  if (serverTiming?.length) {
    const metricLines = serverTiming.map((m) => {
      const duration = Number.isInteger(m.duration) ? m.duration : m.duration.toFixed(1)
      return `${m.name}: ${duration}ms${m.description ? ` — ${m.description}` : ''}`
    })
    lines.push(`**Server timing:**\n\n\`\`\`\n${metricLines.join('\n')}\n\`\`\``)
  }

  return lines.length > 0 ? lines.join('\n\n') : null
}

/** Standalone Network snapshot — wire headers, status, size, Server-Timing. */
export function networkToMarkdown(request: RequestRecord): string {
  const lines = ['## Inertia Network', '', `**Navigation:** ${navigationLine(request)}`]
  const body = wireBody(request)
  lines.push('', body ?? '_No wire data captured — HTTP details were not observed for this visit._')
  return lines.join('\n')
}

/** Values longer than this (as single-line JSON) are truncated in diff output. */
const VALUE_TRUNCATE_AT = 200

/** Single-line JSON of a value, truncated with a note when huge. */
function formatValue(value: unknown): string {
  let json: string
  try {
    json = JSON.stringify(value) ?? String(value)
  } catch {
    json = String(value)
  }
  if (json.length > VALUE_TRUNCATE_AT) {
    return `${json.slice(0, VALUE_TRUNCATE_AT)}… (truncated, ${json.length} chars total)`
  }
  return json
}

interface FlatChange {
  type: 'added' | 'removed' | 'changed'
  path: string
  oldValue?: unknown
  newValue?: unknown
}

/** Flatten a diff tree into dotted-path leaf changes (`user.name`, `items[2].title`). */
function flattenDiff(nodes: DiffNode[], prefix = ''): FlatChange[] {
  const out: FlatChange[] = []
  for (const node of nodes) {
    const path = node.key.startsWith('[') ? `${prefix}${node.key}` : prefix ? `${prefix}.${node.key}` : node.key
    if (node.type === 'nested' && node.children) {
      out.push(...flattenDiff(node.children, path))
    } else if (node.type === 'added') {
      out.push({ type: 'added', path, newValue: node.newValue })
    } else if (node.type === 'removed') {
      out.push({ type: 'removed', path, oldValue: node.oldValue })
    } else if (node.type === 'changed') {
      out.push({ type: 'changed', path, oldValue: node.oldValue, newValue: node.newValue })
    }
  }
  return out
}

/** `old → new` when both exist and differ, otherwise whichever is present. */
function transition(oldVal: string | undefined, newVal: string | undefined): string | undefined {
  if (oldVal && newVal && oldVal !== newVal) return `${oldVal} → ${newVal}`
  return newVal ?? oldVal
}

/** Compact markdown of the props diff between previousPage and page. */
export function diffToMarkdown(request: RequestRecord): string {
  const prev = request.previousPage
  const page = request.page

  const lines = ['## Inertia Props Diff', '', `**Navigation:** ${navigationLine(request)}`]
  const component = transition(prev?.component, page?.component)
  if (component) lines.push(`**Component:** ${component}`)
  const url = transition(prev?.url, page?.url)
  if (url) lines.push(`**URL:** ${url}`)

  if (!page) {
    lines.push('', '_No page object captured for this request._')
    return lines.join('\n')
  }
  if (!prev) {
    lines.push('', '_No previous page captured — nothing to diff against._')
    return lines.join('\n')
  }

  const changes = flattenDiff(diffProps(prev.props, page.props))
  if (changes.length === 0) {
    lines.push('', '_No prop changes._')
    return lines.join('\n')
  }

  const sections: [string, FlatChange[], (c: FlatChange) => string][] = [
    ['Added', changes.filter((c) => c.type === 'added'), (c) => formatValue(c.newValue)],
    ['Removed', changes.filter((c) => c.type === 'removed'), (c) => formatValue(c.oldValue)],
    [
      'Changed',
      changes.filter((c) => c.type === 'changed'),
      (c) => `${formatValue(c.oldValue)} → ${formatValue(c.newValue)}`,
    ],
  ]
  for (const [title, rows, render] of sections) {
    if (rows.length === 0) continue
    lines.push('', `### ${title} (${rows.length})`, '', ...rows.map((c) => `- \`${c.path}\`: ${render(c)}`))
  }
  return lines.join('\n')
}

/** Overall visit outcome, mirroring the Events tab lifecycle summary. */
function outcomeLabel(request: RequestRecord): string {
  if (request.completed) return 'completed'
  if (request.interrupted) return 'interrupted'
  if (request.cancelled) return 'cancelled'
  if (request.prevented) return 'prevented'
  return 'in progress'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Terse payload highlights for one event: prevented/cancelled/interrupted flags, error keys, cached. */
function eventHighlights(event: CapturedEvent): string[] {
  const highlights: string[] = []
  const detail = event.detail
  const visit = isRecord(detail.visit) ? detail.visit : undefined

  if (event.prevented) highlights.push('prevented')
  if (detail.cancelled === true || visit?.cancelled === true) highlights.push('cancelled')
  if (detail.interrupted === true || visit?.interrupted === true) highlights.push('interrupted')
  if (detail.cached === true) highlights.push('served from prefetch cache')
  if (isRecord(detail.errors) && Object.keys(detail.errors).length > 0) {
    highlights.push(`errors: ${Object.keys(detail.errors).join(', ')}`)
  }
  return highlights
}

/** Group consecutive progress events so a busy upload stays one line. */
function groupProgressEvents(events: CapturedEvent[]): CapturedEvent[][] {
  const groups: CapturedEvent[][] = []
  for (const event of events) {
    const last = groups[groups.length - 1]
    if (event.name === 'inertia:progress' && last?.[0]?.name === 'inertia:progress') {
      last.push(event)
    } else {
      groups.push([event])
    }
  }
  return groups
}

/** Event timeline — one line per event with +offset and terse payload highlights. */
export function eventsToMarkdown(request: RequestRecord): string {
  const lines = [
    '## Inertia Events',
    '',
    `**Navigation:** ${navigationLine(request)}`,
    `**Outcome:** ${outcomeLabel(request)}`,
  ]

  if (request.events.length === 0) {
    lines.push('', '_No events captured._')
    return lines.join('\n')
  }

  lines.push('')
  const first = request.events[0].timestamp
  for (const group of groupProgressEvents(request.events)) {
    const offset = Math.round(group[0].timestamp - first)
    if (group.length > 1) {
      const percentages = group.map((e) => e.detail.percentage).filter((p) => p !== undefined)
      const pct = percentages[percentages.length - 1]
      lines.push(`- +${offset}ms \`inertia:progress\` ×${group.length}${pct !== undefined ? ` (last ${pct}%)` : ''}`)
      continue
    }
    const highlights = eventHighlights(group[0])
    lines.push(`- +${offset}ms \`${group[0].name}\`${highlights.length > 0 ? ` — ${highlights.join(', ')}` : ''}`)
  }
  return lines.join('\n')
}

/**
 * Stable JSON export of the record for machine consumption.
 * Keeps the page object and raw event details; drops devtools-internal
 * correlation ids (visitId, event ids) that would confuse an agent.
 */
export function requestToJSON(request: RequestRecord): string {
  const record = {
    type: request.type,
    method: request.method,
    url: request.url,
    status: request.status,
    duration: request.duration,
    startedAt: request.startedAt,
    finishedAt: request.finishedAt,
    only: request.only,
    except: request.except,
    initial: request.initial,
    cached: request.cached,
    prevented: request.prevented,
    cancelled: request.cancelled,
    interrupted: request.interrupted,
    completed: request.completed,
    error: request.error === undefined ? undefined : String(request.error),
    redirectUrl: request.redirectUrl,
    features: request.features,
    diagnostics: request.diagnostics,
    visitOptions: request.visitOptions,
    wire: request.wire,
    network: request.network,
    page: request.page,
    previousPage: request.previousPage,
    events: request.events.map(({ name, timestamp, detail, prevented }) => ({ name, timestamp, detail, prevented })),
  }

  try {
    return JSON.stringify(record, null, 2)
  } catch {
    // Circular references shouldn't happen (details are plain data), but never throw from an export.
    const seen = new WeakSet<object>()
    return JSON.stringify(
      record,
      (_key, value: unknown) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]'
          seen.add(value)
        }
        return value
      },
      2,
    )
  }
}
