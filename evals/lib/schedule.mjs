import { rotate } from './runner.mjs'

// Pinned worst-case adjacency overlap between any two of five trials, measured with the
// generator below. It exists so that swapping the shuffle for something weaker — a rotation,
// or a per-trial offset into a fixed stride — fails a test instead of quietly reinstating the
// order effect the shuffle removes. An earlier design shared 10 of 11 adjacencies.
export const MAX_SHARED_ADJACENCY = 4

// Seeded so a sweep is reproducible: the same trial number always produces the same case
// order, on any machine, without storing one.
function seededRandom (seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function permuteCases (cases, trial) {
  if (!Number.isInteger(trial) || trial < 1) {
    throw new Error(`permuteCases requires a trial number >= 1, got: ${JSON.stringify(trial)}`)
  }
  const out = [...cases]
  // 2654435761 is Knuth's multiplicative constant; it spreads adjacent trial numbers to
  // distant seeds, so trials 1 and 2 do not produce near-identical orders.
  const random = seededRandom(trial * 2654435761)
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// One flat schedule, so execution order is a value that can be asserted rather than a shape
// emerging from nested loops. The trial loop is OUTERMOST: a trial is a whole sweep of every
// case, which is what makes repeated trials repeated measurements.
export function scheduleSweep ({ cases, conditions, trials }) {
  const indexOf = new Map(cases.map((caseRow, index) => [caseRow.id, index]))
  const schedule = []
  for (let trial = 1; trial <= trials; trial += 1) {
    for (const caseRow of permuteCases(cases, trial)) {
      const caseIndex = indexOf.get(caseRow.id)
      // Keyed on the case's ORIGINAL index plus the trial. Keying on its position in the
      // permuted order cancels the trial term algebraically with two conditions, so every
      // case would lead with the same condition in every trial and one condition would
      // always pay that case's cache-creation cost.
      for (const condition of rotate(conditions, caseIndex + trial)) {
        schedule.push({ trial, caseId: caseRow.id, condition, caseIndex })
      }
    }
  }
  return schedule
}
