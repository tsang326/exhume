/**
 * Rising gate: decides when the preview may open after an exhume request.
 * Pure state machine; the caller owns the animation and the worker request.
 */

export type RiseEvent = 'animation-end' | 'result' | 'error' | 'cancel';

export interface RiseState {
  reduced: boolean;
  animationDone: boolean;
  outcome: 'pending' | 'result' | 'error';
  /** True once the preview was shown or the rise was cancelled; nothing shows after that. */
  shown: boolean;
}

export interface RiseStep {
  state: RiseState;
  show: boolean;
  stopAnimation: boolean;
}

/** Reduced motion starts with the animation already done. */
export function startRise(reduced: boolean): RiseState {
  return { reduced, animationDone: reduced, outcome: 'pending', shown: false };
}

export function stepRise(state: RiseState, event: RiseEvent): RiseStep {
  if (state.shown) return { state, show: false, stopAnimation: false };

  switch (event) {
    case 'cancel':
      return { state: { ...state, shown: true }, show: false, stopAnimation: true };
    case 'error': {
      return {
        state: { ...state, outcome: 'error', animationDone: true, shown: true },
        show: true,
        stopAnimation: true,
      };
    }
    case 'result': {
      if (state.outcome !== 'pending') return { state, show: false, stopAnimation: false };
      const show = state.animationDone || state.reduced;
      return {
        state: { ...state, outcome: 'result', shown: show },
        show,
        stopAnimation: false,
      };
    }
    case 'animation-end': {
      const show = state.outcome !== 'pending';
      return {
        state: { ...state, animationDone: true, shown: show },
        show,
        stopAnimation: false,
      };
    }
  }
}
