import { createHash } from 'node:crypto'

/** Stable id for an ordered pair (left subject/content, right style). 16 hex chars. */
export const pairId = (aId: string, bId: string) => createHash('sha256').update(`${aId}\n${bId}`).digest('hex').slice(0, 16)
