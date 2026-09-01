import { Router } from 'express';
import { Server } from 'socket.io';
import { handleSocketConnection } from '../controller/socketController';
import { getSocketTestPage } from '../controller/socketPageController';

export const socketHttpRouter: Router = Router();
socketHttpRouter.get('/socket', getSocketTestPage);

export const registerSocketRoutes = (io: Server): void => {
    const socketNamespace = io.of('/socket');
    handleSocketConnection(socketNamespace);
};
