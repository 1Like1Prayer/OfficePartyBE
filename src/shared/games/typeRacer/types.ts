/** One paragraph is a list of lines. A mistake sends the player back to the start of the line. */
export type Paragraph = readonly string[];

/**
 * Public round data: the paragraphs every player races through, and a nonce
 * that (together with a server-only secret) decides the dice. The nonce on its
 * own reveals nothing about any roll.
 */
export interface TypeRacerRound {
    paragraphs: string[][];
    rollNonce: string;
}

/**
 * Something that happened while typing, timed by the client from when the
 * race started. The server replays these; it never sees keystrokes.
 *  - `mistake`: a wrong key. The line restarts and the paragraph gains a strike.
 *  - `line`: the line was typed correctly.
 */
export interface TypingEvent {
    kind: 'mistake' | 'line';
    atMs: number;
}

export interface TypeRacerResult {
    events: TypingEvent[];
    /** When the client stopped (finished, eliminated, or gave up), from race start. */
    endedAtMs: number;
    /** The tab was backgrounded mid-race, so local timing may be off. */
    timingSuspect: boolean;
}

/** What the server tells a player after they cast the dice. */
export interface DieRoll {
    /** Which side landed, 1 to DICE_SIDES. */
    face: number;
    /** How many of the sides were skulls on this roll. */
    skulls: number;
    isSkull: boolean;
}

/** The action a client sends mid-race to cast the dice. */
export interface RollAction {
    type: 'roll';
    /** 0 for the first roll of the race, 1 for the second, and so on. */
    rollIndex: number;
}

/** Picks which side a roll lands on. Server-only in practice; see src/game/diceRolls.ts. */
export type RollFace = (nonce: string, playerId: string, rollIndex: number) => number;
