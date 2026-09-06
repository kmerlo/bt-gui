import { describe, expect, it } from 'vitest'
import type { StrategyTree } from '../../types/bt'
import { collectReferencedIds } from './collectIds'

function treeWith(root: unknown, preset?: unknown): StrategyTree {
  return { name: 't', root, preset } as unknown as StrategyTree
}

describe('collectReferencedIds', () => {
  it('raccoglie params numerici da algos annidati, unici e ordinati', () => {
    const tree = treeWith({
      name: 'r', type: 'Strategy', params: {}, children: [
        { name: 'c', type: 'Strategy', params: {}, children: [], algos: [{ class_name: 'SelectWhere', params: { signal: '7' } }] },
      ],
      algos: [{ class_name: 'WeighTarget', params: { weights: '12' } }, { class_name: 'X', params: { note: 'abc', n: '12' } }],
    })
    expect(collectReferencedIds(tree)).toEqual([7, 12])
  })

  it('include le liste preset e ignora valori non interi', () => {
    const tree = treeWith(
      { name: 'r', type: 'Strategy', params: {}, children: [], algos: [] },
      { indicator_source_ids: [3, 'x'], signal_source_ids: [5, 3.5] },
    )
    expect(collectReferencedIds(tree)).toEqual([3, 5])
  })

  it('null/undefined → []', () => {
    expect(collectReferencedIds(null)).toEqual([])
    expect(collectReferencedIds(undefined)).toEqual([])
  })
})
