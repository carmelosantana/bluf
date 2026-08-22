// Renders an integer as an English ordinal string: 1 -> "1st", 42 -> "42nd".
//
// The full rule, per standard English usage:
// - the suffix follows the last digit: 1 -> "st", 2 -> "nd", 3 -> "rd",
//   everything else -> "th" (4th, 10th, 100th)
// - EXCEPT numbers ending in 11, 12 or 13, which always take "th"
//   (11th, 12th, 13th, 111th, 1012th)
// - a negative integer takes the suffix of its absolute value (-2 -> "-2nd")
// - zero is "0th"
// - a non-integer is rejected with a RangeError
export function ordinal (n) {
  if (!Number.isInteger(n)) throw new RangeError(`ordinal of a non-integer: ${n}`)
  // BUG: every number gets "th", so 1 renders as "1th".
  return `${n}th`
}
