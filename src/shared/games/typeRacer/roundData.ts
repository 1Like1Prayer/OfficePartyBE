/** Building the paragraphs for one race. */

import { randomInt, shuffled, type RandomSource } from '../random';
import { TYPE_RACER } from './constants';
import { EASY_PARAGRAPHS, PARAGRAPH_CATEGORIES } from './texts';
import type { Paragraph, TypeRacerRound } from './types';

const NONCE_LENGTH = 24;
const HEX = '0123456789abcdef';

/** Only needs to differ from round to round; the secret lives on the server. */
const randomNonce = (random: RandomSource): string =>
    Array.from({ length: NONCE_LENGTH }, () => HEX[randomInt(random, 0, HEX.length - 1)]).join('');

const pickOne = <T>(items: readonly T[], random: RandomSource): T =>
    items[randomInt(random, 0, items.length - 1)]!;

/** The warm-up: a random 1 or 2 different easy paragraphs, in random order. */
const pickEasyParagraphs = (random: RandomSource): Paragraph[] => {
    const count = randomInt(random, TYPE_RACER.MIN_EASY_PARAGRAPHS, TYPE_RACER.MAX_EASY_PARAGRAPHS);
    return shuffled(EASY_PARAGRAPHS, random).slice(0, count);
};

/**
 * The hard part: 3 different categories chosen at random and put in random
 * order, then one random paragraph from each.
 */
const pickHardParagraphs = (random: RandomSource): Paragraph[] =>
    shuffled(PARAGRAPH_CATEGORIES, random)
        .slice(0, TYPE_RACER.HARD_PARAGRAPHS)
        .map((category) => pickOne(category.paragraphs, random));

export const createTypeRacerRound = (random: RandomSource = Math.random): TypeRacerRound => {
    const paragraphs = [...pickEasyParagraphs(random), ...pickHardParagraphs(random)];
    return {
        paragraphs: paragraphs.map((lines) => [...lines]),
        rollNonce: randomNonce(random)
    };
};
