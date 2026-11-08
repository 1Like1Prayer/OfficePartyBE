/**
 * Rank assignment shared by every self-timed game.
 *
 * Callers sort their entries best-first and say what counts as a tie. Tied
 * entries share a rank and the next rank skips ahead (1, 1, 3), which is the
 * runner's signal to run a tiebreaker among just the entries sharing rank 1.
 */

export interface RankedItem<T> {
    item: T;
    rank: number;
}

export const assignSharedRanks = <T>(
    sortedBestFirst: readonly T[],
    isTie: (a: T, b: T) => boolean
): RankedItem<T>[] => {
    const ranked: RankedItem<T>[] = [];

    sortedBestFirst.forEach((item, index) => {
        const previous = ranked[index - 1];
        const rank =
            previous !== undefined && isTie(previous.item, item)
                ? previous.rank
                : index + 1;
        ranked.push({ item, rank });
    });

    return ranked;
};
