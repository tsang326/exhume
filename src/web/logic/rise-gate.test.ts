import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { startRise, stepRise, type RiseEvent } from './rise-gate';
import { numRuns } from '../../test-support/runs';

const events: RiseEvent[] = ['animation-end', 'result', 'error', 'cancel'];

describe('rise gate examples', () => {
  it('reduced motion starts with the animation done and shows a result at once', () => {
    const s = startRise(true);
    expect(s.animationDone).toBe(true);
    expect(stepRise(s, 'result').show).toBe(true);
  });

  it('waits for animation-end when the result comes first', () => {
    const a = stepRise(startRise(false), 'result');
    expect(a.show).toBe(false);
    expect(stepRise(a.state, 'animation-end').show).toBe(true);
  });

  it('shows an error at once and stops the animation', () => {
    const e = stepRise(startRise(false), 'error');
    expect(e.show).toBe(true);
    expect(e.stopAnimation).toBe(true);
  });
});

describe('rise gate properties', () => {
  // Feature: graveyard-ui, Property 32: The rising gate shows once, in time, and never waits needlessly
  // **Validates: Requirements 9.3, 9.4, 9.5, 9.6**
  it('Property 32: shows once, in time, and never waits needlessly', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.array(fc.constantFrom(...events), { maxLength: 12 }),
        (reduced, seq) => {
          let state = startRise(reduced);
          let shows = 0;
          let cancelled = false;
          let animationDone = reduced;
          let resultIn = false;
          let errorIn = false;
          let ok = true;
          for (const ev of seq) {
            const wasShown = shows > 0;
            const step = stepRise(state, ev);
            if (step.show) shows++;
            if (ev === 'cancel') {
              if (step.show) ok = false;
              cancelled = true;
            }
            if (ev === 'error' && !wasShown && !cancelled) {
              if (!step.show || !step.stopAnimation) ok = false;
            }
            if (ev === 'error' && !wasShown && !cancelled) errorIn = true;
            if (ev === 'animation-end') animationDone = true;
            if (ev === 'result' && !wasShown && !cancelled && !errorIn && !resultIn) {
              resultIn = true;
              if (step.show !== animationDone) ok = false;
            }
            if (ev === 'animation-end' && !wasShown && !cancelled && resultIn && !step.show) {
              ok = false;
            }
            if (cancelled && step.show) ok = false;
            state = step.state;
          }
          return ok && shows <= 1;
        },
      ),
      { numRuns: numRuns(200) },
    );
  });
});
