import type { StrategyTree } from '../../types/bt'
import { loadSettings } from '../../api/bt'
import type { BtStore } from './btStore'

export const BUILDER_PRESET_KEY = 'bt-builder-preset:v1'

export type BuilderBacktestConfig = {
  initial_capital: number
  integer_positions: boolean
  simple_fn: string
  start: string | null
  end: string | null
  price_column: 'close' | 'adj_close'
}

export type StoredPreset = {
  tickerStart: string | null
  tickerEnd: string | null
  priceColumn: 'close' | 'adj_close'
  extraSourceIds: Record<string, number>
  indicatorSourceIds: number[]
  backtestConfig: BuilderBacktestConfig
  selectedId: string | null
  showIndicators: boolean
}

function getToday(): string {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}

function getOneYearAgo(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 1)
  return d.toISOString().slice(0, 10)
}

export function loadStoredPreset(): StoredPreset | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(BUILDER_PRESET_KEY) : null
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<StoredPreset>
    return {
      tickerStart: (p.tickerStart as string | null) ?? getOneYearAgo(),
      tickerEnd: (p.tickerEnd as string | null) ?? getToday(),
      priceColumn: (p.priceColumn as 'close' | 'adj_close') ?? loadSettings().price_column,
      extraSourceIds: (p.extraSourceIds as Record<string, number>) ?? {},
      indicatorSourceIds: (p.indicatorSourceIds as number[]) ?? [],
      backtestConfig: p.backtestConfig ?? {
        initial_capital: loadSettings().initial_capital,
        integer_positions: loadSettings().integer_positions,
        simple_fn: loadSettings().simple_fn,
        start: getOneYearAgo(),
        end: getToday(),
        price_column: loadSettings().price_column,
      },
      selectedId: (p.selectedId as string | null) ?? null,
      showIndicators: Boolean(p.showIndicators),
    }
  } catch {
    return null
  }
}

export function saveStoredPreset(p: StoredPreset): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(BUILDER_PRESET_KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

export function defaultPreset(): StoredPreset {
  return {
    tickerStart: getOneYearAgo(),
    tickerEnd: getToday(),
    priceColumn: 'close',
    extraSourceIds: {},
    indicatorSourceIds: [],
    backtestConfig: {
      initial_capital: loadSettings().initial_capital,
      integer_positions: loadSettings().integer_positions,
      simple_fn: loadSettings().simple_fn,
      start: getOneYearAgo(),
      end: getToday(),
      price_column: loadSettings().price_column,
    },
    selectedId: null,
    showIndicators: false,
  }
}

// build preset object to embed into tree_json for per-strategy persistence
export function buildPresetForTree(get: () => BtStore): Record<string, unknown> {
  const s = get()
  return {
    ticker_start: s.tickerStart,
    ticker_end: s.tickerEnd,
    price_column: s.priceColumn,
    extra_source_ids: s.extraSourceIds,
    indicator_source_ids: s.indicatorSourceIds,
    config: {
      initial_capital: s.backtestConfig.initial_capital,
      integer_positions: s.backtestConfig.integer_positions,
      commission: { type: 'simple', simple_fn: s.backtestConfig.simple_fn || null },
      start: s.backtestConfig.start,
      end: s.backtestConfig.end,
      price_column: s.backtestConfig.price_column,
    },
    selected_node_id: s.selectedId,
  }
}

export function applyPresetToTree(tree: StrategyTree, preset: Record<string, unknown> | null | undefined): StrategyTree {
  if (!preset) return tree
  return { ...tree, preset } as unknown as StrategyTree
}
