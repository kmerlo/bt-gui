import { describe, expect, it } from 'vitest'
import { buildCommissionFn, previewCommissionCost, resolveCommissionFn, validateCommission } from './commission'
import type { CommissionFlags, CommissionParams } from './commission'

const NOP: CommissionParams = { my_commissions_min: null, my_commissions_max: null, my_commissions_perc: null }
const OFF: CommissionFlags = { commission_formula_enabled: false, commission_params_enabled: false }
const USE_FORMULA: CommissionFlags = { commission_formula_enabled: true, commission_params_enabled: false }
const USE_PARAMS: CommissionFlags = { commission_formula_enabled: false, commission_params_enabled: true }
const BOTH: CommissionFlags = { commission_formula_enabled: true, commission_params_enabled: true }

describe('validateCommission', () => {
  it('tutto spento e vuoto = valido (nessuna commissione)', () => {
    expect(validateCommission('', NOP, OFF)).toBe('')
  })
  it('valori precompilati ma flag spenti = valido e ignorato', () => {
    expect(validateCommission('lambda q,p: q', { my_commissions_min: 1, my_commissions_max: null, my_commissions_perc: 0.1 }, OFF)).toBe('')
    expect(resolveCommissionFn('lambda q,p: q', { my_commissions_min: 1, my_commissions_max: null, my_commissions_perc: 0.1 }, OFF)).toBe('')
  })
  it('entrambi i flag = errore', () => {
    expect(validateCommission('lambda q,p: q*p', { my_commissions_min: 1, my_commissions_max: null, my_commissions_perc: 0.1 }, BOTH)).toContain('non entrambi')
  })
  it('flag formula richiede formula valida', () => {
    expect(validateCommission('', NOP, USE_FORMULA)).toContain('vuota')
    expect(validateCommission('no-lambda', NOP, USE_FORMULA)).toContain('lambda')
    expect(validateCommission('lambda q,p: q*p*0.001', NOP, USE_FORMULA)).toBe('')
  })
  it('flag parametri richiede parametri validi', () => {
    expect(validateCommission('', NOP, USE_PARAMS)).toContain('nessun parametro')
    expect(validateCommission('', { my_commissions_min: 1, my_commissions_max: null, my_commissions_perc: null }, USE_PARAMS)).toContain('perc')
    expect(validateCommission('', { my_commissions_min: 5, my_commissions_max: 2, my_commissions_perc: 0.1 }, USE_PARAMS)).toContain('max ≥ min')
    expect(validateCommission('', { my_commissions_min: 1, my_commissions_max: 100, my_commissions_perc: 0.1 }, USE_PARAMS)).toBe('')
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
  it('flag formula: raw vince', () => {
    expect(resolveCommissionFn('lambda q,p: q', { my_commissions_min: 1, my_commissions_max: null, my_commissions_perc: 0.1 }, USE_FORMULA)).toBe('lambda q,p: q')
  })
  it('flag parametri: genera', () => {
    expect(resolveCommissionFn('', { my_commissions_min: 1, my_commissions_max: 100, my_commissions_perc: 0.1 }, USE_PARAMS))
      .toBe('lambda q,p: max(1, min(100, p*abs(q)*0.001))')
  })
  it('preview ricalca floor/cap', () => {
    expect(previewCommissionCost({ my_commissions_min: 1, my_commissions_max: 100, my_commissions_perc: 0.1 }, 1000, 100)).toBeCloseTo(100)
    expect(previewCommissionCost({ my_commissions_min: 1, my_commissions_max: 100, my_commissions_perc: 0.1 }, 10, 1)).toBeCloseTo(1)
  })
})
