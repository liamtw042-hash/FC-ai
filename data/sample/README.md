# Sample data

**Everything in this directory is invented.** The players do not exist, the clubs
and leagues are made up names, and the prices were chosen to have roughly the
right shape rather than measured anywhere. Nothing here is evidence about EA FC
26 and no rule should ever be verified against it.

It exists because checkpoint 2, the real player database loader, is blocked on an
API key and on rate limits that must not be guessed at. Without some card
database nothing downstream of it can be run at all, so this stands in for one
while that stays blocked. It is enough to exercise the cost model, the rating
enumerator, the solver, the grind planner and the whole command line end to end.

| File | What it is |
|---|---|
| `cards.csv` | 445 card definitions, ratings 75 to 91 |
| `club.csv` | one owned stack per definition, with a deliberately incomplete status pass so the coverage report has something to say |
| `prices.json` | a price by rating table, RESEARCH.md 8.1 |
| `sbc/` | worked SBC definitions, including the ten 85s of QUICKSTART.md |

Regenerate with `npx tsx scripts/generateSampleData.ts`. The generator is seeded,
so the files are reproducible and a diff on them means a deliberate change.
