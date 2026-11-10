/**
 * The typing rules, in one place so the client and the server agree by
 * construction.
 *
 *  - Matching is exact: case-sensitive, punctuation and spaces included.
 *  - Text is plain ASCII, so there is no Unicode normalisation to argue about.
 *  - A wrong key is a mistake at once: the line restarts and the paragraph
 *    gains a strike. Backspace does not repair it.
 *  - Pasting doesn't count; the client only accepts key presses.
 */

/** True while what the player has typed is still the start of the line. */
export const isCorrectSoFar = (line: string, typed: string): boolean =>
    line.startsWith(typed);

export const isLineComplete = (line: string, typed: string): boolean => typed === line;
