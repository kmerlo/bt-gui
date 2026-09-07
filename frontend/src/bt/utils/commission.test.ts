import { describe, expect, it } from 'vitest'
import { buildCommissionFn, previewCommissionCost, resolveCommissionFn, validateCommission } from './commission'

describe('validateCommission', () => {
  it('accetta formula sola', () => {
    expect(validateCommission('lambda q,p: q*p*0.001', { my_commissions_min: null, my_commissions_max: null, my_commissions_perc: null })).toBe('')
  })
  it('rifiuta formula + parametri insieme', () => {
    expect(validateCommission('lambda q,p: q', { my_commissions_min: 1, my_commissions_max: null, my_commissions_perc: 0.1 })).toContain('non entrambi')
  })
  it('richiede perc e range validi in modo parametrico', () => {
    expect(validateCommission('', { my_commissions_min: 1, my_commissions_max: null, my_commissions_perc: null })).toContain('perc')
    expect(validateCommission('', { my_commissions_min: 5, my_commissions_max: 2, my_commissions_perc: 0.1 })).toContain('max ≥ min')
  })
})

describe('buildCommissionFn', () => {
  it('compone floor + cap con perc in %', () => {
    expect(buildCommissionFn({ my_commissions_min: 1, my_commissions_max: 100, my_commissions_perc: 0.1 }))
      .toBe('lambda q,p: max(1, min(100, p*abs(q)*0.001))')
  })
  it('omette il cap se max vuoto', () => {
    expect(buildCommissionFn({ my_commissions_min: 5, my_commissions_max: null, my_commissions_perc: 0.2 }))
      .toBe('lambda q,p: max(5, p*abs(q)*0.002)')
  })
})

describe('resolve + preview', () => {
  it('la formula raw vince sui parametri', () => {
    expect(resolveCommissionFn('lambda q,p: q', { my_commissions_min: 1, my_commissions_max: null, my_commissions_perc: 0.1 })).toBe('lambda q,p: q')
  })
  it('preview ricalca floor/cap', () => {
    expect(previewCommissionCost({ my_commissions_min: 1, my_commissions_max: 100, my_commissions_perc: 0.1 }, 1000, 100)).toBeCloseTo(100)
    expect(previewCommissionCost({ my_commissions_min: 1, my_commissions_max: 100, my_commissions_perc: 0.1 }, 10, 1)).toBeCloseTo(1)
  })
})
