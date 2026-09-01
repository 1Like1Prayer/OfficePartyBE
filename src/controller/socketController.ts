import { Server, Namespace, Socket } from 'socket.io';
import logger from '../logger/logger';

/**
 * Handles the /socket namespace connection events
 */
export const handleSocketConnection = (socketNamespace: Namespace) => {
    socketNamespace.on('connection', (socket: Socket) => {
        logger.info('a user has connected to /socket namespace');

        // Broadcast to all connected clients (including the new one)
        socketNamespace.emit('message', 'a user has connected');

        socket.on('test', (payload: unknown) => {
            const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
            logger.info(`test message received: ${text}`);

            // Echo back to every client so it shows up on the test page
            socketNamespace.emit('message', `test: ${text}`);
        });

        socket.on('disconnect', () => {
            logger.info('a user has disconnected from /socket namespace');
        });
    });
};
