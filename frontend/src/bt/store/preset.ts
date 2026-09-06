import type { StrategyTree } from '../../types/bt'
import { loadSettings } from '../../api/settings'
import type { BtStore } from './btStore'

export const BUILDER_PRESET_KEY = 'bt-builder-preset:v1'

export type BuilderBacktestConfig = {
  initial_capital: number
  integer_positions: boolean
  simple_fn: string
  start: string | null
  end: string | null
  price_column: 'close' | 'adj_close'
  benchmark_ticker: string
  tax_enabled: boolean
  tax_gain_rate: number
  tax_div_rate: number
  tax_use_carry: boolean
  ticker_tax_profile: Record<string, number>
}

export type StoredPreset = {
  tickerStart: string | null
  tickerEnd: string | null
  extraSourceIds: Record<string, number>
  indicatorSourceIds: number[]
  backtestConfig: BuilderBacktestConfig
  selectedId: string | null
  showIndicators: boolean
  showSignals: boolean
  showPalette: boolean
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
    const cfg = (p.backtestConfig ?? {}) as Partial<BuilderBacktestConfig>
    return {
      tickerStart: (p.tickerStart as string | null) ?? getOneYearAgo(),
      tickerEnd: (p.tickerEnd as string | null) ?? getToday(),
      extraSourceIds: (p.extraSourceIds as Record<string, number>) ?? {},
      indicatorSourceIds: (p.indicatorSourceIds as number[]) ?? [],
      backtestConfig: {
        initial_capital: cfg.initial_capital ?? loadSettings().initial_capital,
        integer_positions: cfg.integer_positions ?? loadSettings().integer_positions,
        simple_fn: cfg.simple_fn ?? loadSettings().simple_fn,
        start: cfg.start ?? getOneYearAgo(),
        end: cfg.end ?? getToday(),
        price_column: cfg.price_column ?? loadSettings().price_column,
        // ponytail: backfill per preset salvati prima del benchmark
        benchmark_ticker: (cfg.benchmark_ticker ?? 'SPY').toUpperCase() || 'SPY',
        // ponytail: backfill fiscale (default 26% + zainetto ON)
        tax_enabled: cfg.tax_enabled ?? true,
        tax_gain_rate: cfg.tax_gain_rate ?? 26,
        tax_div_rate: cfg.tax_div_rate ?? 26,
        tax_use_carry: cfg.tax_use_carry ?? true,
        ticker_tax_profile: (cfg.ticker_tax_profile as Record<string, number>) ?? {},
      },
      selectedId: (p.selectedId as string | null) ?? null,
      showIndicators: Boolean(p.showIndicators),
      showSignals: Boolean(p.showSignals),
      showPalette: p.showPalette !== false,
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
    extraSourceIds: {},
    indicatorSourceIds: [],
    backtestConfig: {
      initial_capital: loadSettings().initial_capital,
      integer_positions: loadSettings().integer_positions,
      simple_fn: loadSettings().simple_fn,
      start: getOneYearAgo(),
      end: getToday(),
      price_column: loadSettings().price_column,
      benchmark_ticker: 'SPY',
      tax_enabled: true,
      tax_gain_rate: 26,
      tax_div_rate: 26,
      tax_use_carry: true,
      ticker_tax_profile: {},
    },
    selectedId: null,
    showIndicators: false,
    showSignals: false,
    showPalette: true,
  }
}

// build preset object to embed into tree_json for per-strategy persistence
export function buildPresetForTree(get: () => BtStore): Record<string, unknown> {
  const s = get()
  return {
    ticker_start: s.tickerStart,
    ticker_end: s.tickerEnd,
    extra_source_ids: s.extraSourceIds,
    indicator_source_ids: s.indicatorSourceIds,
    config: {
      initial_capital: s.backtestConfig.initial_capital,
      integer_positions: s.backtestConfig.integer_positions,
      commission: { type: 'simple', simple_fn: s.backtestConfig.simple_fn || null },
      start: s.backtestConfig.start,
      end: s.backtestConfig.end,
      benchmark_ticker: s.backtestConfig.benchmark_ticker || 'SPY',
      tax: {
        enabled: s.backtestConfig.tax_enabled,
        default_gain_rate: s.backtestConfig.tax_gain_rate,
        default_div_rate: s.backtestConfig.tax_div_rate,
        use_loss_carry: s.backtestConfig.tax_use_carry,
      },
      ticker_tax_profiles: s.backtestConfig.ticker_tax_profile,
    },
    selected_node_id: s.selectedId,
  }
}

export function applyPresetToTree(tree: StrategyTree, preset: Record<string, unknown> | null | undefined): StrategyTree {
  if (!preset) return tree
  return { ...tree, preset } as unknown as StrategyTree
}
