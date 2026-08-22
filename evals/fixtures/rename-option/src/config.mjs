// Client options: the single source of truth for names and defaults.
export const defaults = {
  baseUrl: 'https://api.example.test',
  timeoutMs: 5000,
  retryLimit: 3
}

export function resolveOptions (overrides = {}) {
  for (const key of Object.keys(overrides)) {
    if (!(key in defaults)) throw new Error(`unknown option: ${key}`)
  }
  return { ...defaults, ...overrides }
}
