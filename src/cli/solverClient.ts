/**
 * The HTTP client for the local solver service.
 *
 * LOCALHOST ONLY. The base URL defaults to 127.0.0.1 and the CLI passes nothing
 * else. There is no code path here, or anywhere in this repository, that reaches
 * an EA endpoint. Brief section 1.2.
 */

import { request as httpRequest } from 'node:http'

export const DEFAULT_SOLVER_URL = 'http://127.0.0.1:8000'

export class SolverUnavailableError extends Error {}
export class SolverRejectedError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export class SolverClient {
  constructor(
    private readonly baseUrl: string = DEFAULT_SOLVER_URL,
    /** Milliseconds to wait for a reply. 0 means wait as long as it takes. */
    private readonly timeoutMs: number = 0,
  ) {}

  async healthy(): Promise<boolean> {
    try {
      await this.request('GET', '/health', undefined)
      return true
    } catch {
      return false
    }
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const text = await this.request('POST', path, JSON.stringify(body))
    return JSON.parse(text) as T
  }

  /**
   * node:http rather than fetch, and the reason is not taste.
   *
   * fetch gives undici a 300 second headers timeout that cannot be reached from
   * here, and a ten squad solve over a real club runs longer than that. The
   * request then dies with "fetch failed" while the solver is still working
   * happily, which is a wrong answer dressed as a network error. This is a local
   * socket to a process on 127.0.0.1: the right default is to wait.
   */
  private request(method: string, path: string, body: string | undefined): Promise<string> {
    const url = new URL(this.baseUrl + path)
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {}
      if (body !== undefined) {
        headers['content-type'] = 'application/json'
        headers['content-length'] = String(Buffer.byteLength(body))
      }
      const request = httpRequest(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method,
          headers,
        },
        (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => chunks.push(chunk))
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8')
            const status = response.statusCode ?? 0
            if (status >= 200 && status < 300) {
              resolve(text)
              return
            }
            let detail = text
            try {
              detail = (JSON.parse(text) as { detail?: string }).detail ?? text
            } catch {
              // Not JSON. The raw body is the best message available.
            }
            reject(new SolverRejectedError(detail, status))
          })
        },
      )
      // No socket timeout by default. A long solve is a long solve, not a fault.
      if (this.timeoutMs > 0) {
        request.setTimeout(this.timeoutMs, () => {
          request.destroy(
            new SolverUnavailableError(
              `the solver did not reply within ${this.timeoutMs}ms. It may still be ` +
                `working: raise --timeout, or lower --time so it gives up sooner`,
            ),
          )
        })
      }
      request.on('error', (error: Error) => {
        if (error instanceof SolverUnavailableError || error instanceof SolverRejectedError) {
          reject(error)
          return
        }
        reject(
          new SolverUnavailableError(
            `the solver service is not answering on ${this.baseUrl}. Start it with ` +
              `npm run solver:dev, or pass --solver-url. Original error: ${error.message}`,
          ),
        )
      })
      if (body !== undefined) request.write(body)
      request.end()
    })
  }
}

export interface WireDiagnosis {
  mode: string
  blocking: string[]
  explanation: string
  supply: {
    rating: number | null
    needed: number
    held: number
    missing: number
    unit_cost: number | null
    basis: string
    cost_to_close: number | null
  }[]
  limits: {
    name: string
    asked: number | null
    best: number | null
    gap: number | null
    reachable: boolean
    description: string
  }[]
}

export interface WirePlacement {
  card_id: string
  slot_index: number
  slot_position: string
  in_position: boolean
  chemistry: number
}

export interface WireSquad {
  placements: WirePlacement[]
  cost: number
}

export interface WireQueueItem {
  name: string
  kind: string
  set_name: string | null
  priority: number
  requested: number
  achieved: number
  squads: WireSquad[]
  cost: number
  diagnosis: WireDiagnosis | null
}

export interface WireQueueResponse {
  items: WireQueueItem[]
  squads_built: number
  total_cost: number
  coins_spent: number
  value_burned: number
  complete: boolean
  proven_optimal: boolean
  wall_time_seconds: number
  plan_summary: string | null
  summary: string
}

export interface WireRepeatResponse {
  requested: number
  achieved: number
  squads: WireSquad[]
  total_cost: number
  coins_spent: number
  value_burned: number
  proven_optimal: boolean
  wall_time_seconds: number
  diagnosis: WireDiagnosis | null
  summary: string
}
