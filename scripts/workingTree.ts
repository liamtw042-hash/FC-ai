/**
 * Refuses a history operation while the working tree holds work that would not
 * survive it.
 *
 * WHY THIS EXISTS. Two process slips in two turns came from the same root: acting
 * on history without securing the tree first. Once committing straight onto main,
 * once running `git reset --hard` with uncommitted edits to package.json and
 * vitest.config.ts, which it silently discarded. Both were caught by noticing,
 * which is not a mechanism.
 *
 * THE RULE IS PRECISE ABOUT THE RISK, not blanket. `git reset --hard` destroys
 * TRACKED modifications and staged changes. It leaves UNTRACKED files alone, which
 * is exactly why the new script files survived that reset and the config edits did
 * not. So tracked changes refuse the operation and untracked ones only warn, and
 * the message says which is which rather than lumping them together.
 */

export interface TreeStatus {
  /** Tracked files with staged or unstaged changes. Destroyed by a hard reset. */
  tracked: string[]
  /** Untracked files. A hard reset leaves these alone. */
  untracked: string[]
}

export function parseStatus(porcelain: string): TreeStatus {
  const tracked: string[] = []
  const untracked: string[] = []
  for (const line of porcelain.split('\n')) {
    if (line.trim().length === 0) continue
    const code = line.slice(0, 2)
    const path = line.slice(3)
    if (code === '??') untracked.push(path)
    else tracked.push(path)
  }
  return { tracked, untracked }
}

export function isSafeForHistoryOps(status: TreeStatus): boolean {
  return status.tracked.length === 0
}

export function formatDecision(status: TreeStatus, operation: string): string {
  if (isSafeForHistoryOps(status)) {
    const note =
      status.untracked.length > 0
        ? ` ${status.untracked.length} untracked file(s) present, which a hard reset leaves alone.`
        : ''
    return `Working tree is safe for ${operation}.${note}`
  }

  const lines = [
    `REFUSED: ${operation} would discard ${status.tracked.length} tracked change(s):`,
    '',
    ...status.tracked.map((path) => `  ${path}`),
    '',
    'A hard reset destroys tracked modifications and staged changes. It leaves',
    'untracked files alone, which is why new files survive one and edited ones do not.',
    '',
    'Commit them, or re-run with --stash to set them aside first.',
  ]
  if (status.untracked.length > 0) {
    lines.push('')
    lines.push(
      `(${status.untracked.length} untracked file(s) would have survived regardless.)`,
    )
  }
  return lines.join('\n')
}
