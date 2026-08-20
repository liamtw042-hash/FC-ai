import { ledgerByRating, totals } from '../../src/data/history'
import { history } from '../lib/server'

export const dynamic = 'force-dynamic'

export default function HistoryPage() {
  const current = history()
  const summary = totals(current)
  const ledger = ledgerByRating(current)

  return (
    <div className="space-y-6 text-sm">
      <h1 className="text-lg font-bold text-neutral-100">History</h1>

      <section className="border border-neutral-800 p-3">
        <h2 className="font-bold text-neutral-200">Totals</h2>
        <p>
          {summary.submissions} submission(s), {summary.squads} squad(s), {summary.cardsBurned}{' '}
          card(s) consumed
        </p>
        {/* Two numbers, always. A month that cost nothing in coins and destroyed
            two million in fodder is a real month, and one figure hides it. */}
        <p>
          {summary.coinsSpent} coins spent, {summary.valueBurned} value burned
        </p>
      </section>

      <section className="border border-neutral-800 p-3">
        <h2 className="font-bold text-neutral-200">Fodder ledger</h2>
        {ledger.length === 0 ? (
          <p className="text-neutral-500">Nothing submitted yet.</p>
        ) : (
          <table className="mt-2 text-left text-xs">
            <thead className="text-neutral-500">
              <tr>
                <th className="py-1 pr-6">rating</th>
                <th className="py-1 pr-6">cards</th>
                <th className="py-1 pr-6">value burned</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((row) => (
                <tr key={row.rating} className="border-t border-neutral-900">
                  <td className="py-1 pr-6">{row.rating}</td>
                  <td className="py-1 pr-6">{row.cards}</td>
                  <td className="py-1 pr-6">{row.valueBurned}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="border border-neutral-800 p-3">
        <h2 className="font-bold text-neutral-200">Submissions</h2>
        {current.submissions.length === 0 ? (
          <p className="text-neutral-500">Nothing submitted yet.</p>
        ) : (
          <table className="mt-2 w-full text-left text-xs">
            <thead className="text-neutral-500">
              <tr>
                <th className="py-1 pr-4">when</th>
                <th className="py-1 pr-4">sbc</th>
                <th className="py-1 pr-4">squads</th>
                <th className="py-1 pr-4">coins</th>
                <th className="py-1 pr-4">value burned</th>
                <th className="py-1 pr-4">reward</th>
              </tr>
            </thead>
            <tbody>
              {[...current.submissions].reverse().map((submission) => (
                <tr key={submission.id} className="border-t border-neutral-900">
                  <td className="py-1 pr-4">{submission.submittedAt}</td>
                  <td className="py-1 pr-4 text-neutral-200">{submission.sbcName}</td>
                  <td className="py-1 pr-4">{submission.squadCount}</td>
                  <td className="py-1 pr-4">{submission.coinsSpent}</td>
                  <td className="py-1 pr-4">{submission.valueBurned}</td>
                  <td className="py-1 pr-4">{submission.reward ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
