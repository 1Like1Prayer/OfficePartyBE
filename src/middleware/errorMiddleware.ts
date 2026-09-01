import { NextFunction, Request, Response } from 'express';
import logger from '../logger/logger';

const errorMiddleware = (
    err: any,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    logger.error(err);
    res.status(err.status || 500).json({
        error: {
            message: err.message || 'Internal Server Error'
        }
    });
};

export default errorMiddleware;
