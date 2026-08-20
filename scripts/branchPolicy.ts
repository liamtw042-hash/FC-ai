/**
 * Branch policy: nothing lands on main except a merge from a feat/ branch.
 *
 * WHY THIS EXISTS. The rule was written down in CLAUDE.md and then broken, by me,
 * on the very turn that produced an audit about not relying on anyone remembering
 * things. A rule that depends on either party remembering is not a rule, it is a
 * habit, and habits lapse exactly when attention is elsewhere.
 *
 * The check is deliberately simple: walk main's first parent line and require
 * every commit after the policy baseline to be a MERGE commit whose subject names
 * a feat/ branch. A commit made directly on main has one parent and fails.
 *
 * The history-reading half is separated from the rule half so the rule can be
 * tested against constructed histories rather than only against this repo's.
 */

export interface CommitRecord {
  sha: string
  /** Parent shas, in order. A merge has two. */
  parents: string[]
  subject: string
}

export interface PolicyViolation {
  sha: string
  subject: string
  reason: string
}

/**
 * The first commit the policy applies to. Everything before it predates
 * CLAUDE.md, and rewriting that history would be worse than exempting it.
 */
export const POLICY_BASELINE_SHA = '1b8dd18'

/** Merge subjects that are allowed even though they do not name a feat/ branch. */
const ALLOWED_SUBJECTS = [/^Merge audit and fixes$/]

export function findPolicyViolations(
  firstParentHistory: readonly CommitRecord[],
  baselineSha: string = POLICY_BASELINE_SHA,
): PolicyViolation[] {
  const violations: PolicyViolation[] = []

  for (const commit of firstParentHistory) {
    // History is newest first. Everything from the baseline downward predates
    // the policy.
    if (commit.sha.startsWith(baselineSha) || baselineSha.startsWith(commit.sha)) break

    if (commit.parents.length < 2) {
      violations.push({
        sha: commit.sha,
        subject: commit.subject,
        reason:
          'committed straight onto main. Work goes on a feat/ branch and reaches ' +
          'main only through a merge.',
      })
      continue
    }

    const namesFeatBranch = /^Merge .*\bfeat\//.test(commit.subject)
    const allowed = ALLOWED_SUBJECTS.some((pattern) => pattern.test(commit.subject))
    if (!namesFeatBranch && !allowed) {
      violations.push({
        sha: commit.sha,
        subject: commit.subject,
        reason: 'is a merge, but its subject does not name the feat/ branch it came from.',
      })
    }
  }

  return violations
}

export function formatViolations(violations: readonly PolicyViolation[]): string {
  if (violations.length === 0) {
    return 'Branch policy: every commit on main came through a feat/ branch.'
  }
  const lines = [
    `Branch policy FAILED. ${violations.length} commit(s) reached main the wrong way:`,
    '',
  ]
  for (const violation of violations) {
    lines.push(`  ${violation.sha}  ${violation.subject}`)
    lines.push(`    ${violation.reason}`)
  }
  lines.push('')
  lines.push('To fix a commit that is not yet pushed:')
  lines.push('  git branch feat/<thing>          keep the work')
  lines.push('  git reset --hard HEAD~1          take it off main')
  lines.push('  git merge --no-ff feat/<thing>   put it back properly')
  return lines.join('\n')
}
