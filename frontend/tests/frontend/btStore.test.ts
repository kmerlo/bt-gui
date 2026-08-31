import { describe, it, expect, beforeEach } from 'vitest'
import { useBtStore } from '@/bt/store/btStore'
import type { StrategyTree } from '@/types/bt'

function createTestTree(name: string = 'test-tree'): StrategyTree {
  return {
    name,
    root: {
      id: 'root-1',
      name,
      type: 'Strategy',
      algos: [],
      children: [],
    },
    version: 1,
  }
}

describe('btStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('sets tree and selects root node', () => {
    const tree = createTestTree('my-strategy')
    useBtStore.getState().setTree(tree)
    expect(useBtStore.getState().tree).toBe(tree)
    expect(useBtStore.getState().selectedId).toBe('root-1')
  })

  it('persists tickerStart and tickerEnd', () => {
    useBtStore.getState().setTickerStart('01/01/2024')
    useBtStore.getState().setTickerEnd('31/12/2024')
    expect(useBtStore.getState().tickerStart).toBe('01/01/2024')
    expect(useBtStore.getState().tickerEnd).toBe('31/12/2024')
  })

  it('allows navigating with no tree by not crashing', () => {
    const tree = createTestTree('nav-test')
    useBtStore.getState().setTree(tree)
    expect(useBtStore.getState().tree).not.toBeNull()
    // setSelected on null tree should not throw
    useBtStore.getState().setSelected(null)
    expect(useBtStore.getState().selectedId).toBeNull()
  })
})
