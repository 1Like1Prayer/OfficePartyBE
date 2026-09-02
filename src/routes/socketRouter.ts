import { Router } from 'express';
import { Server } from 'socket.io';
import { handleSocketConnection } from '../controller/socketController';
import { registerGameNamespace } from '../controller/gameSocketController';
import { getSocketTestPage } from '../controller/socketPageController';
import { GAME_NAMESPACE } from '../shared/protocol';

export const socketHttpRouter: Router = Router();
socketHttpRouter.get('/socket', getSocketTestPage);

export const registerSocketRoutes = (io: Server): void => {
    const socketNamespace = io.of('/socket');
    handleSocketConnection(socketNamespace);

    registerGameNamespace(io.of(GAME_NAMESPACE));
};
