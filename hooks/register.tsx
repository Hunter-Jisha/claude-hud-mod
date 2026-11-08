import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Meter, Plan, Section, Todo, TodoStatus, Usage, Visibility } from '../types'

const PANE = 'session-hud'
const TITLE = 'Session'
const VISIBILITY_STORE_KEY = 'visibility'

const defaultVisibility: Visibility = { context: true, goal: true, todo: true, usage: true }
const sectionNames: Record<Section, string> = { context: 'Context', goal: 'Goal', todo: 'Todo', usage: 'Plan usage' }

const plan = atom({ plugin: 'session-hud', key: 'plan' } as const, { goal: '', todos: [] }, { shape: 'plan-1' })
const usage = atom({ plugin: 'session-hud', key: 'usage' } as const, null, { shape: 'usage-1' })
const visibility = atom({ plugin: 'session-hud', key: 'visibility' } as const, defaultVisibility, {
  shape: 'visibility-1',
})

const meterLabels: Record<string, string> = {
  five_hour: 'Session',
  seven_day: 'Weekly',
  seven_day_opus: 'Weekly Opus',
  seven_day_sonnet: 'Weekly Sonnet',
  spend_limit: 'Spend',
}

const todoStatuses: TodoStatus[] = ['pending', 'in_progress', 'completed']

const formatDuration = (milliseconds: number) => {
  const minutes = Math.max(0, Math.round(milliseconds / 60000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`

  return `${minutes}m`
}

const formatTokens = (tokens: number) =>
  tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : `${Math.round(tokens / 1000)}k`

const barCells = (percent: number | undefined, width: number) => {
  const filledCells = Math.round((Math.min(100, Math.max(0, percent ?? 0)) / 100) * width)

  return { filled: '█'.repeat(filledCells), empty: '░'.repeat(width - filledCells) }
}

const truncate = (text: string, length: number) =>
  text.length <= length ? text : `${text.slice(0, Math.max(0, length - 1))}…`

async function refreshUsage($: EngineInterface) {
  const sessionUsage = await $.session.usage()
  const now = await $.clock.now()
  const meters: Meter[] = sessionUsage.rateLimits.map(limit => ({
    label: meterLabels[limit.kind] ?? limit.kind,
    percent: limit.percentUsed,
    resetsIn: limit.resetsAt ? formatDuration(Date.parse(limit.resetsAt) - now) : undefined,
  }))
  const nextUsage: Usage = {
    contextPercent: sessionUsage.context.percent,
    contextTokens: sessionUsage.context.tokens,
    contextWindow: sessionUsage.context.window,
    meters,
  }

  await update($, usage, () => nextUsage)
}

const compactLabels: Record<string, string> = { Session: '5h', Weekly: 'wk' }

const compactView = (
  { Box, Text }: ReturnType<EngineInterface['ui']['resolve']>,
  currentPlan: Plan,
  currentUsage: Usage | null,
  currentVisibility: Visibility,
  columns: number,
) => {
  const compactMeters = [
    ...(currentVisibility.context ? [{ label: 'context', percent: currentUsage?.contextPercent }] : []),
    ...(currentVisibility.usage ? currentUsage?.meters ?? [] : []).map(meter => ({
      label: compactLabels[meter.label] ?? meter.label.toLowerCase(),
      percent: meter.percent as number | undefined,
    })),
  ]
  const isGoalShown = currentVisibility.goal && currentPlan.goal !== ''

  if (!isGoalShown && compactMeters.length === 0) return undefined

  return (
    <Box flexDirection="column">
      {isGoalShown && (
        <Text>
          <Text weight="semibold">Goal: </Text>
          {truncate(currentPlan.goal, Math.max(0, columns - 8))}
        </Text>
      )}
      {compactMeters.length > 0 && <Text>
        {compactMeters.map((meter, index) => {
          const cells = barCells(meter.percent, 6)

          return (
            <Text>
              <Text dimColor>{`${index > 0 ? '  ' : ''}${meter.label} `}</Text>
              <Text color="text">{cells.filled}</Text>
              <Text color="subtle">{cells.empty}</Text>
              <Text tabular>{` ${meter.percent === undefined ? '—' : `${Math.round(meter.percent)}%`}`}</Text>
            </Text>
          )
        })}
      </Text>}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'plan',
      isDeferred: false,
      description:
        "Updates the session HUD the user watches beside the chat. Call it at the start of any multi-step task with a one-line goal and the ordered steps you will take, and call it again whenever a step starts or finishes, or the plan changes. Always send the whole todo list. Keep exactly one item in_progress while working. Skip it for one-step answers.",
      inputSchema: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'High-level goal currently being worked on, one short line' },
          todos: {
            type: 'array',
            description: 'The full ordered todo list',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                status: { type: 'string', enum: todoStatuses },
              },
              required: ['text', 'status'],
            },
          },
        },
      },
    })
    await $.command.register({
      name: 'hud',
      description: 'Open the session HUD sidebar, or toggle a section',
      argumentHint: '[context|goal|todo|usage]',
    })
    const storedVisibility = (await $.store.get(VISIBILITY_STORE_KEY)) as Partial<Visibility> | undefined
    await update($, visibility, () => ({ ...defaultVisibility, ...storedVisibility }))
    void $.ui.open({ id: PANE, title: TITLE })
    void refreshUsage($)
    $.clock.every(30000, () => void refreshUsage($))

    return next(e)
  })

  on('command.run', { command: 'hud' }, async ($, e) => {
    const requestedSection = e.args.trim().toLowerCase().replace(/[\s-]/g, '')

    if (requestedSection === '') {
      const opened = await $.ui.open({ id: PANE, title: TITLE })

      return { text: opened.isPlaced ? 'Session HUD opened.' : `Session HUD not placed: ${opened.reason}` }
    }

    if (!(requestedSection in defaultVisibility)) {
      return { text: `Unknown section "${e.args.trim()}". Use context, goal, todo or usage.` }
    }

    const section = requestedSection as Section
    const nextVisibility = await update($, visibility, current => ({ ...current, [section]: !current[section] }))
    await $.store.set(VISIBILITY_STORE_KEY, nextVisibility)

    return { text: `${sectionNames[section]} ${nextVisibility[section] ? 'shown' : 'hidden'}.` }
  })

  on('tool.call', { tool: 'mcp__session-hud__plan' }, async ($, e) => {
    const input = e as unknown as { goal?: string; todos?: Todo[] }
    await update($, plan, current => ({
      goal: input.goal ?? current.goal,
      todos: input.todos ?? current.todos,
    }))

    return { result: 'HUD updated.' }
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const result = await next(e)
    await update($, plan, current => ({
      ...current,
      todos: e.todos.map(todo => ({ text: todo.content, status: todo.status })),
    }))

    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    void refreshUsage($).catch(() => undefined)

    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await refreshUsage($)

    return next(e)
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const result = await next(e)
    $.ui.invalidate('ui.render')

    return result
  })

  let isPaneDocked = false

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const docked = e.props.placement === 'dock'

    if (docked !== isPaneDocked) {
      isPaneDocked = docked
      $.ui.invalidate('ui.render')
    }

    if (!docked) {
      void $.ui.close({ id: PANE })

      return <Text dimColor>…</Text>
    }

    const currentPlan = await read($, plan)
    const currentUsage = await read($, usage)
    const currentVisibility = await read($, visibility)

    if (!Object.values(currentVisibility).some(Boolean)) {
      return <Text dimColor>All sections hidden. /hud context, goal, todo or usage shows one.</Text>
    }

    const contentColumns = Math.max(16, e.props.bodyColumns - 2)
    const percentColumns = 5
    const labelColumns = 8

    const percentText = (percent: number | undefined) =>
      (percent === undefined ? '—' : `${Math.round(percent)}%`).padStart(percentColumns)

    const barRow = (percent: number | undefined, label?: string) => {
      const cells = barCells(percent, Math.max(6, contentColumns - percentColumns - (label ? labelColumns : 0)))

      return (
        <Box flexDirection="row">
          {label && (
            <Box width={labelColumns}>
              <Text>{label}</Text>
            </Box>
          )}
          <Text>
            <Text color="text">{cells.filled}</Text>
            <Text color="subtle">{cells.empty}</Text>
            <Text color="text" weight="semibold" tabular>
              {percentText(percent)}
            </Text>
          </Text>
        </Box>
      )
    }

    const section = (title: string, children: RenderChildren) => (
      <Box flexDirection="column" paddingX={1} marginBottom={1}>
        <Text dimColor weight="bold" size="caption">
          {title}
        </Text>
        {children}
      </Box>
    )

    const contextDetail =
      currentUsage?.contextTokens === undefined
        ? undefined
        : `${formatTokens(currentUsage.contextTokens)} / ${formatTokens(currentUsage.contextWindow)} tokens`

    return (
      <Box flexDirection="column">
        {currentVisibility.context && section(
          'CONTEXT',
          <Box flexDirection="column">
            {barRow(currentUsage?.contextPercent)}
            {contextDetail && (
              <Text dimColor size="caption">
                {contextDetail}
              </Text>
            )}
          </Box>,
        )}

        {currentVisibility.goal && section(
          'GOAL',
          currentPlan.goal ? <Text weight="semibold">{currentPlan.goal}</Text> : <Text dimColor>No goal set</Text>,
        )}

        {currentVisibility.todo && section(
          'TODO',
        <Box flexDirection="column">
          {currentPlan.todos.length === 0 && <Text dimColor>Nothing planned</Text>}
          {currentPlan.todos.map((todo, index) => (
            <Text>
              <Text dimColor tabular>
                {`${index + 1}.`.padEnd(4)}
              </Text>
              {todo.status === 'completed' && (
                <Text color="success">
                  {'☑ '}
                  <Text strikethrough>{todo.text}</Text>
                </Text>
              )}
              {todo.status === 'in_progress' && (
                <Text color="claude" weight="semibold">
                  {'▣ '}
                  {todo.text}
                </Text>
              )}
              {todo.status === 'pending' && <Text>{`☐ ${todo.text}`}</Text>}
            </Text>
          ))}
        </Box>,
        )}

        {currentVisibility.usage && section(
          'PLAN USAGE',
          <Box flexDirection="column">
            {(currentUsage?.meters.length ?? 0) === 0 && <Text dimColor>No reading yet</Text>}
            {currentUsage?.meters.map(meter => barRow(meter.percent, meter.label))}
          </Box>,
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const panes = await $.ui.panes()
    const isPaneOpen = panes.some(pane => pane.id === PANE)
    const isPaneShown = panes.some(pane => pane.id === PANE && pane.isPlaced && pane.isShown)
    if (isPaneOpen && isPaneShown && isPaneDocked) return next(e)

    const compactTree = compactView(
      $.ui.resolve(e),
      await read($, plan),
      await read($, usage),
      await read($, visibility),
      e.props.bodyColumns,
    )

    return compactTree ?? next(e)
  })
}
