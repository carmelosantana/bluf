import { resolveOptions } from './config.mjs'

// Calls `send` until it resolves, retrying a failed attempt up to the configured
// number of extra tries. `send` receives the zero-based attempt index.
export async function requestWithRetry (send, overrides = {}) {
  const options = resolveOptions(overrides)
  let lastError
  for (let attempt = 0; attempt <= options.retryLimit; attempt++) {
    try {
      return await send(attempt)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
