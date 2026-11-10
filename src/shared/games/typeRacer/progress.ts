/**
 * Race progress, for the shared progress bar.
 *
 * One bar shows every player. It has one section per paragraph, with a
 * checkpoint at the end of each. Every character in the race takes the same
 * width, so a section is as wide as its paragraph is long: a short paragraph
 * gets a short section and its checkpoint sits earlier on the bar. Inside a
 * section, the paragraph's characters are the whole 100% and every character a
 * player has typed correctly is one equal part of it. A mistake sends the
 * player back to the start of their line, so their marker steps back by the
 * characters of that line.
 *
 * "Characters typed" is the number of correct characters across the race: all
 * the lines already finished plus the correct part of the line being typed.
 * Both the client (to draw the bar and report progress) and the server (to
 * check a report and to score the final result) use these functions.
 *
 * Plain functions over plain data.
 */

import type { Paragraph } from './types';

export const paragraphLength = (paragraph: Paragraph): number =>
    paragraph.reduce((sum, line) => sum + line.length, 0);

export const totalCharacters = (paragraphs: readonly Paragraph[]): number =>
    paragraphs.reduce((sum, paragraph) => sum + paragraphLength(paragraph), 0);

/** Where a player is in the race, as the client tracks it while typing. */
export interface TypingPosition {
    paragraphIndex: number;
    lineIndex: number;
    /** Correct characters typed so far on the current line. */
    typedInLine: number;
}

/** Correct characters typed so far in the whole race. */
export const charactersTyped = (
    paragraphs: readonly Paragraph[],
    { paragraphIndex, lineIndex, typedInLine }: TypingPosition
): number => {
    const finishedParagraphs = paragraphs
        .slice(0, paragraphIndex)
        .reduce((sum, paragraph) => sum + paragraphLength(paragraph), 0);
    const finishedLines = (paragraphs[paragraphIndex] ?? [])
        .slice(0, lineIndex)
        .reduce((sum, line) => sum + line.length, 0);
    return finishedParagraphs + finishedLines + typedInLine;
};

/** Where on the shared bar a player's marker sits. */
export interface BarPosition {
    /** The section (paragraph) the marker is in. Equals the paragraph count once finished. */
    paragraphIndex: number;
    /** How far through that section, 0 to 1: characters typed out of its characters. */
    fractionOfSection: number;
    /** How far along the whole bar, 0 to 1. A section's width follows its length. */
    fractionOfBar: number;
}

/** Turns "characters typed in the race" into a position on the shared bar. */
export const locateOnBar = (
    paragraphs: readonly Paragraph[],
    chars: number
): BarPosition => {
    const total = totalCharacters(paragraphs);
    const typed = Math.min(Math.max(0, chars), total);
    let remaining = typed;

    for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
        const length = paragraphLength(paragraph);
        if (remaining < length) {
            return {
                paragraphIndex,
                fractionOfSection: remaining / length,
                fractionOfBar: typed / total
            };
        }
        remaining -= length;
    }
    return { paragraphIndex: paragraphs.length, fractionOfSection: 1, fractionOfBar: 1 };
};

/**
 * Where the checkpoints sit on the bar, as fractions: the end of each
 * paragraph. They are uneven: a short paragraph's checkpoint comes earlier.
 * The last one is always 1.
 */
export const checkpointFractions = (paragraphs: readonly Paragraph[]): number[] => {
    const total = totalCharacters(paragraphs);
    let typedAtEnd = 0;
    return paragraphs.map((paragraph) => {
        typedAtEnd += paragraphLength(paragraph);
        return typedAtEnd / total;
    });
};
