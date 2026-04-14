import { describe, it, expect } from 'vitest'
import {
  FUNDAMENTALS,
  getAllFundamentals,
  getFundamentalById,
  getCategoryForFundamental,
  getSubcategoryById,
  getKPIsForObjective,
} from '../../src/lib/constants/fundamentals'
import { SESSION_TEMPLATES, validateTemplates } from '../../src/lib/constants/sessionTemplates'

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

describe('Session Templates Integrity', () => {
  it('should have unique template IDs', () => {
    const ids = SESSION_TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('should have at least one template', () => {
    expect(SESSION_TEMPLATES.length).toBeGreaterThan(0)
  })

  it('every template should have 1-3 objectives', () => {
    for (const tpl of SESSION_TEMPLATES) {
      expect(tpl.objectiveIds.length, `${tpl.id} should have 1-3 objectives`).toBeGreaterThanOrEqual(1)
      expect(tpl.objectiveIds.length, `${tpl.id} should have at most 3 objectives`).toBeLessThanOrEqual(3)
    }
  })

  it('every template should have at least one KPI', () => {
    for (const tpl of SESSION_TEMPLATES) {
      expect(tpl.selectedKpiIds.length, `${tpl.id} should have at least 1 KPI`).toBeGreaterThan(0)
    }
  })

  it('every template should have a non-empty customNote', () => {
    for (const tpl of SESSION_TEMPLATES) {
      expect(tpl.customNote.length, `${tpl.id} should have a note`).toBeGreaterThan(0)
    }
  })

  it('validateTemplates should return zero errors', () => {
    const errors = validateTemplates()
    expect(errors, `Template validation errors:\n${errors.join('\n')}`).toEqual([])
  })

  it('every objectiveId should reference an existing fundamental', () => {
    const allFundamentals = getAllFundamentals()
    const allIds = new Set(allFundamentals.map((f) => f.id))
    for (const tpl of SESSION_TEMPLATES) {
      for (const objId of tpl.objectiveIds) {
        expect(allIds.has(objId), `${tpl.id}: unknown objective "${objId}"`).toBe(true)
      }
    }
  })

  it('every selectedKpiId should belong to one of the template objectives', () => {
    const allFundamentals = getAllFundamentals()
    for (const tpl of SESSION_TEMPLATES) {
      const validKpis = new Set<string>()
      for (const objId of tpl.objectiveIds) {
        const f = allFundamentals.find((ff) => ff.id === objId)
        if (!f) continue
        for (const k of f.kpis) validKpis.add(k.id)
        for (const sub of f.subcategories ?? []) {
          for (const k of sub.kpis) validKpis.add(k.id)
        }
      }
      for (const kpiId of tpl.selectedKpiIds) {
        expect(validKpis.has(kpiId), `${tpl.id}: KPI "${kpiId}" not in any of its objectives`).toBe(true)
      }
    }
  })
})
