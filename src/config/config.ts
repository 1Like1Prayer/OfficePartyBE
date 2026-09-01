import process from 'node:process';
import { config as dotenvConfig  } from 'dotenv';
import path from 'node:path';
import { z } from 'zod';
import logger from '../logger/logger';

const env = process.env.NODE_ENV || 'development';
dotenvConfig({ path: path.resolve(__dirname, `../../.env.${env}`) });
const configSchema = z.object({
    PORT:z.string(),
    NODE_ENV:z.enum(['development', 'production']),
})


const parsedConfig = configSchema.safeParse(process.env)
if (!parsedConfig.success) {
    logger.error(parsedConfig.error.flatten().fieldErrors)
}
export default parsedConfig.data