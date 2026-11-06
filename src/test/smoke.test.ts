import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

// Smoke test so the test hook has something to run before the real specs land.
describe('toolchain', () => {
  it('runs property-based tests', () => {
    fc.assert(fc.property(fc.float({ min: 0, max: 1, noNaN: true }), (t) => t >= 0 && t <= 1))
    expect(true).toBe(true)
  })
})
