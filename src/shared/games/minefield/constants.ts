/**
 * Minefield tunables. Everything a designer might adjust while playtesting
 * lives here, so the rules code contains no magic numbers. Distances are in
 * tiles and times in milliseconds.
 */

export const MINEFIELD = {
    /** Two scoring rounds per game; each race has its own freshly laid field. */
    ROUNDS_PER_GAME: 2,

    /* ---- the map ---- */
    WIDTH: 60,
    HEIGHT: 15,
    START_X: 1.5,
    START_Y: 7.5,
    /** Crossing this x ends the race for that player: the finish line. */
    FINISH_X: 57,
    /** No mines in the first stretch, so nobody blows up at the start. */
    START_SAFE_TILES: 6,
    /** ...or just before the finish line. */
    FINISH_SAFE_TILES: 3,

    /* ---- mines ---- */
    /**
     * Mines per tile at the start of the field and at the finish end: the
     * field gets denser as you go, so scanning matters more the closer you are.
     */
    EASIEST_DENSITY: 0.035,
    HARDEST_DENSITY: 0.1,
    /** Mines never sit closer together than this. */
    MIN_MINE_SPACING: 1,
    /**
     * Walking within this distance of a live mine sets it off. The same
     * distance is used when drawing the mine's danger circle.
     */
    TRIGGER_RADIUS: 0.7,
    /**
     * Every field is checked to have a route from start to finish that stays
     * this far outside every trigger radius, so it is never impossible, only
     * unlikely to find without scanning.
     */
    PATH_CLEARANCE: 0.1,
    /** Resolution of that route check. */
    SAFE_PATH_GRID: 0.25,
    /** Laying a field is retried (with fewer mines each time) until it passes. */
    MAX_GENERATION_ATTEMPTS: 30,

    /* ---- the runner ---- */
    SPEED_TILES_PER_S: 4,
    /**
     * The run is simulated in fixed steps of this many ms, by the browser and
     * by the server alike, so both reach exactly the same result.
     */
    STEP_MS: 16,

    /* ---- lives ---- */
    LIVES: 2,
    /** A mine going off freezes the runner for this long: the explosion animation. */
    EXPLOSION_ANIMATION_MS: 1_000,
    /**
     * After a blast, no mine can set the runner off for this long (it includes
     * the explosion animation), so a cluster can't take both lives at once.
     */
    INVULNERABLE_MS: 1_800,

    /* ---- sonar ---- */
    /** Mines within this distance are revealed. */
    SONAR_RADIUS: 4.5,
    /** The scan animation. The runner stands still while it plays. */
    SONAR_ANIMATION_MS: 900,
    /**
     * How long revealed mines stay on screen once the scan animation is done.
     * Sonar is shared: every player sees the mines any player's scan finds.
     */
    SONAR_REVEAL_MS: 3_000,
    /** Time from pressing sonar until it can be used again. */
    SONAR_COOLDOWN_MS: 4_000,

    /* ---- the end ---- */
    /**
     * Time for the winner's finish animation once the race is decided, before
     * the results screen and the next round.
     */
    FINISH_ANIMATION_MS: 5_000,

    /** The race ends at this time even if nobody has finished. */
    MAX_RACE_MS: 90_000,
    /** Extra wait for stragglers before the server scores without them. */
    RESULT_GRACE_MS: 5_000,
    /** Upper bound on inputs in one result. Bounds the message size. */
    MAX_INPUTS: 4_000
} as const;
