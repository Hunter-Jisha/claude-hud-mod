export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export type Todo = { text: string; status: TodoStatus }
export type Plan = { goal: string; todos: Todo[] }
export type Meter = { label: string; percent: number; resetsIn?: string }
export type Usage = {
  contextPercent?: number
  contextTokens?: number
  contextWindow: number
  meters: Meter[]
}

export type Section = 'context' | 'goal' | 'todo' | 'usage'
export type Visibility = Record<Section, boolean>

declare module 'claude-code' {
  interface PluginState {
    'session-hud': { plan: Shaped<Plan>; usage: Shaped<Usage | null>; visibility: Shaped<Visibility> }
  }
}
