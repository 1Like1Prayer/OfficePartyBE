import { randomUUID } from 'node:crypto';
import { ROOM } from '../shared/constants';

/**
 * A playerId survives reconnection. socket.id changes every reconnect, so it
 * is never used as a key for anything that outlives a connection (section 5).
 */
export const newPlayerId = (): string => randomUUID();

/**
 * Room codes are short and spoken out loud, so the alphabet has no 0/O or
 * 1/I. `isTaken` lets the manager retry rather than risk a collision.
 */
export const newRoomCode = (isTaken: (code: string) => boolean): string => {
    const { CODE_LENGTH, CODE_ALPHABET } = ROOM;
    for (let attempt = 0; attempt < 100; attempt++) {
        let code = '';
        for (let i = 0; i < CODE_LENGTH; i++) {
            code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
        }
        if (!isTaken(code)) return code;
    }
    // Astronomically unlikely at office scale, but don't hand back a duplicate.
    return `${randomUUID().slice(0, CODE_LENGTH).toUpperCase()}`;
};

export const normalizeRoomCode = (raw: string): string =>
    raw.trim().toUpperCase();

export const sanitizeName = (raw: unknown, fallback: string): string => {
    if (typeof raw !== 'string') return fallback;
    const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, ROOM.MAX_NAME_LENGTH);
    return cleaned.length > 0 ? cleaned : fallback;
};
