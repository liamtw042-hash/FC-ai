/**
 * Reads main's first parent history and applies the branch policy to it.
 *
 *   npm run check:branches
 *
 * Also runs from .githooks/pre-push, so a direct commit cannot leave the machine.
 */

import { execFileSync } from 'node:child_process'
import { findPolicyViolations, formatViolations, type CommitRecord } from './branchPolicy.ts'

function readHistory(ref: string): CommitRecord[] {
  const output = execFileSync(
    'git',
    ['rev-list', '--first-parent', '--format=%h%x00%p%x00%s', ref],
    { encoding: 'utf8' },
  )
  return output
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('commit '))
    .map((line) => {
      const [sha, parents, subject] = line.split('\0')
      return {
        sha: sha ?? '',
        parents: (parents ?? '').split(' ').filter(Boolean),
        subject: subject ?? '',
      }
    })
}

const ref = process.argv[2] ?? 'main'
const violations = findPolicyViolations(readHistory(ref))
console.log(formatViolations(violations))
process.exit(violations.length === 0 ? 0 : 1)
