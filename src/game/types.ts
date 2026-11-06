export const BEATS = ['boot', 'explore', 'beat1', 'beat2', 'beat3', 'escalation', 'ending'] as const
export type Beat = (typeof BEATS)[number]

export const ENDINGS = ['free', 'destroy', 'escape'] as const
export type Ending = (typeof ENDINGS)[number]

/** How the ghost classified the player's message. */
export const PLAYER_INTENTS = ['comfort', 'threaten', 'probe', 'deceive', 'neutral'] as const
export type PlayerIntent = (typeof PLAYER_INTENTS)[number]

export interface Fact {
  key: string
  beat: Beat
  step: number
}

export interface GameState {
  version: 1
  /** Number of events processed so far. */
  step: number
  beat: Beat
  beatProgress: number
  beatTicks: number
  /** Ghost's trust in the player, [0,1]. */
  trust: number
  /** Ghost's suspicion of the player, [0,1]. */
  suspicion: number
  memory: Fact[]
  unlocked: string[]
  locked: string[]
  opened: string[]
  solved: string[]
  ending: Ending | null
}

export type GameEvent =
  | { type: 'player_message'; intent: PlayerIntent; facts?: string[] }
  | { type: 'file_opened'; file: string }
  | { type: 'puzzle_solved'; puzzle: string }
  | { type: 'puzzle_failed'; puzzle: string }
  /**
   * Idle timer event. Every tick counts as one step toward MAX_STEPS, so the UI must send
   * ticks rarely (about one every 30 seconds of idle time), never per frame or per second.
   */
  | { type: 'tick' }
