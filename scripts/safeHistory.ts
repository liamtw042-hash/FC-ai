/**
 * History operations that refuse to run over uncommitted work.
 *
 *   npm run git:reset -- <ref>          hard reset, refused if the tree is dirty
 *   npm run git:reset -- <ref> --stash  stash first, then reset
 *   npm run check:clean                 just report whether the tree is safe
 *
 * See workingTree.ts for why the rule distinguishes tracked from untracked.
 */

import { execFileSync } from 'node:child_process'
import { formatDecision, isSafeForHistoryOps, parseStatus } from './workingTree.ts'

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' })
}

function readStatus() {
  return parseStatus(git(['status', '--porcelain']))
}

const [command, ...rest] = process.argv.slice(2)

if (command === 'check') {
  const status = readStatus()
  console.log(formatDecision(status, 'a history operation'))
  process.exit(isSafeForHistoryOps(status) ? 0 : 1)
}

if (command === 'reset') {
  const stash = rest.includes('--stash')
  const ref = rest.find((argument) => !argument.startsWith('--'))
  if (ref === undefined) {
    console.error('Usage: safeHistory reset <ref> [--stash]')
    process.exit(1)
  }

  let status = readStatus()
  if (!isSafeForHistoryOps(status)) {
    if (!stash) {
      console.error(formatDecision(status, `git reset --hard ${ref}`))
      process.exit(1)
    }
    console.log(`Stashing ${status.tracked.length} tracked change(s) first.`)
    git(['stash', 'push', '--message', `safeHistory before reset to ${ref}`])
    status = readStatus()
  }

  git(['reset', '--hard', ref])
  console.log(`Reset to ${ref}.`)
  if (stash) console.log('Your changes are in the stash: git stash pop')
  process.exit(0)
}

console.error('Usage: safeHistory <check|reset>')
process.exit(1)
