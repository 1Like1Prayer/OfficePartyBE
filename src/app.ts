import express from 'express';
const { createServer } = require('node:http');
import { Server } from 'socket.io';
import compression from 'compression';
import cors from 'cors';
import bodyParser from 'body-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import router from './routes';
import errorMiddleware from './middleware/errorMiddleware';
import { registerSocketRoutes } from './routes/socketRouter';

import config from './config/config';


const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes).
    standardHeaders: 'draft-7', // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
    legacyHeaders: false // Disable the `X-RateLimit-*` headers.
});

const app = express();
app
    .use(limiter)
    .use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io"],
                connectSrc: ["'self'", "ws:", "wss:"]
            }
        }
    }))
    .use(cors())
    .use(bodyParser.json())
    .use(compression())
    .use(router)
    .use(errorMiddleware);

const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

registerSocketRoutes(io);

// We're using Server instead of app.listen to allow socket.io to work
// @ts-ignore
server.listen(config.PORT, () => console.log('listening on port', config.PORT)
);

//this is for vercel deployment
export default app;