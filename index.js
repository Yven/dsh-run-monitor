/**
 * Run monitor — Host half.
 *
 * Serves a read-only snapshot of every live Session, with each task's state
 * derived from its event tail (执行中 / 待回复 / 已完成), so the browser half can
 * render the sidebar monitor without streaming raw session events.
 */

const ROUTE_PREFIX = '/run-monitor/api'
/** Coalesces bursts of session events into one "something changed" ping. */
const BROADCAST_MS = 250
/** Keeps idle SSE connections from being reclaimed as dead by the browser. */
const HEARTBEAT_MS = 20000
const TAIL_EVENTS = 400
const HEAD_EVENTS = 400
const EDGE_SCAN_LIMIT = 8000
const MAX_TASKS = 200
const PENDING_TYPE_PATTERN = /(^|\/)(question|approval|ask)(\/|$)/i
const SETTLED_TYPE_PATTERN = /(outcome|answer|answered|result|resolved|decision|reject|accept)$/i

export const inject = ['webServer', 'sessions']

export function apply(ctx) {
  // Connected browsers the change feed pushes to. The feed carries no payload:
  // it only says "the session log moved", and the client refetches the snapshot.
  const streams = new Set()
  let broadcastTimer = null

  const broadcast = () => {
    if (broadcastTimer !== null) return
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null
      for (const res of streams) writeEvent(res, 'change', {})
    }, BROADCAST_MS)
    if (typeof broadcastTimer.unref === 'function') broadcastTimer.unref()
  }

  ctx.effect(() => {
    const disposers = [
      ctx.on('session/event', broadcast),
      ctx.on('agent/status', broadcast),
      ctx.on('session/created', broadcast),
      ctx.on('session/disposed', broadcast),
      ctx.on('api-session/status', broadcast),
      ctx.on('api-session/added', broadcast),
      ctx.on('api-session/removed', broadcast),
    ]
    return () => {
      if (broadcastTimer !== null) {
        clearTimeout(broadcastTimer)
        broadcastTimer = null
      }
      for (const dispose of disposers) {
        try {
          if (typeof dispose === 'function') dispose()
        } catch {
          /* the emitter may already be gone */
        }
      }
    }
  }, 'dsh-run-monitor: change feed')

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          const requestUrl = new URL(req.url ?? '/', 'http://dsh.internal')
          const pathname = requestUrl.pathname
          if (req.method !== 'GET') {
            writeJson(res, 405, { ok: false, error: 'method not allowed' })
            return
          }
          if (pathname === `${ROUTE_PREFIX}/stream`) {
            openStream(res, streams)
            return
          }
          if (pathname !== `${ROUTE_PREFIX}/list`) {
            writeJson(res, 404, { ok: false, error: 'unknown method' })
            return
          }
          try {
            writeJson(res, 200, { ok: true, now: Date.now(), tasks: snapshot(ctx) })
          } catch (error) {
            writeJson(res, 500, { ok: false, error: messageOf(error) })
          }
        },
      }),
    'dsh-run-monitor: task list route',
  )
}

/**
 * Server-sent events: one ping per coalesced burst of session activity, plus a
 * heartbeat so an idle connection stays open. State still comes from /list, so
 * the stream can drop and reconnect without any snapshot bookkeeping.
 */
function openStream(res, streams) {
  if (typeof res.writeHead !== 'function' || typeof res.write !== 'function') {
    writeJson(res, 500, { ok: false, error: 'stream unsupported' })
    return
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  res.write('retry: 2000\n\n')
  streams.add(res)

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      cleanup()
    }
  }, HEARTBEAT_MS)
  if (typeof heartbeat.unref === 'function') heartbeat.unref()

  function cleanup() {
    clearInterval(heartbeat)
    streams.delete(res)
    try {
      res.end()
    } catch {
      /* already closed */
    }
  }

  if (typeof res.on === 'function') {
    res.on('close', cleanup)
    res.on('error', cleanup)
  }
  writeEvent(res, 'hello', {})
}

function writeEvent(res, type, payload) {
  try {
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`)
  } catch {
    /* the close handler drops the stream */
  }
}

function snapshot(ctx) {
  const sessions = ctx.sessions?.list?.() ?? []
  const titles = ctx.get?.('sessionTitle')
  const groups = workspaceLabels(ctx)
  const tasks = []
  const seen = new Set()
  for (const session of sessions) {
    const id = typeof session?.id === 'string' ? session.id : ''
    if (id === '' || seen.has(id)) continue
    if (session?.header?.origin === 'subagent') continue
    seen.add(id)
    try {
      tasks.push(describeSession(session, titles, groups.get(id)))
    } catch (error) {
      tasks.push({
        id,
        title: id,
        state: 'unknown',
        group: groups.get(id),
        updatedAt: 0,
        createdAt: 0,
        lastActivity: messageOf(error),
      })
    }
  }
  tasks.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
  return tasks.slice(0, MAX_TASKS)
}

/**
 * Maps every session to the workspace (directory) that owns it, so the browser
 * half can label each task with the directory it came from.
 */
function workspaceLabels(ctx) {
  const map = new Map()
  let workspaces = []
  try {
    workspaces = ctx.get?.('workspaceRegistry')?.list?.() ?? []
  } catch {
    workspaces = []
  }
  for (const workspace of workspaces) {
    const label = workspaceLabel(workspace)
    for (const sessionId of workspace?.sessionIds ?? []) {
      if (typeof sessionId === 'string' && !map.has(sessionId)) map.set(sessionId, label)
    }
  }
  return map
}

function workspaceLabel(workspace) {
  if (typeof workspace?.title === 'string' && workspace.title.trim() !== '') {
    return { label: clip(workspace.title.trim(), 24), path: typeof workspace.path === 'string' ? workspace.path : '' }
  }
  const path = typeof workspace?.path === 'string' ? workspace.path : ''
  return { label: basename(path), path }
}

function basename(path) {
  const parts = path.split(/[\\/]/u).filter((part) => part !== '')
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

function describeSession(session, titles, group) {
  const header = session?.header ?? {}
  const events = tailEvents(session)
  const last = events.length > 0 ? events[events.length - 1] : undefined
  const turn = turnStateOf(session)
  const pending = turn.open ? pendingOf(events) : null
  const finished = turn.open ? undefined : turn.end

  let state = 'idle'
  if (turn.open) state = pending === null ? 'running' : 'awaiting'
  else if (finished !== undefined) state = 'completed'

  return {
    id: session.id,
    title: titleOf(session, events, titles),
    state,
    group: group ?? { label: basename(typeof header.cwd === 'string' ? header.cwd : ''), path: typeof header.cwd === 'string' ? header.cwd : '' },
    turn: typeof last?.data?.turn === 'number' ? last.data.turn : 0,
    pending: pending === null ? undefined : pending,
    lastActivity: last === undefined ? '' : activityOf(last),
    reason: finished === undefined ? undefined : reasonOf(finished),
    createdAt: numberOr(header.createdAt, 0),
    updatedAt: timeOf(last) || numberOr(header.createdAt, 0),
    finishedAt: finished === undefined ? 0 : timeOf(finished),
    cwd: typeof header.cwd === 'string' ? header.cwd : '',
    agentPreset: typeof header.agentPreset === 'string' ? header.agentPreset : '',
  }
}

function tailEvents(session) {
  if (typeof session?.snapshotEvents !== 'function') return []
  const total = numberOr(session.seq, 0)
  const from = Math.max(0, total - TAIL_EVENTS)
  try {
    return Array.from(session.snapshotEvents(from, total))
  } catch {
    return []
  }
}

function headEvents(session) {
  if (typeof session?.snapshotEvents !== 'function') return []
  const total = numberOr(session.seq, 0)
  try {
    return Array.from(session.snapshotEvents(0, Math.min(total, HEAD_EVENTS)))
  } catch {
    return []
  }
}

/**
 * Walks backwards from the newest event to the nearest turn edge, widening the
 * window when a long turn (many steps) pushes its `turn/start` out of the tail.
 */
function turnStateOf(session) {
  if (typeof session?.snapshotEvents !== 'function') return { open: false, end: undefined }
  const total = numberOr(session.seq, 0)
  let span = TAIL_EVENTS
  for (;;) {
    const from = Math.max(0, total - span)
    let events = []
    try {
      events = Array.from(session.snapshotEvents(from, total))
    } catch {
      return { open: false, end: undefined }
    }
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const type = events[index]?.type
      if (type === 'turn/end') return { open: false, end: events[index] }
      if (type === 'turn/start') return { open: true, end: undefined }
    }
    if (from === 0 || span >= EDGE_SCAN_LIMIT) return { open: false, end: undefined }
    span = Math.min(span * 4, EDGE_SCAN_LIMIT)
  }
}

function pendingOf(events) {
  for (let index = events.length - 1; index >= 0 && index >= events.length - 8; index -= 1) {
    const event = events[index]
    const type = typeof event?.type === 'string' ? event.type : ''
    const data = event?.data ?? {}
    if (type === 'tool/result' || type === 'turn/end') return null
    if (type === 'tool/call') {
      const name = typeof data.name === 'string' ? data.name : ''
      if (isAskTool(name)) return { kind: 'question', tool: name, question: questionOf(data.arguments) }
      continue
    }
    if (PENDING_TYPE_PATTERN.test(type) && !SETTLED_TYPE_PATTERN.test(type)) {
      return { kind: 'approval', tool: type, question: questionOf(data) }
    }
  }
  return null
}

function isAskTool(name) {
  return /ask_user|askuser|ask-user|ask_user_question|user_question|confirm|approval/iu.test(name)
}

function questionOf(input) {
  const value = typeof input === 'string' ? parseJson(input) : input
  if (typeof value === 'string') return clip(value, 160)
  if (value === null || typeof value !== 'object') return ''
  const questions = Array.isArray(value.questions) ? value.questions : undefined
  if (questions !== undefined && questions.length > 0) {
    const first = questions[0]
    const text = typeof first?.question === 'string' ? first.question : typeof first?.header === 'string' ? first.header : ''
    if (text !== '') return clip(text, 160)
  }
  for (const key of ['question', 'prompt', 'summary', 'title', 'reason', 'description', 'detail']) {
    if (typeof value[key] === 'string' && value[key].trim() !== '') return clip(value[key].trim(), 160)
  }
  return ''
}

function activityOf(event) {
  const type = typeof event?.type === 'string' ? event.type : ''
  const data = event?.data ?? {}
  if (type === 'tool/call' && typeof data.name === 'string') return data.name
  if (type === 'assistant/message') return 'assistant/message'
  return type
}

function reasonOf(event) {
  const reason = event?.data?.reason
  if (typeof reason === 'string') return reason
  if (reason !== null && typeof reason === 'object' && typeof reason.kind === 'string') return reason.kind
  return 'completed'
}

function titleOf(session, events, titles) {
  try {
    const snap = titles?.get?.(session)
    if (snap !== undefined && snap !== null && typeof snap.title === 'string' && snap.title.trim() !== '') {
      return snap.title.trim()
    }
  } catch {
    /* title service is optional */
  }
  const firstUser = events.find((event) => event?.type === 'user/message')
  let text = messageText(firstUser?.data?.message)
  if (text === '') {
    const headUser = headEvents(session).find((event) => event?.type === 'user/message')
    text = messageText(headUser?.data?.message)
  }
  if (text !== '') return clip(text, 80)
  const cwd = session?.header?.cwd
  if (typeof cwd === 'string' && cwd !== '') {
    const parts = cwd.split(/[\\/]/u).filter((part) => part !== '')
    if (parts.length > 0) return parts[parts.length - 1]
  }
  return session.id
}

function messageText(message) {
  if (message === null || message === undefined) return ''
  if (typeof message === 'string') return message.replace(/\s+/gu, ' ').trim()
  const content = message.content
  if (typeof content === 'string') return content.replace(/\s+/gu, ' ').trim()
  if (Array.isArray(content)) {
    const parts = []
    for (const block of content) {
      if (block !== null && typeof block === 'object' && typeof block.text === 'string') parts.push(block.text)
    }
    return parts.join(' ').replace(/\s+/gu, ' ').trim()
  }
  if (typeof message.text === 'string') return message.text.replace(/\s+/gu, ' ').trim()
  return ''
}

function timeOf(event) {
  const value = event?.time
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clip(text, limit) {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function writeJson(res, status, body) {
  const text = JSON.stringify(body)
  if (typeof res.writeHead === 'function') {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
  }
  res.end(text)
}
