/**
 * Randomness helpers shared by the game generators. Every generator takes a
 * RandomSource instead of calling Math.random directly, so tests can pass a
 * seeded one and get repeatable results.
 */

/** Returns a number in [0, 1), like Math.random. */
export type RandomSource = () => number;

/** A whole number from min to max, both included. */
export const randomInt = (random: RandomSource, min: number, max: number): number =>
    min + Math.floor(random() * (max - min + 1));

/** Fisher-Yates shuffle, on a copy. */
export const shuffled = <T>(items: readonly T[], random: RandomSource = Math.random): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
};
