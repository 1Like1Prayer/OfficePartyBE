/**
 * Holds every live room in this process. No database, no Redis: a server
 * restart takes the rooms with it and clients are told "room not found"
 * rather than being left in a reconnect loop (section 12).
 */

import { ROOM } from '../shared/constants';
import logger from '../logger/logger';
import { monotonicNowMs, systemClock, type Clock } from './clock';
import { newRoomCode, normalizeRoomCode } from './ids';
import { Room, type RoomEmitter } from './room';

export class RoomManager {
    private readonly rooms = new Map<string, Room>();
    private readonly clock: Clock;
    private sweepTimer: NodeJS.Timeout | null = null;

    constructor(clock: Clock = systemClock) {
        this.clock = clock;
    }

    createRoom(emitterFor: (roomCode: string) => RoomEmitter): Room {
        const roomCode = newRoomCode((code) => this.rooms.has(code));
        const room = new Room({
            roomCode,
            emitter: emitterFor(roomCode),
            clock: this.clock
        });
        this.rooms.set(roomCode, room);
        logger.info(`room ${roomCode} created (${this.rooms.size} live)`);
        return room;
    }

    getRoom(rawCode: string): Room | null {
        return this.rooms.get(normalizeRoomCode(rawCode)) ?? null;
    }

    closeRoom(roomCode: string): void {
        const room = this.rooms.get(roomCode);
        if (!room) return;
        room.destroy();
        this.rooms.delete(roomCode);
        logger.info(`room ${roomCode} closed (${this.rooms.size} live)`);
    }

    /** Reap rooms that have had nobody connected for a while. */
    sweep(nowMs = monotonicNowMs()): void {
        for (const [roomCode, room] of this.rooms) {
            if (room.isExpired(nowMs)) this.closeRoom(roomCode);
        }
    }

    startSweeping(): void {
        if (this.sweepTimer) return;
        this.sweepTimer = setInterval(() => this.sweep(), ROOM.SWEEP_INTERVAL_MS);
        this.sweepTimer.unref?.();
    }

    stopSweeping(): void {
        if (this.sweepTimer) clearInterval(this.sweepTimer);
        this.sweepTimer = null;
    }

    get size(): number {
        return this.rooms.size;
    }
}

export const roomManager = new RoomManager();
