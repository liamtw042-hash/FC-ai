import type { NextConfig } from 'next'

/**
 * Localhost only, and that is not a default that can drift. Brief section 1.2.
 *
 * There is no rewrite, no proxy and no remote image host here, and there never
 * will be: the only network this app makes is to the solver on 127.0.0.1, from
 * route handlers, using src/cli/solverClient.ts.
 */
const config: NextConfig = {
  reactStrictMode: true,
  // The rules engine and the CSV loaders are plain TypeScript in src/, imported
  // directly. No build step of their own, no duplicate copy for the browser.
  typedRoutes: true,
}

export default config
