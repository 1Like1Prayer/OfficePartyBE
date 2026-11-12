export interface Mine {
    x: number;
    y: number;
}

/** The whole field. Public: every player races over the same mines. */
export interface MinefieldMap {
    width: number;
    height: number;
    startX: number;
    startY: number;
    finishX: number;
    mines: Mine[];
}

export interface MinefieldRound {
    map: MinefieldMap;
}

export type Axis = -1 | 0 | 1;

/** The direction the player is heading from this moment: all keys released is (0, 0). */
export interface MoveInput {
    kind: 'move';
    atMs: number;
    dx: Axis;
    dy: Axis;
}

export interface SonarInput {
    kind: 'sonar';
    atMs: number;
}

/** One thing the player did, timed by the client from when the race started. */
export type Input = MoveInput | SonarInput;

export interface MinefieldResult {
    /** Everything the player did, in order. The server judges it. */
    inputs: Input[];
    /** The tab was backgrounded mid-race, so local timing may be off. */
    timingSuspect: boolean;
}
