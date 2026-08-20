import { describe, expect, it } from 'vitest'
import { formatDecision, isSafeForHistoryOps, parseStatus } from './workingTree'

describe('parsing git status', () => {
  it('separates tracked changes from untracked files', () => {
    const status = parseStatus(
      [' M package.json', 'M  vitest.config.ts', '?? scripts/new.ts', 'D  gone.ts'].join('\n'),
    )
    expect(status.tracked).toEqual(['package.json', 'vitest.config.ts', 'gone.ts'])
    expect(status.untracked).toEqual(['scripts/new.ts'])
  })

  it('treats a clean tree as clean', () => {
    expect(parseStatus('')).toEqual({ tracked: [], untracked: [] })
  })
})

describe('the rule is precise about what a hard reset actually destroys', () => {
  it('refuses when tracked changes exist', () => {
    // The exact slip: package.json and vitest.config.ts edits, discarded.
    const status = parseStatus(' M package.json\n M vitest.config.ts')
    expect(isSafeForHistoryOps(status)).toBe(false)
    const message = formatDecision(status, 'git reset --hard abc123')
    expect(message).toContain('REFUSED')
    expect(message).toContain('would discard 2 tracked change(s)')
    expect(message).toContain('package.json')
    expect(message).toContain('--stash')
  })

  it('allows untracked files, because a hard reset leaves them alone', () => {
    // Which is why the new script files survived that same reset.
    const status = parseStatus('?? scripts/branchPolicy.ts\n?? .githooks/')
    expect(isSafeForHistoryOps(status)).toBe(true)
    expect(formatDecision(status, 'a history operation')).toContain('safe for')
  })

  it('says which of the two a file is, rather than lumping them together', () => {
    const status = parseStatus(' M package.json\n?? scripts/new.ts')
    const message = formatDecision(status, 'git reset --hard abc123')
    expect(message).toContain('1 tracked change(s)')
    expect(message).toContain('1 untracked file(s) would have survived regardless')
  })

  it('reports a clean tree as clean with nothing to caveat', () => {
    const message = formatDecision({ tracked: [], untracked: [] }, 'a history operation')
    expect(message).toBe('Working tree is safe for a history operation.')
  })
})
