import { describe, it, expect } from 'vitest'
import {
  FUNDAMENTALS,
  getAllFundamentals,
  getFundamentalById,
  getCategoryForFundamental,
  getSubcategoryById,
  getKPIsForObjective,
} from '../../src/lib/constants/fundamentals'

describe('Fundamentals Data Integrity', () => {
  it('should have all 7 categories', () => {
    expect(FUNDAMENTALS.length).toBe(7)
  })

  it('should have unique IDs across all categories', () => {
    const ids = FUNDAMENTALS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('should have unique IDs across all fundamentals', () => {
    const all = getAllFundamentals()
    const ids = all.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('should have at least one KPI per fundamental', () => {
    const all = getAllFundamentals()
    for (const f of all) {
      expect(f.kpis.length, `${f.id} should have at least 1 KPI`).toBeGreaterThan(0)
    }
  })

  it('should have unique KPI IDs within each fundamental', () => {
    const all = getAllFundamentals()
    for (const f of all) {
      const ids = f.kpis.map((k) => k.id)
      expect(new Set(ids).size, `${f.id} has duplicate KPI IDs`).toBe(ids.length)
    }
  })

  it('should have non-empty labels and descriptions', () => {
    const all = getAllFundamentals()
    for (const f of all) {
      expect(f.label.length, `${f.id} label`).toBeGreaterThan(0)
      expect(f.description.length, `${f.id} description`).toBeGreaterThan(0)
      for (const kpi of f.kpis) {
        expect(kpi.label.length, `${f.id}/${kpi.id} label`).toBeGreaterThan(0)
        expect(kpi.description.length, `${f.id}/${kpi.id} description`).toBeGreaterThan(0)
      }
    }
  })

  it('getFundamentalById should return correct fundamental', () => {
    const wm = getFundamentalById('wave_management')
    expect(wm).toBeDefined()
    expect(wm!.label).toBe('Wave Management')
  })

  it('getFundamentalById should return undefined for unknown ID', () => {
    expect(getFundamentalById('nonexistent')).toBeUndefined()
  })

  it('getCategoryForFundamental should return correct category', () => {
    const cat = getCategoryForFundamental('spacing')
    expect(cat).toBeDefined()
    expect(cat!.id).toBe('micro')
  })

  it('wave_management should have subcategories', () => {
    const wm = getFundamentalById('wave_management')
    expect(wm?.subcategories).toBeDefined()
    expect(wm!.subcategories!.length).toBeGreaterThanOrEqual(4)
  })

  it('getSubcategoryById should find freeze under wave_management', () => {
    const freeze = getSubcategoryById('wave_management', 'freeze')
    expect(freeze).toBeDefined()
    expect(freeze!.label).toBe('Freeze')
    expect(freeze!.kpis.length).toBeGreaterThan(0)
  })

  it('getKPIsForObjective should return subcategory KPIs when subcategoryId given', () => {
    const kpis = getKPIsForObjective('wave_management', 'freeze')
    expect(kpis.length).toBeGreaterThan(0)
    expect(kpis.some((k) => k.id.includes('freeze'))).toBe(true)
  })

  it('getKPIsForObjective should return fundamental KPIs when no subcategoryId', () => {
    const kpis = getKPIsForObjective('wave_management')
    expect(kpis.length).toBeGreaterThan(0)
  })

  it('vision_control should have subcategories', () => {
    const vc = getFundamentalById('vision_control')
    expect(vc?.subcategories).toBeDefined()
    expect(vc!.subcategories!.length).toBeGreaterThanOrEqual(3)
  })
})
