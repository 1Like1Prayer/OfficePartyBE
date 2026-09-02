/**
 * Socket.IO wiring for the game namespace.
 *
 * This file is deliberately thin: it validates untrusted input, resolves the
 * socket to a (room, player) pair, and calls into the Room. All the rules
 * live in game/ and shared/, where they can be tested without a socket.
 *
 * Per section 13, everything here is bookkeeping rather than enforcement:
 * malformed messages are logged and ignored instead of thrown.
 */

import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import logger from '../logger/logger';
import { PROTOCOL_VERSION, ROOM } from '../shared/constants';
import { GAME_IDS } from '../shared/games/catalog';
import {
    ClientEvent,
    ServerEvent,
    type Ack,
    type ErrorCode
} from '../shared/protocol';
import { monotonicNowMs } from '../game/clock';
import { roomManager } from '../game/roomManager';
import type { Room, RoomEmitter, RoomResult } from '../game/room';

interface SocketSession {
    roomCode?: string;
    playerId?: string;
}

const nameSchema = z.string().max(ROOM.MAX_NAME_LENGTH * 4).optional();
const playerIdSchema = z.string().uuid().optional();
const roomCodeSchema = z.string().min(1).max(16);
const gameIdSchema = z.enum(GAME_IDS);

const createSchema = z.object({ name: nameSchema }).default({});
const joinSchema = z.object({
    roomCode: roomCodeSchema,
    name: nameSchema,
    playerId: playerIdSchema
});
const setNameSchema = z.object({ name: z.string().max(ROOM.MAX_NAME_LENGTH * 4) });
const setModeSchema = z.object({
    mode: z.enum(['random', 'custom']),
    gameIds: z.array(gameIdSchema).max(10).optional()
});
const roundEnvelopeSchema = z.object({
    roundId: z.number().int().nonnegative(),
    attempt: z.number().int().nonnegative()
});
const resultSchema = roundEnvelopeSchema.extend({
    /** Game-specific and validated by the game module, not here. */
    result: z.unknown()
});
const progressSchema = roundEnvelopeSchema.extend({ progress: z.unknown() });

type AckFn = (response: Ack<unknown>) => void;

const ok = <T>(data: T): Ack<T> => ({ ok: true, data });
const err = (code: ErrorCode, message: string): Ack<never> => ({
    ok: false,
    code,
    message
});

/** Acks are optional on the wire; never call a non-function. */
const respond = (ack: unknown, response: Ack<unknown>): void => {
    if (typeof ack === 'function') (ack as AckFn)(response);
};

const toAck = <T>(result: RoomResult<T>): Ack<T> =>
    result.ok ? ok(result.data) : err(result.code, result.message);

export const registerGameNamespace = (namespace: Namespace): void => {
    const emitterFor = (roomCode: string): RoomEmitter => ({
        toRoom: (event, payload) => namespace.to(roomCode).emit(event, payload),
        toSocket: (socketId, event, payload) =>
            namespace.to(socketId).emit(event, payload)
    });

    roomManager.startSweeping();

    /**
     * Client and server ship separately, and with game logic in the browser a
     * stale client is running different rules. Reject in the handshake rather
     * than after connecting: an emit followed by an immediate disconnect can
     * lose the packet, and the client sees this as a connect_error carrying
     * the reason.
     */
    namespace.use((socket, next) => {
        const claimed = Number(socket.handshake.auth?.['protocolVersion']);
        if (claimed === PROTOCOL_VERSION) {
            next();
            return;
        }
        const error = new Error('Please reload to get the current version.') as Error & {
            data?: unknown;
        };
        error.data = {
            code: ServerEvent.ProtocolMismatch,
            expected: PROTOCOL_VERSION,
            received: Number.isFinite(claimed) ? claimed : null
        };
        next(error);
    });

    namespace.on('connection', (socket: Socket) => {
        const session: SocketSession = {};

        const currentRoom = (): Room | null =>
            session.roomCode ? roomManager.getRoom(session.roomCode) : null;

        /** Resolve the socket to a live (room, player) pair, or explain why not. */
        const requireMembership = ():
            | { room: Room; playerId: string }
            | Ack<never> => {
            const room = currentRoom();
            if (!room) return err('room_not_found', 'That room is gone.');
            if (!session.playerId || !room.hasPlayer(session.playerId)) {
                return err('not_in_room', 'You are not in this room.');
            }
            return { room, playerId: session.playerId };
        };

        /** Wrap a handler so a malformed message is logged, never thrown. */
        const handle = (
            event: string,
            fn: (payload: unknown, ack: unknown) => void
        ): void => {
            socket.on(event, (payload: unknown, ack: unknown) => {
                try {
                    fn(payload, ack);
                } catch (error) {
                    logger.error(
                        `game socket handler ${event} failed: ${(error as Error).message}`
                    );
                    respond(ack, err('internal', 'Something went wrong.'));
                }
            });
        };

        handle(ClientEvent.Ping, (_payload, ack) => {
            respond(ack, ok({ serverTimeMs: monotonicNowMs() }));
        });

        handle(ClientEvent.CreateRoom, (payload, ack) => {
            const parsed = createSchema.safeParse(payload ?? {});
            if (!parsed.success) {
                respond(ack, err('invalid_payload', 'Bad create payload.'));
                return;
            }
            const room = roomManager.createRoom(emitterFor);
            socket.join(room.roomCode);
            const result = room.join({
                socketId: socket.id,
                name: parsed.data.name
            });
            if (result.ok) {
                session.roomCode = room.roomCode;
                session.playerId = result.data.playerId;
            }
            respond(ack, toAck(result));
        });

        handle(ClientEvent.JoinRoom, (payload, ack) => {
            const parsed = joinSchema.safeParse(payload);
            if (!parsed.success) {
                respond(ack, err('invalid_payload', 'Bad join payload.'));
                return;
            }
            const room = roomManager.getRoom(parsed.data.roomCode);
            if (!room) {
                respond(ack, err('room_not_found', 'No room with that code.'));
                return;
            }
            socket.join(room.roomCode);
            const result = room.join({
                socketId: socket.id,
                name: parsed.data.name,
                playerId: parsed.data.playerId
            });
            if (result.ok) {
                session.roomCode = room.roomCode;
                session.playerId = result.data.playerId;
            } else {
                socket.leave(room.roomCode);
            }
            respond(ack, toAck(result));
        });

        handle(ClientEvent.RequestState, (_payload, ack) => {
            const membership = requireMembership();
            if ('ok' in membership) {
                respond(ack, membership);
                return;
            }
            respond(ack, ok(membership.room.getState()));
        });

        handle(ClientEvent.SetName, (payload, ack) => {
            const membership = requireMembership();
            if ('ok' in membership) {
                respond(ack, membership);
                return;
            }
            const parsed = setNameSchema.safeParse(payload);
            if (!parsed.success) {
                respond(ack, err('invalid_payload', 'Bad name payload.'));
                return;
            }
            respond(
                ack,
                toAck(membership.room.setName(membership.playerId, parsed.data.name))
            );
        });

        handle(ClientEvent.SetMode, (payload, ack) => {
            const membership = requireMembership();
            if ('ok' in membership) {
                respond(ack, membership);
                return;
            }
            const parsed = setModeSchema.safeParse(payload);
            if (!parsed.success) {
                respond(ack, err('invalid_payload', 'Bad mode payload.'));
                return;
            }
            respond(
                ack,
                toAck(
                    membership.room.setMode(
                        membership.playerId,
                        parsed.data.mode,
                        parsed.data.gameIds
                    )
                )
            );
        });

        handle(ClientEvent.StartCompetition, (_payload, ack) => {
            const membership = requireMembership();
            if ('ok' in membership) {
                respond(ack, membership);
                return;
            }
            respond(ack, toAck(membership.room.startCompetition(membership.playerId)));
        });

        handle(ClientEvent.SkipResults, (_payload, ack) => {
            const membership = requireMembership();
            if ('ok' in membership) {
                respond(ack, membership);
                return;
            }
            respond(ack, toAck(membership.room.skipResults(membership.playerId)));
        });

        handle(ClientEvent.Ready, (payload, ack) => {
            const membership = requireMembership();
            if ('ok' in membership) {
                respond(ack, membership);
                return;
            }
            const parsed = roundEnvelopeSchema.safeParse(payload);
            if (!parsed.success) {
                respond(ack, err('invalid_payload', 'Bad ready payload.'));
                return;
            }
            respond(
                ack,
                toAck(
                    membership.room.markReady(
                        membership.playerId,
                        parsed.data.roundId,
                        parsed.data.attempt
                    )
                )
            );
        });

        handle(ClientEvent.SubmitResult, (payload, ack) => {
            const membership = requireMembership();
            if ('ok' in membership) {
                respond(ack, membership);
                return;
            }
            const parsed = resultSchema.safeParse(payload);
            if (!parsed.success) {
                respond(ack, err('invalid_payload', 'Bad result payload.'));
                return;
            }
            respond(
                ack,
                toAck(
                    membership.room.submitResult(
                        membership.playerId,
                        parsed.data.roundId,
                        parsed.data.attempt,
                        parsed.data.result
                    )
                )
            );
        });

        // Progress is display-only and unacknowledged: dropping one costs nothing.
        handle(ClientEvent.Progress, (payload) => {
            const membership = requireMembership();
            if ('ok' in membership) return;
            const parsed = progressSchema.safeParse(payload);
            if (!parsed.success) return;
            membership.room.submitProgress(
                membership.playerId,
                parsed.data.roundId,
                parsed.data.attempt,
                parsed.data.progress
            );
        });

        handle(ClientEvent.LeaveRoom, (_payload, ack) => {
            const membership = requireMembership();
            if (!('ok' in membership)) {
                membership.room.leave(membership.playerId);
                socket.leave(membership.room.roomCode);
            }
            session.roomCode = undefined;
            session.playerId = undefined;
            respond(ack, ok(null));
        });

        socket.on('disconnect', (reason: string) => {
            const room = currentRoom();
            if (room && session.playerId) {
                // Pass the socket id so a reconnect that already reclaimed this
                // slot isn't torn down by the old socket's disconnect.
                room.handleDisconnect(session.playerId, socket.id);
            }
            logger.info(`game socket ${socket.id} disconnected: ${reason}`);
        });
    });
};
