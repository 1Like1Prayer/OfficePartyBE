import { NextFunction, Request, Response } from 'express';

export const helloWorld = (req: Request, res: Response, next: NextFunction) => {
    res.send('hello world');
};

export const vercelHelloWorld = (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    res.send('hello vercel');
};