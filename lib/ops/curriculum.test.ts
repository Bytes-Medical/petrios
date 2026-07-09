import { describe, expect, it } from 'vitest'
import { buildCoverage, deterministicDomainMatch } from './curriculum'
import type { OpsCurriculumDomain, OpsCurriculumMapping } from '@/lib/types'

describe('deterministicDomainMatch', () => {
  it('matches clinical topics to patient_management', () => {
    expect(deterministicDomainMatch('Sepsis in the under 5s')).toContain('patient_management')
  })

  it('matches safeguarding keywords', () => {
    expect(deterministicDomainMatch('Child protection basics')).toContain('safeguarding')
  })

  it('matches on description text and is case-insensitive', () => {
    expect(deterministicDomainMatch('Morning teaching', 'Journal Club critical APPRAISAL')).toContain(
      'research_scholarship'
    )
  })

  it('can return multiple domains', () => {
    const codes = deterministicDomainMatch('Safe prescribing audit')
    expect(codes).toContain('patient_safety')
    expect(codes).toContain('quality_improvement')
  })

  it('returns empty for unmatched titles', () => {
    expect(deterministicDomainMatch('Welcome and housekeeping')).toEqual([])
  })

  it('is deterministic', () => {
    const a = deterministicDomainMatch('DKA management', 'fluids and monitoring')
    const b = deterministicDomainMatch('DKA management', 'fluids and monitoring')
    expect(a).toEqual(b)
  })
})

describe('buildCoverage', () => {
  const domains: OpsCurriculumDomain[] = [
    { code: 'a', name: 'Domain A', description: null, sort: 1 },
    { code: 'b', name: 'Domain B', description: null, sort: 2 },
  ]

  const mapping = (sessionId: string, domainCode: string): OpsCurriculumMapping => ({
    id: `${sessionId}-${domainCode}`,
    org_id: 'org',
    session_id: sessionId,
    domain_code: domainCode,
    confidence: 'deterministic',
    rationale: null,
    created_at: '2026-01-01',
  })

  it('counts distinct sessions per domain and reports zero-coverage domains', () => {
    const coverage = buildCoverage(
      domains,
      [mapping('s1', 'a'), mapping('s2', 'a'), mapping('s1', 'a')],
      new Set(['s1', 's2'])
    )
    expect(coverage).toEqual([
      { code: 'a', name: 'Domain A', sessionCount: 2 },
      { code: 'b', name: 'Domain B', sessionCount: 0 },
    ])
  })

  it('ignores mappings for sessions outside the requested window', () => {
    const coverage = buildCoverage(domains, [mapping('old', 'a')], new Set(['s1']))
    expect(coverage[0].sessionCount).toBe(0)
  })
})
