import type { NodeConfig } from '../../types/bt'

export function collectTickers(node: NodeConfig): string[] {
  const tickers: string[] = []
  const walk = (n: NodeConfig) => {
    if (n.type === 'Security' || n.type === 'HedgeSecurity' || n.type === 'CouponPayingSecurity') {
      const t = n.name.trim().toUpperCase()
      if (t && t !== 'NEW_TICKER') tickers.push(t)
    }
    for (const c of n.children) walk(c)
  }
  walk(node)
  return tickers
}
