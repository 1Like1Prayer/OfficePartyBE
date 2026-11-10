/**
 * The paragraph pool. Each paragraph is a list of lines; a mistake restarts
 * only the line it happens on. Plain ASCII, no leading or trailing spaces.
 *
 * There are two pools. A race opens with 1 or 2 EASY paragraphs (simple
 * words, almost no punctuation) as a warm-up, then moves on to 3 HARD ones.
 *
 * The hard pool is deliberately mixed so no two races feel alike:
 *  - field notes, full of numbers, colons and dashes;
 *  - alphabets (A - apple, B - banana, ...);
 *  - word salad, where the grammar has fallen apart;
 *  - long words with spelling mistakes left in on purpose;
 *  - text with no spaces at all;
 *  - everyday oddities: dialogue, a recipe, a captain's log.
 *
 * Between them they use every punctuation mark the game promises: , . ! ? : - '
 */

import type { Paragraph } from './types';

/** Easy warm-up text: short, simple words, and only the odd comma or full stop. */
export const EASY_PARAGRAPHS: readonly Paragraph[] = [
    [
        'The dog runs in the park every morning.',
        'He likes to chase a red ball and bring it back.',
        'Then he drinks some water and lies down in the sun.',
        'It is a good day for a happy dog.'
    ],
    [
        'It is raining outside today so we stay at home.',
        'My mom makes hot tea and we sit by the window.',
        'The rain is soft and slow and the room is warm.',
        'Later we will read a book and eat some bread.'
    ],
    [
        'The cat sleeps on the old chair near the door.',
        'When the sun comes up she opens her eyes slowly.',
        'She stretches her legs and walks to the kitchen.',
        'A bowl of milk is waiting for her there.'
    ],
    [
        'We went to the beach on a warm and sunny day.',
        'The sand was soft, and the water was cool.',
        'My brother built a big castle with a tall tower.',
        'We ate lunch and swam until the evening came.'
    ],
    [
        'Every Saturday I ride my bike to the small market.',
        'I buy apples, bread and a little bag of nuts.',
        'The man at the stand always gives me a big smile.',
        'Then I ride home and share the food with my family.'
    ]
];

const FIELD_NOTES: Paragraph[] = [
    [
        "Specimen ID: 045 Coordinates: 54d12'N, 13d44'E",
        'Observed traits: - Hexapod, est. 4.1 cm, weight under 2 g',
        '- Exoskeleton: green-black, iridescent',
        '- Habit: drums on bark at dusk. Retreats when lit!'
    ],
    [
        'Specimen ID: 212 Depth: 3,870 m Station: Trench-7',
        'Observed traits: - Bioluminescent lure, blue-white pulse',
        '- Body: translucent, gelatinous, est. 12 cm across',
        '- Note: did it just blink at the camera? Re-check footage.'
    ],
    [
        'Field log: Day 14 - Marsh transect B',
        'Weather: overcast, 9 C, wind NNW at 12 km/h',
        'Sighted: 3 herons, 1 otter (?), and countless midges!',
        'Note: boots ruined - swap for waders tomorrow.'
    ],
    [
        "Specimen ID: 318 Location: oak hollow, 48d51'N, 2d21'E",
        'Cap: rust-orange, 6 cm, sticky when damp. Smell: pear?',
        '- Gills: cream, crowded - spore print pending',
        "- Warning: DO NOT TASTE. Seriously, don't!"
    ]
];

const ALPHABETS: Paragraph[] = [
    [
        'A - apple, B - banana, C - cherry, D - dates,',
        'E - eggplant, F - fig, G - grapes, H - honey!',
        'I - icing, J - jam, K - kiwi, L - lemon, M - mango:',
        'N - nectarine, O - olive, P - peach, Q - quince?'
    ],
    [
        'A - Ant, B - Bat, C - Cat, D - Dog, E - Eel, F - Fox,',
        'G - Goat, H - Hen, I - Ibis, J - Jackal, K - Koala,',
        'L - Lynx, M - Mole, N - Newt, O - Owl, P - Panda,',
        'Q - Quail, R - Rat, S - Seal, T - Toad, U - Urchin!'
    ],
    [
        'Z - zebra, Y - yak, X - x-ray fish, W - walrus,',
        'V - vulture, U - urchin, T - tiger, S - snail,',
        'R - raven, Q - quokka, P - parrot, O - otter?',
        'N - narwhal, M - moose - and so on, back to A.'
    ]
];

/** Grammar has left the building: odd word order, odd ideas. */
const WORD_SALAD: Paragraph[] = [
    [
        'Yesterday the umbrella, quickly purple, whispered tomorrow',
        "to seven sleepy staircases! Which of nobody's soup",
        'is running? Under it, a loud Tuesday folds backwards:',
        'cheese, therefore, borrowed the moon - and left.'
    ],
    [
        'Over lazy the jumps dog fox quick brown the, and then',
        'the dog? Jumps fox lazy! Brown over quick the - dog,',
        'then fox, then over: the the the lazy brown jumps.'
    ],
    [
        'Me gone is shopping the to went I yesterday tomorrow,',
        'banana telephone! Sing does the carpet? Never always',
        'under, the sideways clock - eats lunch, yes: no.'
    ],
    [
        'Ocean the climbs ladder up a, softly loudly, because',
        "nine hats don't remember who's driving the soup-bus:",
        'left, right, upside - the pigeons voted! Why? Why not?'
    ]
];

/** Long words, spelled wrongly on purpose. Type them exactly as shown. */
const MISSPELLED_LONG_WORDS: Paragraph[] = [
    [
        "My dictionery says antidisestablishmentarianizm is real,",
        "but I'm not sure. Supercalifragilisticexpialodocius?",
        'Pneumonoultramicroscopicsilicovolcanokoniosis: wow!',
        'Please, nobody ask me to spel them again - ever.'
    ],
    [
        'The magnifisent, extraordinarilly unneccessary committee',
        'discused hippopotomonstrosesquippedaliophobia: fear',
        "of long words, naturaly! Embarassing, isn't it? Yes."
    ],
    [
        'Electroencephalogramm results: inconclussive, but the',
        'pharmaseutical representitive, Dr. Bartholomeu, insists',
        'on the incomprehensibilty of ofthalmologicall jargon!',
        'Conscientiousnes, perseverence, and cofee: my recipee.'
    ]
];

/** No spaces anywhere: the line is one long word. */
const NO_SPACES: Paragraph[] = [
    [
        'Thequickbrownfoxjumpsoverthelazydog,thenwentstraighttobed.',
        'Nobodyknowswhy,butthefoxhaslefthisgloveontheporch!',
        'Wasitaccidental?Maybenot:foxeslovedramaticexits-andlunch.'
    ],
    [
        'Itwasadarkandstormynight,andtheoldlighthouseblinkedtwice:',
        'once-forhelp,onceforhope.Butwhowasthekeeperthatnight?',
        'Nobodyremembers.Yetthelampstillturnsbyitself-andwaits!'
    ],
    [
        'Todaylist:eggs,flour,butter,sugar,vanilla-andsurprisingly,',
        'threeduckpondsandahelmet!Whoneedsahelmetforbaking?Me.',
        "Don'tjudge-it'sbeenalongweek,andthecakeisverylarge."
    ]
];

const EVERYDAY_ODDITIES: Paragraph[] = [
    [
        "'Did you feed the cat?' she asked. 'Which one?' he said.",
        "'The grumpy one!' 'Oh - Biscuit. Yes: twice, I think.'",
        "'Twice?!' 'Hey, he asked nicely. Cats are persuasive.'"
    ],
    [
        'Midnight pancakes: 2 eggs, 1 cup flour, 1 cup milk,',
        'a pinch of salt - and a very large spoon. Whisk it!',
        'Pour, wait, flip: golden? Perfect. Burnt? Call it art.'
    ],
    [
        "Captain's log, day 41: the crew is restless, the tea",
        'is gone, and the compass spins in circles! Why? Nobody',
        'knows. Morale: low. Biscuits: lower. Hope: steady-ish.'
    ]
];

export interface ParagraphCategory {
    name: string;
    paragraphs: readonly Paragraph[];
}

/**
 * The hard paragraphs. A round draws one from each of several different
 * categories, so it never ends up as, say, three sets of field notes.
 */
export const PARAGRAPH_CATEGORIES: readonly ParagraphCategory[] = [
    { name: 'field-notes', paragraphs: FIELD_NOTES },
    { name: 'alphabets', paragraphs: ALPHABETS },
    { name: 'word-salad', paragraphs: WORD_SALAD },
    { name: 'misspelled-long-words', paragraphs: MISSPELLED_LONG_WORDS },
    { name: 'no-spaces', paragraphs: NO_SPACES },
    { name: 'everyday-oddities', paragraphs: EVERYDAY_ODDITIES }
];

export const HARD_PARAGRAPH_POOL: readonly Paragraph[] = PARAGRAPH_CATEGORIES.flatMap(
    (category) => category.paragraphs
);
