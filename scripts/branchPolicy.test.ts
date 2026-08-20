import { describe, expect, it } from 'vitest'
import { findPolicyViolations, formatViolations, type CommitRecord } from './branchPolicy'

/**
 * Tested against constructed histories rather than only this repo's, so the rule
 * is checked directly instead of by whether today's history happens to be clean.
 */

const BASELINE = 'base000'

function merge(sha: string, branch: string): CommitRecord {
  return { sha, parents: ['p1', 'p2'], subject: `Merge feat/${branch}` }
}

function direct(sha: string, subject: string): CommitRecord {
  return { sha, parents: ['p1'], subject }
}

const baselineCommit: CommitRecord = { sha: BASELINE, parents: ['p1', 'p2'], subject: 'Merge feat/first' }

describe('a clean history passes', () => {
  it('accepts merges from feat branches', () => {
    const history = [merge('aaa', 'thing'), merge('bbb', 'other'), baselineCommit]
    expect(findPolicyViolations(history, BASELINE)).toEqual([])
  })

  it('says so plainly', () => {
    expect(formatViolations([])).toContain('came through a feat/ branch')
  })
})

describe('the slip this exists to catch', () => {
  it('fails a commit made straight onto main', () => {
    // Exactly what happened: work committed while still on main, caught only by
    // noticing afterwards.
    const history = [
      direct('bad1', 'Audit every explanation path for singular reporting'),
      merge('aaa', 'thing'),
      baselineCommit,
    ]
    const violations = findPolicyViolations(history, BASELINE)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.sha).toBe('bad1')
    expect(violations[0]!.reason).toContain('committed straight onto main')
  })

  it('and the message says how to put it right', () => {
    const violations = findPolicyViolations(
      [direct('bad1', 'oops'), baselineCommit],
      BASELINE,
    )
    const text = formatViolations(violations)
    expect(text).toContain('Branch policy FAILED')
    expect(text).toContain('git branch feat/<thing>')
    expect(text).toContain('git merge --no-ff')
  })

  it('catches several, not just the first', () => {
    // The audit's own lesson applied to the check that came out of it.
    const history = [
      direct('bad2', 'second slip'),
      direct('bad1', 'first slip'),
      merge('aaa', 'thing'),
      baselineCommit,
    ]
    expect(findPolicyViolations(history, BASELINE).map((v) => v.sha)).toEqual(['bad2', 'bad1'])
  })
})

describe('a merge that does not name a feat branch', () => {
  it('is flagged, because a merge from anywhere is not the policy', () => {
    const history = [
      { sha: 'ccc', parents: ['p1', 'p2'], subject: 'Merge branch hotfix/urgent' },
      baselineCommit,
    ]
    const violations = findPolicyViolations(history, BASELINE)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.reason).toContain('does not name the feat/ branch')
  })

  it('unless it is explicitly allowed', () => {
    const history = [
      { sha: 'ddd', parents: ['p1', 'p2'], subject: 'Merge audit and fixes' },
      baselineCommit,
    ]
    expect(findPolicyViolations(history, BASELINE)).toEqual([])
  })
})

describe('history before the policy', () => {
  it('is exempt, because rewriting it would be worse than exempting it', () => {
    const history = [
      merge('aaa', 'thing'),
      baselineCommit,
      direct('old2', 'Add RESEARCH.md and shared types'),
      direct('old1', 'first commit'),
    ]
    expect(findPolicyViolations(history, BASELINE)).toEqual([])
  })

  it('matches the baseline by prefix, since git abbreviates differently', () => {
    const history = [merge('aaa', 'thing'), { ...baselineCommit, sha: 'base0001234' }]
    expect(findPolicyViolations(history, 'base000')).toEqual([])
  })
})
