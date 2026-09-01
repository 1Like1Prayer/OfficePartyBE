import { Router } from 'express';
import {helloWorld, vercelHelloWorld} from '../controller/homeController';

export const homeRouter: Router = Router();

homeRouter.get('/', helloWorld);
homeRouter.get('/vercel',vercelHelloWorld)