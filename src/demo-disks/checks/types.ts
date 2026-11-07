// Shared result type of the content checks.

export interface CheckFailure {
  /** Name of the check group that failed, for example `graves`. */
  check: string;
  /** Plain description of what differs. Never holds text taken from the disk as an instruction. */
  message: string;
}
