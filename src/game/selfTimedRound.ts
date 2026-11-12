/**
 * The self-timed round runner (section 8.1).
 *
 * Five of the ten games use this. The server hands out the round data, waits
 * for everyone to be ready, picks a start time a second or two out, and
 * collects what comes back. It never measures anything itself, so latency
 * cannot reach the outcome.
 *
 * Tiebreakers are internal: a scoring round may run several attempts, but it
 * hands back exactly one winner (section 6). The room only hears about the
 * final one.
 *
 * The runner has no socket dependency: it emits through callbacks, so the
 * room decides how results reach the wire.
 */

import { SELF_TIMED } from '../shared/constants';
import type {
    AttemptTiming,
    RankedEntry,
    ResultEntry,
    SelfTimedGameModule,
    StageAdvance
} from '../shared/games/selfTimed';
import type { GameId } from '../shared/games/catalog';
import type {
    ErrorCode,
    ProgressPayload,
    RoundClosingPayload,
    ReadyStatePayload,
    RoundDataPayload,
    RoundPhase,
    StartAtPayload
} from '../shared/protocol';
import { monotonicNowMs } from './clock';

/** How long the "it's a tie" screen shows before the tiebreaker begins. */
const TIEBREAK_DELAY_MS = 4_000;

const DEFAULT_TIMING: AttemptTiming = {
    startLeadMs: SELF_TIMED.START_LEAD_MS,
    countdownMs: SELF_TIMED.COUNTDOWN_MS
};

export interface AttemptResolved {
    roundId: number;
    attempt: number;
    isTiebreak: boolean;
    ranked: RankedEntry[];
    noShow: string[];
    winnerId: string | null;
    decidedByCoinFlip: boolean;
    /** The players going on to the next stage, if the game has one. */
    advancing: string[] | null;
    /** Pause before the next stage loads. Zero when there is no next stage. */
    stageBreakMs: number;
    /** False when a tie sent this round to another attempt. */
    isFinal: boolean;
}

export interface SelfTimedRoundEvents {
    onRoundData(payload: RoundDataPayload): void;
    onReadyState(payload: ReadyStatePayload): void;
    onStartAt(payload: StartAtPayload): void;
    onProgress(payload: ProgressPayload): void;
    /** Optional: only games that can end early use it. */
    onRoundClosing?(payload: RoundClosingPayload): void;
    onAttemptResolved(payload: AttemptResolved): void;
}

export interface SelfTimedRoundOptions<TRound, TResult> {
    module: SelfTimedGameModule<TRound, TResult>;
    gameId: GameId;
    roundId: number;
    /** Position in the competition, carried through for the client's HUD. */
    gameIndex: number;
    totalGames: number;
    roundInGame: number;
    roundsPerGame: number;
    events: SelfTimedRoundEvents;
}

export type ActionOutcome =
    | { ok: true; data: unknown }
    | { ok: false; code: ErrorCode; message: string };

export type SubmitOutcome =
    | { ok: true }
    | { ok: false; code: ErrorCode; message: string };

export class SelfTimedRound<TRound, TResult> {
    readonly roundId: number;
    readonly gameId: GameId;

    private readonly module: SelfTimedGameModule<TRound, TResult>;
    private readonly events: SelfTimedRoundEvents;
    private readonly gameIndex: number;
    private readonly totalGames: number;
    private readonly roundInGame: number;
    private readonly roundsPerGame: number;

    private phase: RoundPhase = 'idle';
    private attemptIndex = 0;
    private isTiebreak = false;
    private tiebreakersRun = 0;
    private timing: AttemptTiming = DEFAULT_TIMING;
    private round: TRound | null = null;
    private participants = new Set<string>();
    private ready = new Set<string>();
    private results = new Map<string, TResult>();
    private lastProgressAt = new Map<string, number>();
    /** The newest progress each player sent, so a reconnecting client can catch up. */
    private latestProgress = new Map<string, Record<string, number>>();
    /**
     * A progress update that arrived inside the rate limit is not thrown away:
     * the newest one waits here and goes out when the limit allows. Otherwise a
     * player who pauses right after two quick updates would look stuck on
     * everyone else's screen.
     */
    private trailingProgress = new Map<
        string,
        { progress: Record<string, number>; timer: NodeJS.Timeout }
    >();
    /**
     * Players whose connection dropped during this attempt. A brief network
     * blip must not cost them the round, so they can rejoin it (see
     * `rejoinParticipant`).
     */
    private droppedParticipants = new Set<string>();
    /** Set once the stragglers have been told to stop; reset every attempt. */
    private closingSent = false;
    private closingTimer: NodeJS.Timeout | null = null;
    private startAtServerMs: number | null = null;
    private readyDeadlineMs = 0;
    private timer: NodeJS.Timeout | null = null;
    private cancelled = false;

    constructor(options: SelfTimedRoundOptions<TRound, TResult>) {
        this.module = options.module;
        this.gameId = options.gameId;
        this.roundId = options.roundId;
        this.gameIndex = options.gameIndex;
        this.totalGames = options.totalGames;
        this.roundInGame = options.roundInGame;
        this.roundsPerGame = options.roundsPerGame;
        this.events = options.events;
    }

    /** Time clients need to play this game's ending animation. Zero if it has none. */
    get finishAnimationMs(): number {
        return this.module.finishAnimationMs ?? 0;
    }

    /* -------------------------------------------------------------- */
    /* Lifecycle                                                        */
    /* -------------------------------------------------------------- */

    begin(participants: string[]): void {
        this.participants = new Set(participants);
        this.startAttempt(0, false);
    }

    /** Stop everything. Used when the room is destroyed or the match aborted. */
    cancel(): void {
        this.cancelled = true;
        this.clearTimer();
        this.clearClosingTimer();
        this.clearTrailingProgress();
        this.phase = 'idle';
    }

    private startAttempt(
        attempt: number,
        isTiebreak: boolean,
        timingOverride?: AttemptTiming
    ): void {
        if (this.cancelled) return;

        this.attemptIndex = attempt;
        this.isTiebreak = isTiebreak;
        // Tiebreakers reuse the same context, so a tied blind round stays blind
        // and gets a fresh target.
        this.round = this.module.createRoundData({
            roundInGame: this.roundInGame,
            roundsPerGame: this.roundsPerGame,
            playerIds: [...this.participants],
            attempt
        });
        this.timing =
            timingOverride ??
            (attempt === 0 ? this.module.openingTiming?.(this.round) : null) ??
            DEFAULT_TIMING;
        this.ready.clear();
        this.results.clear();
        this.lastProgressAt.clear();
        this.latestProgress.clear();
        this.clearTrailingProgress();
        this.droppedParticipants.clear();
        this.closingSent = false;
        this.clearClosingTimer();
        this.startAtServerMs = null;

        // Loading: the round data goes out and clients build whatever they need.
        this.phase = 'loading';
        this.events.onRoundData({
            roundId: this.roundId,
            attempt: this.attemptIndex,
            gameId: this.gameId,
            data: this.round,
            isTiebreak,
            participants: [...this.participants],
            resultTimeoutMs: this.module.resultTimeoutMs(this.round),
            gameIndex: this.gameIndex,
            totalGames: this.totalGames,
            roundInGame: this.roundInGame
        });

        // Ready check: nothing is scheduled until everyone has acknowledged.
        this.phase = 'ready-check';
        this.readyDeadlineMs =
            monotonicNowMs() + SELF_TIMED.READY_CHECK_TIMEOUT_MS;
        this.emitReadyState();
        this.setTimer(
            () => this.onReadyCheckTimeout(),
            SELF_TIMED.READY_CHECK_TIMEOUT_MS
        );

        // An empty attempt (everyone left) resolves immediately rather than hanging.
        if (this.participants.size === 0) this.resolve();
    }

    /* -------------------------------------------------------------- */
    /* Client actions                                                   */
    /* -------------------------------------------------------------- */

    markReady(playerId: string, attempt: number): SubmitOutcome {
        if (attempt !== this.attemptIndex) {
            return { ok: false, code: 'stale_round', message: 'Ready for a past attempt.' };
        }
        if (this.phase !== 'ready-check') {
            return { ok: false, code: 'wrong_phase', message: 'Not in a ready check.' };
        }
        if (!this.participants.has(playerId)) {
            return { ok: false, code: 'not_in_room', message: 'Not playing this round.' };
        }
        if (this.ready.has(playerId)) return { ok: true };

        this.ready.add(playerId);
        this.emitReadyState();
        if (this.allReady()) this.scheduleStart();
        return { ok: true };
    }

    submitResult(
        playerId: string,
        attempt: number,
        raw: unknown
    ): SubmitOutcome {
        if (attempt !== this.attemptIndex) {
            return { ok: false, code: 'stale_round', message: 'Result for a past attempt.' };
        }
        if (this.phase !== 'playing' || this.round === null) {
            return { ok: false, code: 'wrong_phase', message: 'Round is not running.' };
        }
        if (!this.participants.has(playerId)) {
            return { ok: false, code: 'not_in_room', message: 'Not playing this round.' };
        }
        // Keep the first report per player per attempt, ignore repeats.
        if (this.results.has(playerId)) {
            return { ok: false, code: 'duplicate_result', message: 'Already reported.' };
        }

        const parsed = this.module.parseResult(raw, this.round);
        if (parsed === null) {
            return { ok: false, code: 'invalid_payload', message: 'Malformed result.' };
        }

        this.results.set(playerId, parsed);
        const reported = this.module.progressFromResult?.(parsed, this.round) ?? null;
        if (reported !== null) {
            this.clearTrailingProgress(playerId);
            this.emitProgress(playerId, reported);
        }
        if (this.pendingPlayers().length === 0) this.resolve();
        else this.closeEarlyIfDecided();
        return { ok: true };
    }

    /**
     * A mid-round request the game answers itself (e.g. casting the dice).
     * Stateless on the server's side: the game derives the reply from the round.
     */
    handleAction(
        playerId: string,
        attempt: number,
        raw: unknown
    ): ActionOutcome {
        if (attempt !== this.attemptIndex) {
            return { ok: false, code: 'stale_round', message: 'Action for a past attempt.' };
        }
        if (this.phase !== 'playing' || this.round === null) {
            return { ok: false, code: 'wrong_phase', message: 'Round is not running.' };
        }
        if (!this.participants.has(playerId)) {
            return { ok: false, code: 'not_in_room', message: 'Not playing this round.' };
        }
        if (this.module.handleAction === undefined) {
            return { ok: false, code: 'invalid_payload', message: 'This game has no actions.' };
        }

        const reply = this.module.handleAction(this.round, playerId, raw);
        return reply === null
            ? { ok: false, code: 'invalid_payload', message: 'Malformed action.' }
            : { ok: true, data: reply };
    }

    /** Display-only, rate limited, and never allowed to affect the outcome. */
    submitProgress(playerId: string, attempt: number, raw: unknown): void {
        if (
            attempt !== this.attemptIndex ||
            this.phase !== 'playing' ||
            this.round === null ||
            !this.participants.has(playerId)
        ) {
            return;
        }

        const progress = this.module.parseProgress(raw, this.round);
        if (progress === null) return;

        const now = monotonicNowMs();
        const last = this.lastProgressAt.get(playerId) ?? -Infinity;
        const waitMs = SELF_TIMED.PROGRESS_MIN_INTERVAL_MS - (now - last);
        if (waitMs > 0) {
            this.deferProgress(playerId, progress, waitMs);
            return;
        }

        this.clearTrailingProgress(playerId);
        this.emitProgress(playerId, progress);
    }

    private emitProgress(playerId: string, progress: Record<string, number>): void {
        this.lastProgressAt.set(playerId, monotonicNowMs());
        this.latestProgress.set(playerId, progress);
        this.events.onProgress({
            roundId: this.roundId,
            attempt: this.attemptIndex,
            playerId,
            progress
        });
    }

    /** Hold the newest update until the rate limit allows it; a newer one replaces it. */
    private deferProgress(
        playerId: string,
        progress: Record<string, number>,
        waitMs: number
    ): void {
        const waiting = this.trailingProgress.get(playerId);
        if (waiting !== undefined) {
            waiting.progress = progress;
            return;
        }
        const timer = setTimeout(() => {
            const entry = this.trailingProgress.get(playerId);
            this.trailingProgress.delete(playerId);
            if (
                entry === undefined ||
                this.phase !== 'playing' ||
                !this.participants.has(playerId)
            ) {
                return;
            }
            this.emitProgress(playerId, entry.progress);
        }, waitMs);
        this.trailingProgress.set(playerId, { progress, timer });
    }

    private clearTrailingProgress(playerId?: string): void {
        for (const [id, entry] of this.trailingProgress) {
            if (playerId !== undefined && id !== playerId) continue;
            clearTimeout(entry.timer);
            this.trailingProgress.delete(id);
        }
    }

    /**
     * A player's connection came back while their attempt is still running.
     * They go back into it, so their progress shows, their requests (like a
     * dice roll) are answered and their result is accepted. Returns whether
     * they were put back.
     */
    rejoinParticipant(playerId: string): boolean {
        if (!this.droppedParticipants.has(playerId)) return false;
        const running =
            this.phase === 'ready-check' ||
            this.phase === 'starting' ||
            this.phase === 'countdown' ||
            this.phase === 'playing';
        if (!running) return false;

        this.droppedParticipants.delete(playerId);
        this.participants.add(playerId);
        if (this.phase === 'ready-check') this.emitReadyState();
        return true;
    }

    /**
     * A player disconnected or left. They stop being waited on, but a result
     * they already submitted still counts.
     */
    dropParticipant(playerId: string): void {
        if (!this.participants.has(playerId)) return;
        this.participants.delete(playerId);
        this.ready.delete(playerId);
        this.droppedParticipants.add(playerId);
        this.clearTrailingProgress(playerId);

        if (this.phase === 'ready-check') {
            this.emitReadyState();
            if (this.participants.size === 0) this.resolve();
            else if (this.allReady()) this.scheduleStart();
        } else if (this.phase === 'playing') {
            if (this.pendingPlayers().length === 0) this.resolve();
            else this.closeEarlyIfDecided();
        }
    }

    /* -------------------------------------------------------------- */
    /* Internals                                                        */
    /* -------------------------------------------------------------- */

    private allReady(): boolean {
        if (this.participants.size === 0) return false;
        for (const playerId of this.participants) {
            if (!this.ready.has(playerId)) return false;
        }
        return true;
    }

    /**
     * For games that end before everyone has finished: once the game says
     * enough players have reported, tell the rest to stop and report now, and
     * give them a short grace before scoring without them. Sent once per attempt.
     */
    private closeEarlyIfDecided(): void {
        if (
            this.closingSent ||
            this.phase !== 'playing' ||
            this.round === null ||
            this.module.shouldCloseEarly === undefined
        ) {
            return;
        }
        const pending = this.pendingPlayers();
        const reported = [...this.participants].flatMap((id) => this.results.get(id) ?? []);
        if (!this.module.shouldCloseEarly(reported, this.participants.size, this.round)) {
            return;
        }

        this.closingSent = true;
        this.events.onRoundClosing?.({
            roundId: this.roundId,
            attempt: this.attemptIndex,
            pending,
            graceMs: SELF_TIMED.CLOSING_GRACE_MS
        });
        this.closingTimer = setTimeout(() => {
            this.closingTimer = null;
            if (this.phase === 'playing') this.resolve();
        }, SELF_TIMED.CLOSING_GRACE_MS);
    }

    private clearClosingTimer(): void {
        if (this.closingTimer) clearTimeout(this.closingTimer);
        this.closingTimer = null;
    }

    private pendingPlayers(): string[] {
        return [...this.participants].filter((id) => !this.results.has(id));
    }

    private emitReadyState(): void {
        this.events.onReadyState({
            roundId: this.roundId,
            attempt: this.attemptIndex,
            ready: [...this.ready],
            waitingFor: [...this.participants].filter((id) => !this.ready.has(id)),
            deadlineServerMs: this.readyDeadlineMs
        });
    }

    private scheduleStart(): void {
        this.clearTimer();
        this.phase = 'starting';
        const now = monotonicNowMs();
        this.startAtServerMs = now + this.timing.startLeadMs;
        this.events.onStartAt({
            roundId: this.roundId,
            attempt: this.attemptIndex,
            startAtServerMs: this.startAtServerMs,
            countdownMs: this.timing.countdownMs,
            timingStartsAtServerMs:
                this.startAtServerMs + this.timing.countdownMs,
            serverTimeMs: now
        });
        this.setTimer(() => this.beginCountdown(), this.timing.startLeadMs);
    }

    /**
     * Someone never acknowledged. Rather than hanging the room, they drop out
     * of the attempt and are recorded as a no-show.
     */
    private onReadyCheckTimeout(): void {
        if (this.phase !== 'ready-check') return;
        for (const playerId of [...this.participants]) {
            if (!this.ready.has(playerId)) this.participants.delete(playerId);
        }
        if (this.participants.size === 0) {
            this.resolve();
            return;
        }
        this.emitReadyState();
        this.scheduleStart();
    }

    /**
     * The round has started and the client is showing "3, 2, 1". Nothing is
     * being timed yet, so the server does not start counting toward the
     * result deadline until this has elapsed.
     */
    private beginCountdown(): void {
        if (this.phase !== 'starting' || this.round === null) return;
        this.phase = 'countdown';
        this.setTimer(() => this.beginPlaying(), this.timing.countdownMs);
    }

    private beginPlaying(): void {
        if (this.phase !== 'countdown' || this.round === null) return;
        this.phase = 'playing';
        // The game's timeout is measured from here, not from the round start,
        // so it means what its name says: target + grace of actual timing.
        this.setTimer(() => this.resolve(), this.module.resultTimeoutMs(this.round));
    }

    private resolve(): void {
        if (this.cancelled || this.phase === 'results' || this.round === null) return;
        this.clearTimer();
        this.clearClosingTimer();
        this.clearTrailingProgress();
        this.phase = 'results';

        const entries: ResultEntry<TResult>[] = [...this.results].map(
            ([playerId, result]) => ({ playerId, result })
        );
        const ranked = this.module.rank(entries, this.round);
        const noShow = this.pendingPlayers();
        const leaders = ranked.filter((row) => row.rank === 1).map((r) => r.playerId);

        // A stage advance comes first, so it is never mistaken for a tie.
        const stage = this.module.nextStage?.(ranked, this.round) ?? null;
        if (stage !== null) {
            this.advanceToNextStage(ranked, noShow, stage);
            return;
        }

        const canRetry =
            leaders.length > 1 &&
            this.tiebreakersRun < SELF_TIMED.MAX_TIEBREAK_ATTEMPTS - 1;
        if (canRetry) {
            this.runTiebreaker(ranked, noShow, leaders);
            return;
        }

        this.finishRound(ranked, noShow, leaders);
    }

    /** The game has more stages (e.g. heats, then a final): go on with the chosen players. */
    private advanceToNextStage(
        ranked: RankedEntry[],
        noShow: string[],
        stage: StageAdvance
    ): void {
        this.events.onAttemptResolved({
            roundId: this.roundId,
            attempt: this.attemptIndex,
            isTiebreak: this.isTiebreak,
            ranked,
            noShow,
            winnerId: null,
            decidedByCoinFlip: false,
            advancing: stage.participants,
            stageBreakMs: stage.pauseMs,
            isFinal: false
        });

        const nextAttempt = this.attemptIndex + 1;
        this.setTimer(() => {
            this.participants = new Set(stage.participants);
            this.startAttempt(nextAttempt, false, stage.timing);
        }, stage.pauseMs);
    }

    /**
     * A tie is the game's business: run another attempt among just the tied
     * players and still hand back one winner.
     */
    private runTiebreaker(
        ranked: RankedEntry[],
        noShow: string[],
        tied: string[]
    ): void {
        this.events.onAttemptResolved({
            roundId: this.roundId,
            attempt: this.attemptIndex,
            isTiebreak: this.isTiebreak,
            ranked,
            noShow,
            winnerId: null,
            decidedByCoinFlip: false,
            advancing: null,
            stageBreakMs: 0,
            isFinal: false
        });

        this.tiebreakersRun += 1;
        const nextAttempt = this.attemptIndex + 1;
        this.setTimer(() => {
            this.participants = new Set(tied);
            this.startAttempt(nextAttempt, true);
        }, TIEBREAK_DELAY_MS);
    }

    private finishRound(
        ranked: RankedEntry[],
        noShow: string[],
        leaders: string[]
    ): void {
        let winnerId: string | null = null;
        let decidedByCoinFlip = false;
        if (leaders.length === 1) {
            winnerId = leaders[0]!;
        } else if (leaders.length > 1) {
            // Tiebreakers exhausted. Draw, and say so rather than pretending.
            winnerId = leaders[Math.floor(Math.random() * leaders.length)]!;
            decidedByCoinFlip = true;
        }

        this.events.onAttemptResolved({
            roundId: this.roundId,
            attempt: this.attemptIndex,
            isTiebreak: this.isTiebreak,
            ranked,
            noShow,
            winnerId,
            decidedByCoinFlip,
            advancing: null,
            stageBreakMs: 0,
            isFinal: true
        });
    }

    private setTimer(fn: () => void, delayMs: number): void {
        this.clearTimer();
        this.timer = setTimeout(fn, Math.max(0, delayMs));
    }

    private clearTimer(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }

    /* -------------------------------------------------------------- */
    /* Views                                                            */
    /* -------------------------------------------------------------- */

    describe() {
        return {
            phase: this.phase,
            roundId: this.roundId,
            attempt: this.attemptIndex,
            gameId: this.gameId,
            gameIndex: this.gameIndex,
            totalGames: this.totalGames,
            roundInGame: this.roundInGame,
            roundsPerGame: this.roundsPerGame,
            isTiebreak: this.isTiebreak,
            participants: [...this.participants],
            ready: [...this.ready],
            waitingFor: [...this.participants].filter((id) => !this.ready.has(id)),
            startAtServerMs: this.startAtServerMs
        };
    }

    /** Round data payload rebuilt for a client that reconnected mid-round. */
    snapshotRoundData(): RoundDataPayload | null {
        if (this.round === null) return null;
        return {
            roundId: this.roundId,
            attempt: this.attemptIndex,
            gameId: this.gameId,
            data: this.round,
            isTiebreak: this.isTiebreak,
            participants: [...this.participants],
            resultTimeoutMs: this.module.resultTimeoutMs(this.round),
            gameIndex: this.gameIndex,
            totalGames: this.totalGames,
            roundInGame: this.roundInGame,
            progress: Object.fromEntries(this.latestProgress)
        };
    }
}
