import winston from 'winston';
const { combine, json, timestamp, errors, printf } = winston.format;

const customFormat = printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} ${level}: ${stack || message}`;
});

const logger = winston.createLogger({
    level: 'info',
    format: combine(
        errors({ stack: true }),
        timestamp({ format: 'YYYY-MM-DD hh:mm:ss.SSS A' }),
        json(),
    ),
    transports: [new winston.transports.Console()]
});

export default logger;