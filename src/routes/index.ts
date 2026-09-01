import { Router } from 'express';
import { homeRouter } from './homeRouter';
import { socketHttpRouter } from './socketRouter';

const router: Router = Router();
router.use(homeRouter).use(socketHttpRouter);
export default router;