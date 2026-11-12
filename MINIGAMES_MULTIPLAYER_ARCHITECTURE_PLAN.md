# Multiplayer Minigames — Architecture and Implementation Plan

## 1. What this is

A plan for ten browser-based minigames played by a small office group, running on a Node.js server with Socket.IO.

The scale this is built for: up to 8 players in a room, a handful of rooms at once, everyone friendly. That scale rules out most of what a "real" multiplayer platform would need. There is no matchmaking, no accounts, no database, no scaling tier, no anti-cheat. Adding those later is possible; building them now would be most of the work for none of the fun.

The goal is one shared foundation the games sit on, so that adding the ninth game is much less work than the first.

Games without supplied titles use working names:

| # | Working title |
|---|---|
| 1 | Minefield |
| 2 | Cube Counter |
| 3 | Crusher Escalator |
| 4 | Stop the Clock |
| 5 | Type Racer Roulette |
| 6 | Mage Battle |
| 7 | Hidden Crossfire |
| 8 | Log Dodge |
| 9 | Hexa-Gone |
| 10 | Wall Climbers |

## 2. The core idea: three kinds of game

This is the decision everything else follows from.

**Five games are played alone, together.** Stop the Clock, Cube Counter, Crusher Escalator, Type Racer Roulette, and Log Dodge (its logs follow a fixed timed schedule, so there is no physics to agree on) all have each player doing their own thing in their own space. Nothing you do affects my scene, my lane, or my timer. For these, **the browser runs the whole game and reports the result.** The server hands out the round data, waits for everyone to be ready, says go, and collects what comes back.

**Three games use a shared world.** Minefield, Hidden Crossfire, and Hexa-Gone share hazards, positions, or the floor itself. Two browsers cannot agree on who got hit or who stepped on a tile first, so the server runs those. Hidden Crossfire also keeps each player's aim private until the reveal.

**Two games are not settled yet.** Mage Battle (quick-time events against a boss monster) and Wall Climbers (rules to be announced) are provisionally treated as self-timed. Mage Battle moves to the shared-world layer if players fight one boss together instead of each facing their own. Neither is implemented, and the catalogue marks both as provisional.

So the work splits into: a lobby and result collector that most games share and which is mostly not networking at all, and one real-time simulation layer for the three shared-world games.

## 3. Stack

**Server:** Node.js, TypeScript, Socket.IO. Nothing else required.

**Client:** TypeScript, Socket.IO client, a UI framework (React or Svelte), and Three.js for the 3D games. `performance.now()` for local timing. Web Audio for sound.

**Physics:** only the shared-world games need collision rules, and they need very little. Use simple shapes — circles, boxes, capsules on a grid — and write the collision code by hand rather than pulling in a physics engine. A mine grid and a moving harvester are each a few dozen lines. Hidden Crossfire adds shot-line intersections; Hexa-Gone adds which tile each player is standing on. A physics engine would be more work to configure than to replace, and it would have to run on the server too.

**JSON messages.** At 8 players and 15 snapshots a second, JSON is fine. Binary encoding is a real optimization but not one to do before there's a measured problem.

## 4. Project layout

```
server/          Socket.IO server, rooms, tick loop
client/          Browser app, menus, rendering
shared/
  protocol.ts    Message types
  games/         One folder per game: rules, state types, constants
```

Game rules that both sides need — the mine grid, the block-scene generator and counter, the typing validation — live in `shared/` and are imported by both. Keep them as plain functions with no I/O so they can be tested directly.

Three folders, not twelve packages. Split further only when something actually becomes awkward.

## 5. Rooms and connections

One player clicks "host a game". The server creates a room with a short code, and that player becomes the **room owner**. Owner is a permissions role — they pick the games and press start. They don't run anything.

Everyone connects to the server with one WebSocket and joins a Socket.IO room named after the room code. Broadcasts go to that room.

**Identity:** each player gets a `playerId` that survives reconnection. `socket.id` changes every reconnect, so never use it as a key for anything that outlives a connection. On reconnect the client sends its `playerId` back and reclaims its slot.

**Owner leaves:** ownership moves to whoever has been connected longest. The match keeps running. Nothing else changes.

**Player leaves:** hold their slot for about 30 seconds. If they come back, send them a full snapshot and let them resume. If they don't, the current game decides what happens to them (section 12).

**Joining late:** free during the lobby. Once a competition starts, latecomers watch.

Configure the client with `transports: ['websocket']` to skip the long-polling handshake.

## 6. Competition structure

The owner picks a mode:

- **Random** — the server picks 5 of the 10 games at random, no repeats, shuffled.
- **Custom** — the owner picks 1 to 10 games in whatever order.

**Each game decides how many scoring rounds it is played for.** Each scoring round has one winner and awards 1 point, so a game's round count is the most points it can hand out. Stop the Clock has 4 rounds (2 normal, then 2 faded); Crusher Escalator, Type Racer Roulette, Cube Counter and Log Dodge have 2. The owner does not set a round count. The total points in a competition is the sum of the chosen games' round counts.

The flow:

```
Lobby → for each game: [round 1 → results → … → round N → results] → final leaderboard → Lobby
```

Each round runs through the same short lifecycle:

```
Loading → ReadyCheck → Start → Playing → Results
```

Between rounds, the game resets everything of its own — eliminations, progress, and anything else it keeps. Competition points never reset until the leaderboard has been shown.

Several games have their own internal rounds or turns: Minefield's corridor sections, Stop the Clock's tiebreakers, Hidden Crossfire's aim/reveal cycles. Those are the game's business. From the outside, a scoring round hands back exactly one winner. If a game can end with nobody standing, it runs its own sudden-death to break it, and still returns one winner.

The server keeps the score table. Games report a winner and never touch the leaderboard themselves.

## 7. Messages

Every message carries:

- `type`
- `roomId`
- `roundId` — a counter that increments each scoring round

That's the whole envelope. `roundId` is there so a message from the previous round arriving late gets thrown away instead of confusing the current one. The server knows who sent a message from the socket, so nothing needs to say who it's from.

Message types, roughly:

| Group | Examples |
|---|---|
| Room | join, room state, player joined/left, owner changed, ready |
| Competition | mode chosen, playlist, game starting, scores, leaderboard |
| Round | round data, ready check, start at T, round over |
| Self-timed | progress, result |
| Shared-world | input, snapshot, event |

Use Socket.IO acknowledgements where the client wants a direct reply — submitting a result, playing a card. It saves inventing a correlation-ID scheme.

Add a protocol version to the connection handshake and reject mismatches with "please reload". Client and server ship separately, and with game logic in the browser a stale client is running different rules.

## 8. How each kind of game syncs

### 8.1 Self-timed games

The pattern, shared by most of the games:

1. Server sends the round data — the target time, the block-counting scenes, the beat sequence, the race text.
2. Every client says "loaded and ready".
3. Server picks a start time a second or two out and broadcasts it.
4. Each client starts its own timer at that moment and plays the whole round locally.
5. Client works out its own result and sends it.
6. Server collects results, waits for everyone or times out, compares, announces the winner.

Latency never touches the measurement. A player on bad wifi and a player on ethernet time the same interval with the same instrument. There's no clock correction, no compensation, no fairness setting to configure. This is the main reason four of the games need almost no netcode.

Two things to get right:

**The ready check matters.** If someone's assets are still loading when the start fires, their timer begins late and they get a bad result honestly. Don't schedule the start until everyone has acknowledged. Show players who the room is waiting on.

**Someone won't report.** They closed the tab, they disconnected, their timer never fired. Give the server a generous timeout after which it resolves the round without them.

Report times as integer milliseconds so ties are exact.

Clients also send a low-rate progress update (5 Hz or so) purely so opponents can see how everyone's doing. It has no effect on the outcome.

Build this once. Most games use it and only the "compare results" function differs.

### 8.2 Shared-world games

The server runs a fixed tick — 30/second is a reasonable start — for the shared-world games. Each tick it reads inputs, moves everything, checks collisions, and emits events. Snapshots go out at half the tick rate or so; they don't need to match it.

Clients send input at 20-30 Hz, coalesced. Hold one pending input and replace it rather than queueing; a stale movement vector isn't worth sending.

Clients render other players slightly behind, interpolating between the last two snapshots. Buffer roughly one snapshot interval plus measured jitter.

Clients predict their own movement so it feels immediate, and correct when the server's version arrives. Small differences get smoothed; eliminations and big corrections snap.

**Snapshots for what's true, events for what happened.** Position, velocity, phase, alive state go in snapshots. Exploded, eliminated, hit go out as events. Events must arrive; snapshots can be dropped once they're stale — emit those with Socket.IO's `volatile` flag so a congested socket skips them instead of piling them up.

Send full snapshots. Delta encoding is a real technique but it optimizes a bandwidth problem an 8-player room doesn't have.

## 9. Timing and deadlines

The server keeps a monotonic clock per room. Never use wall-clock time; an OS clock adjustment shouldn't change a match.

Clients ping the server every couple of seconds to estimate round-trip time and clock offset. **This is used only to convert a scheduled server time into a local one** — for countdowns, animations, and audio cues. It never adjusts a reported result.

Shared-world deadlines are evaluated on the server tick, since they depend on where everyone actually is. Send the deadline ahead of time so clients can animate toward it, and allow a small grace window so an input sent just before the visible cutoff still counts. That's a courtesy for normal lag.

## 10. Hidden information

Some state stays on the server, not because anyone would go looking, but because the games don't work if the answers are visible:

- Mine positions, until revealed or triggered
- Cube Counter's expected block counts (the scenes themselves must reach the client to be drawn; the answer key stays on the server until the round resolves)
- Hidden Crossfire aim directions and shot lines, visible only to their owner until the reveal
- Reported times, until everyone has reported

One habit keeps this from leaking by accident: when building a snapshot, list the fields you're sending rather than filtering a copy of the full state. Then a new field has to be added deliberately before anyone can see it.

Don't send a client a seed that generates hidden content — the seed reveals everything it produces. Send the generated public content instead.

## 11. What each game needs

Enough per game to know what's being built. Full rules go in each game's own notes.

### Minefield — shared
Run a corridor, harvester chasing, hidden mines. A detector scans but only while nearly still. Server holds mines, simulates the harvester, resolves mine hits and the finish line. Mines are circles in a grid; only check nearby cells. The harvester is a moving box, not machinery.

*Open:* is it a race, a survival, or last-alive? Do scans reveal exact positions or a direction?

### Cube Counter — self-timed
A block-counting memory game. Each puzzle flashes an isometric picture of a grid with blocks standing on it for a short moment (2 seconds), then hides it. The player types how many blocks they saw. The whole round is a series of puzzles that get harder.

**The gimmick is that a "block" is not always 1×1.** Early puzzles are easy: a few single cubes, some stacked. Later puzzles mix in larger blocks — footprints up to 3×3 (for example 2×1, 2×2, 3×2, 3×3) — drawn as one solid shape with no internal grid lines. A big block counts as **one**, so a player who counts grid squares or cube faces gets it wrong. Later puzzles also pack blocks closer together, and stack them higher.

**Scene model.** The grid is always **5×5**. A scene is a list of boxes: `{ x, y, z, width, depth }`, where `x, y` is the grid cell of the corner, `z` is the level (0–2), and:
- footprint `width × depth` is between 1×1 and 3×3, and the box stays inside the 5×5 grid;
- every box is exactly one level tall, so a big block is wider, never taller (a stack of three cubes and one tall block would look identical);
- stacking is at most **3 levels high** (`z` is 0, 1 or 2), so up to three cubes can sit on one cell, e.g. three 1×1 cubes stacked at (0,0);
- boxes can sit on top of other boxes, but every box must be fully supported (no floating boxes);
- no two boxes overlap.

The correct answer is the number of boxes in the list. The generator lives in `shared/` as a plain function and takes a difficulty level.

**Camera.** The camera is fixed at roughly 45° — looking down at the grid from a corner, with the grid rotated 45° so the player sees the top and two side faces of every box. This gives proper depth perception: stack height and which box is in front of which can be read at a glance. It is the same view for every player and every puzzle.

**Visibility rule.** Because the camera is fixed, the generator checks every scene with a visibility function before it is sent. Every multi-cell box (footprint larger than 1×1) must be clearly visible: its top face must be completely uncovered, and no taller box in front of it may hide more than a small fraction of its side faces. A big block can never be buried in a lower layer or tucked behind a tower, because that would make the right answer impossible to see. Single 1×1 cubes must have at least one face visible (top or side) so the count is always answerable. Scenes that fail are regenerated.

**Reading big blocks.** Adjacent boxes of the same colour are avoided at higher levels, or drawn with a visible outline, so "one big block" and "two touching blocks" can be told apart.

**Difficulty ramp (per puzzle index in the round).** Box count, share of multi-cell boxes (up to 3×3), stacking height (up to 3 levels) and crowding go up; the grid stays 5×5. The flash time is a constant 2 s at every level, so difficulty comes only from the scene. Tune these numbers by playtesting. The ramp is data in `shared/games/`, not logic in the client.

**Self-timed flow.** The server generates all puzzles for the round and sends the scenes in the round data. The server keeps the expected counts. Each client shows each scene on its local timer for its flash duration, hides it, accepts a typed number, and records the answer time with `performance.now()`. The flash duration is measured locally so latency never shortens or lengthens what a player sees. Clients submit their answers and per-puzzle times at the end, plus low-rate progress (which puzzle they're on) for opponents to see.

Scenes are public by necessity — the browser has to draw them — so the hidden part is the answer key. The server doesn't reveal expected counts until the round resolves, and results are revealed together once everyone has reported (or the timeout fires).

**Scoring a round.** The winner is whoever gets the correct answers in the quickest time. The server compares answers to the key: most correct answers wins, and ties break on the lowest total time spent on the correct answers (time on a wrong answer never counts, so answering fast and wrong can't help). Times are integer milliseconds, so ties are exact; a tie that survives that goes to the runner's tiebreaker. From the outside it still returns exactly one winner.

**Rendering.** A 2D drawing from the fixed ~45° camera (isometric-style projection) on canvas or SVG; no Three.js needed for this game. Draw boxes back to front so occlusion is correct. Use a plain palette and flat shading (top, left, right faces) so the picture is clear at a glance and a big block reads as one object.

**Two rounds, eight puzzles each.** Cube Counter is two scoring rounds, each made of 8 consecutive internal puzzles with fresh scenes, and the winner of each round gets 1 point. The difficulty starts over every round. The first few puzzles climb steadily as a warm-up. From there the box counts stop climbing: each hard puzzle gets a random count from 9 to 14, so it can have fewer boxes than the one before it, or by chance the same number. Hard scenes are built in a random style (layered with big blocks, a sprawl of single cubes, or mixed), so a count can't be guessed from how big the scene looks.

*Open:* number of puzzles per round; whether the ramp is fixed or one wrong answer ends your run (last-alive style); whether scenes include distractors such as floor markings or differently coloured blocks; and whether puzzle pacing is shared (everyone sees puzzle N at the same moment) or each player advances at their own speed.

### Crusher Escalator — self-timed
A race up an escalator, driven by key presses. Each player sees their own stream of arrows (up, down, left, right) and presses the one that is showing. A correct press scores **1 point**, a wrong press scores 0, and the arrow changes on **every** press either way, so a wrong guess costs you the symbol as well as the point. Everyone starts on 0.

**The crusher.** When the leader (the player with the highest score) is **8 points** ahead of a player, that player is crushed and out. The gap is all that matters: you can be on 40 points and safe if the leader is on 45. The last player left wins. The client can draw the crusher closing in as the gap grows toward 8.

**Streams.** Each player gets about 30 arrows, generated by the server and different for every player. The stream loops when it runs out. A direction is never the same as the one before it, including at the loop point (the last arrow differs from the first), so a player can never answer by tapping one key twice.

**How it stays self-timed.** The browser runs its own race on its local clock and records every press with the time since the race started. When it is done it sends the whole list of presses. The server then **replays all players' presses together in time order**, judges each press against that player's stream, applies the 8-point rule and works out who was crushed and when. Because the server uses the clients' own timestamps rather than arrival times, 300 ms of latency cannot change the outcome, and a client cannot simply claim a score. Presses that happen at the same instant are all counted before anyone is crushed, so processing order never decides a result.

For live feedback, clients send their current score as low-rate progress (display only). Each client uses everyone's scores to draw the gap and to know when it has been crushed or has won, and then reports. The server's replay is the authority.

**Ending and ranking.** The race ends when one player is left, or at a time cap (90 s). Ranking is: survivors first, then whoever lasted longest before being crushed; equal survival time is broken by score. If several players are still level on the lead at the time cap they share first place and the runner plays a tiebreaker among them. A player who never reports has no presses, so they are crushed as soon as the leader is 8 ahead.

**Heats and the final.** With 6 players or fewer, everyone races in one group. With more than 6, the round has two stages:
1. **Heats.** The players are split at random into two groups as evenly as possible (7 become 4 + 3, 8 become 4 + 4, 12 become 6 + 6). Both heats run at the same time, and the 8-point rule only compares players within their own heat, so a leader in one heat cannot crush a player in the other. The heats end as soon as 6 players remain in total.
2. **Final.** The round pauses for 3 seconds, then the 6 remaining players race together in one group and **start again from 0**, with fresh streams. Last one standing wins the round. Anyone who was crushed in the heats watches.

If several players are crushed at the same instant and that would leave fewer than 6, the best-scoring of them go through to fill the final, and anyone level with the last qualifier goes through too, so a tie never knocks someone out by luck of ordering. The two stages are two attempts of one scoring round: the runner asks the game whether another stage follows (`nextStage`) before it considers a tie, the heats open with a longer intro (the usual countdown plus 4 s for the animation that sorts players into heats), and the final uses a shorter run-up (2 s lead, 3 s countdown) because the finalists are already watching. A tie in the final is settled by the usual tiebreaker.

**Ending animation.** When the race is decided (one player left), the server gives clients **4 seconds** to play the ending animations before the results screen's normal display time and the next round. This is a per-game setting (`finishAnimationMs`) carried to clients in the results message, and the owner can't skip the results screen until it has finished.

**Scoring rounds.** Two scoring rounds per game; each race has one winner and awards 1 point. Every round gets fresh streams for the players.

*Open:* whether the time cap should be shorter; whether a wrong press should cost more than a missed point; and whether the crusher should also creep forward on its own if the whole room stalls.

### Stop the Clock — self-timed
Hit a target between 2.00 and 8.00 seconds. Server sends the target and a start time; each client times itself and reports. Results stay hidden until everyone's in, then reveal together. Exact ties go to a tiebreaker among just those players.

It is played for **4 scoring rounds**: rounds 1–2 are normal, and in rounds 3–4 the clock fades out mid-round so players have to feel the interval.

The simplest game in the set, and the right one to build first.

### Type Racer Roulette — self-timed, with one round trip
A typing race with a deadly twist. A round is **4 or 5 paragraphs** (1 or 2 easy warm-up paragraphs, then 3 hard ones), the same for every player, and each paragraph is a few lines. The first player to finish every paragraph wins, and if everyone else is knocked out first, the last survivor wins.

**Mistakes.** A wrong key is a mistake at once: the player goes back to the **start of that line** and the paragraph gains **1 strike**. Matching is exact (case, punctuation and spaces count), backspace doesn't repair a mistake, and pasting isn't accepted. Text is plain ASCII, so there is no Unicode normalisation to argue about. These rules live in `shared/` so client and server agree by construction.

**The texts.** A race eases players in and then gets hard: **1 or 2 easy paragraphs first, then 3 hard ones**, so 4 or 5 paragraphs in all, the same for every player.
- **Easy pool (5 paragraphs):** short, simple words about everyday things (a dog in the park, a rainy day, a cat, the beach, a Saturday market) with almost no punctuation, only the odd comma and full stop. A race takes 1 or 2 of them at random, in random order.
- **Hard pool (20 paragraphs in six categories):** field notes (numbers, colons, dashes, coordinates), alphabets (A - apple, B - banana, ...), word salad with broken grammar, long words with spelling mistakes left in on purpose, text with no spaces at all, and everyday oddities (dialogue, a recipe, a captain's log). Between them they use every punctuation mark , . ! ? : - and the apostrophe. A race picks 3 different categories at random, in random order (a proper shuffle, so any category can come first or last), and then one random paragraph from each, so the hard part is always a mix and never three of the same kind.

**The dice.** On the **third strike in a paragraph** a six-sided die is cast, with hearts on every side except one skull. Land on the skull and the player is out. Survive, and the player drops back to **two strikes**, so one more mistake casts the die again, and **each time the die is cast and survived it gains another skull side**: 5 hearts and 1 skull, then 4 and 2, then 3 and 3, then 2 and 4, then 1 and 5, up to a die of all skulls (the cap is 6, like a regular die). The sixth roll is therefore certain death, so a player can survive at most five rolls. Finishing a paragraph resets the strikes to 0, but the skull count is **not** reset; it carries on for the rest of the race.

**Last survivor.** The first player to finish wins, but a race can also end without a finisher: when every player except one has been knocked out (by a skull or by running out of time), **the last survivor wins**, even if they are only a few lines in. The race is over from the moment the last other player falls, so nothing the survivor does afterwards counts against them. If the last two fall at the same instant, or everyone falls, there is no survivor and the furthest player is best, as below. Clients show the others as out in the shared bar (the progress `status`), and once a player sees that everyone else is out they stop and report.

**Pause between paragraphs.** After each paragraph (but not after the last) there is a **7-second pause** for a brief break and animations. Typing is closed during it, and it counts toward every player's finish time equally, so it never changes who finishes first. Skipping the pause isn't possible: a press made during it is ignored by the server's replay.

**Time limit.** Every paragraph has a **3-minute counter**. It starts when typing on that paragraph opens (for the first, when the race starts; for the others, when the 7-second pause ends). A player who hasn't finished the paragraph by then is out.

**How it stays self-timed.** The browser validates typing locally so every key press is instant, and reports what happened with timestamps: each mistake and each finished line. The server **replays** that list against the rules, applying strikes, rolling the dice and checking the 3-minute limit, so a client cannot simply claim a result. Players never affect each other, so each player is replayed on their own.

**The shared progress bar.** One bar shows every player. It has **one section per paragraph, with a checkpoint at the end of each**. Every character in the race takes the same width, so the sections are **uneven**: a short paragraph gets a short section and its checkpoint appears earlier on the bar. Within a section the paragraph's characters are the whole 100%, and every character a player has typed correctly is one equal part of it. A mistake sends the player back to the start of their line, so their marker steps back by that line's characters. Clients report their progress at low rate: the number of correct characters typed in the whole race, the paragraph they are in, their strikes and skull count, and whether they are typing, finished or out. The server checks it stays inside the race and broadcasts it. It also remembers each player's latest progress, so a client that reconnects mid-race is sent everyone's position at once instead of waiting for the next update. The functions that turn characters into a bar position live in `shared/`, so the bar and the final result agree: the server counts the characters in a player's finished lines when it replays the race, and that is also how it orders players who did not finish.

**The one round trip.** The outcome of a die must stay a surprise, so at the third strike the client pauses and asks the server (`round:action`, `{ type: 'roll', rollIndex }`). The server replies with the face and how many sides were skulls. Each roll is derived from a server-only secret, the round's public nonce, the player and the roll number, so the server can answer mid-race and later replay the same dice without storing anything per player. The pause makes the round trip feel deliberate rather than laggy. There is no anti-cheat: a client could ask about a future roll, which the plan accepts for a friendly office game.

**Ranking.** Players who finish are ranked by finish time; then everyone else by how many characters they got through, and for the same distance, by who lasted longer. So if nobody finishes, the player who got furthest is best. Finishing at the same millisecond is a tie, and goes to the usual tiebreaker. A player who closes the tab simply stops reporting.

**Celebration.** When a race is decided, the server gives clients **5 seconds** for a quick celebration animation (the winner, whether by finishing or as last survivor) before the results screen's normal display time and the next round. It is the same per-game `finishAnimationMs` setting Crusher Escalator uses, and the owner can't skip the results screen until it has finished.

**Rounds.** Two scoring rounds per game, each with a fresh set of paragraphs, so a game awards at most 2 points. Each paragraph's limit is a ceiling, not a target: a typical paragraph takes well under it.

*Open:* how long the paragraphs should be, whether the time limit should be shorter, and whether a first finisher should end the race for everyone else immediately or let the others play on for ranking.

### Mage Battle — quick-time events against a boss monster (provisional)
Players face a boss monster by hitting quick-time events: a prompt appears, and the player must respond in time to land an attack or avoid one. Most likely self-timed: the boss's prompt sequence is a fixed, public schedule, each browser plays it locally and reports its responses with times, and the server judges them, the same way Log Dodge and Crusher Escalator work.

*Open:* is it one boss per player or one shared boss, what a prompt looks like, how a response is scored, what damages a player or the boss, and how the winner is decided (last standing, most damage, or fastest kill). A shared boss would make it a shared-world game.

### Hidden Crossfire — shared
Each player can move around the map and aim during a short window of a few seconds. They see their own line of fire, but nobody else's. When the timer stops, movement and aim lock, all shot lines are revealed, and shots resolve. The map gets smaller after each internal round. Last survivor wins.

The server owns positions, private aim, the phase deadline, map bounds, and eliminations. Send aim feedback only to its owner before the reveal; do not leak it through public snapshots or facing animations. Resolve all shots from the same frozen state so processing order cannot decide who survives.

*Open:* exact aim/reveal timings, shot width and range, map-shrink rules, what happens to players outside the new bounds, and sudden-death rules if everyone is eliminated together.

### Log Dodge — self-timed
Everyone runs in place on a treadmill while the same lineup of logs (low or high) comes at them. There is no physics: each log has an arrival time and a visual approach angle. The player must press the matching action (jump for low, duck for high) within ±0.5 s of the arrival, or the log is a hit. Three hits knock a player out. Logs take 2 to 4 s to reach the player depending on their speed and arrive closer together (never under 0.3 s apart) as the round ramps up, reaching full difficulty at about 40 s and staying there, with wider angles too. Anyone still standing after 60 s has survived. If only one player is left before then, the logs stop at that moment, that player wins, and clients play a 5 s win animation.

It runs as a self-timed game like Crusher Escalator: every browser plays the shared, public schedule locally and reports each press with a time, and the server replays the presses against the schedule (`shared/games/logDodge/judge.ts`). Latency cannot change who got hit, and no shared-world simulation is needed. A press within 300 ms of the previous one is ignored, so mashing every button does not work.

A scoring round still returns exactly one winner: survivors are ordered by fewest hits, then by average timing error, and anyone still level goes to the runner's tiebreaker, which plays a fresh schedule among just those players.

### Hexa-Gone — shared
Players stand on a floor of hexagonal tiles. A tile vanishes after a player steps on it, and a player with no floor under them is out. Last survivor wins.

The server owns the tile grid, player positions, and which tiles are gone, since two browsers cannot agree on who stepped where first. Clients send movement input and animate the tiles disappearing from server events.

*Open:* how long a tile lasts after being stepped on, grid size and shape, movement speed, whether players can collide or push, and what happens if the last players fall in the same tick.

### Wall Climbers — TBA
The rules have not been decided. It is listed so the catalogue is complete, and is treated as self-timed until its design says otherwise.

## 12. When things go wrong

**Player disconnects.** Hold the slot ~30s. Shared games: their character goes inert, then they're out. Self-timed games: the round finishes without their result.

**Owner disconnects.** Transfer ownership. Match continues.

**Client desyncs** — a missing entity, a phase that makes no sense, prediction going wild. It asks for a full snapshot and applies it. Rate-limit these requests so a stuck client doesn't hammer the tick loop.

**Server restarts.** The room is gone. Clients get "room not found" instead of a reconnect loop. Don't try to survive a restart; for an office game, starting over is fine.

**Deploying mid-game.** Simplest workable answer: deploy when nobody's playing. If that gets annoying, stop accepting new rooms on the old instance and let existing matches finish before shutting it down.

## 13. Message handling

Everyone's friendly, so this is bookkeeping, not enforcement. The server should:

- Ignore messages tagged with an old `roundId`
- Ignore messages from a socket that's been superseded by a reconnect
- Keep the first result report per player per round, ignore repeats
- Ignore actions that don't apply in the current phase, with a small grace window around deadlines
- Log and ignore anything malformed instead of throwing
- Resolve a round when its timeout expires, however many results arrived

Clients ignore unknown message types, drop snapshots older than what they're already showing, and deduplicate events by ID.

One bit of self-protection is worth having: bound message sizes and entity counts. Several rooms share one Node process, so a runaway loop in one browser shouldn't take down a match happening next to it.

## 14. Testing

**Game rules as plain functions.** Everything in `shared/games/` should be testable by calling it — no sockets, no rendering, no clock. Block-scene generation (no overlaps, nothing fully hidden, count matches the box list), answer scoring and tiebreaks, mine collisions, typing validation, scoring. This is where most of the value is.

**New game rules.** Check that Hidden Crossfire never exposes another player's aim before the reveal and resolves shots from one frozen state, that Log Dodge judges jump/duck windows consistently, and that Hexa-Gone removes each tile exactly once and resolves simultaneous falls the same way regardless of message order.

**The self-timed round runner.** Most games depend on it, so test: everyone reports; someone doesn't; nobody does; duplicate reports; exact ties; a late ready check pushing the start back; a result arriving after the round closed.

**The competition layer**, with fake games standing in: random picks 5 unique, custom keeps order, per-game round counts (Stop the Clock 4, Crusher Escalator 2, Type Racer Roulette 2, Cube Counter 2, Log Dodge 2), one point per round, scores survive game changes and reconnects, leaderboard sorts and handles ties, a new competition clears the old one.

**Latency.** The one test worth writing specifically: a client with 300 ms added latency should get an identical result to one with none in every self-timed game. If latency changes a Stop the Clock outcome, timing has leaked into the network layer.

**Reconnection.** Drop a client mid-round in each game type and confirm it comes back correctly or is handled cleanly.

**Browsers.** Two things matter more than the rest because timing is local: background tabs get their timers throttled, which corrupts a measurement — detect it and say so rather than reporting garbage. And `performance.now()` resolution is reduced in some browsers; confirm it's good enough for Crusher Escalator's press timestamps, which are replayed in order on the server and are the tightest timing in the set.

## 15. UI the network model requires

- Show connecting, reconnecting, and disconnected states.
- Show a clear message for a bad room code or a full room.
- Show who the owner is, and say so when it changes.
- Show which game you're on, out of how many, and which round of that game it is (e.g. round 3 of 4).
- Make the ready check visible — show who the room is waiting for. It's what makes the shared start fair, so it shouldn't be a hidden handshake.
- Don't let anyone interact before their snapshot has applied.
- Self-timed rounds run entirely on the local clock, so nothing should stutter or wait on the network mid-round.
- In shared games, never show a local win before the server confirms it. Smooth small corrections; snap eliminations.
- Hidden Crossfire shows only your own aim until the reveal, with a clear freeze/reveal cue and visible shrinking bounds.
- After each round: winner, point awarded, standings. After a game's last round: a game summary. At the end: the full leaderboard.
- If a tab is backgrounded during a timed round, tell the player their timing may be off rather than silently reporting it.
- Prompt for a reload on a protocol mismatch.

## 16. Build order

**1. Lobby and competition shell.** Rooms, join by code, owner and transfer, playlist in both modes, the multi-round runner, score table, leaderboard. Test it with placeholder games that return a random winner. This is the spine and it's worth having solid before any real game exists.

**2. Stop the Clock.** The whole self-timed pattern — ready check, scheduled start, local timing, result collection, tiebreakers — with essentially no rendering. Smallest possible first real game, and it proves the machinery most games will reuse.

**3. Cube Counter, then Type Racer Roulette.** Both reuse the self-timed runner directly. Cube Counter adds a 2D isometric block renderer and the scene generator; Type Racer adds the one server round trip and the shared text rules.

**4. Mage Battle and Wall Climbers.** Settle the rules first. If Mage Battle stays one boss per player it reuses the self-timed runner directly; Wall Climbers waits on a design.

**5. Movement layer.** The first real netcode: tick loop, input, snapshots, interpolation, prediction. Test this under packet loss, not just latency.

**6. Minefield, Hexa-Gone, then Hidden Crossfire.** Reuse the shared-world layer. Hexa-Gone adds a shared tile grid that changes as players move; Hidden Crossfire adds private aim, freeze/reveal phases, and shrinking bounds.

**7. Crusher Escalator.** The client runs its own race, so the work is press handling, the crusher display and the server-side replay, not live networking. Could move earlier if someone wants to build it.

**8. Cleanup.** Cross-browser checks, packet loss, accessibility, disconnect UX.

## 17. Decisions to make before building

- Max players, and whether spectators are supported at all in v1.
- Room code format and how long a room lives when empty.
- How long a disconnected player keeps their slot.
- How far ahead to schedule a start (a second or two, tuned from real latency).
- Result timeout per self-timed game.
- What happens if a tab is backgrounded mid-round: void the round for that player, accept the result, or offer a replay.
- Whether the owner always plays.
- Tied final scores: leave tied, or add an overall tiebreaker.
- How long result screens show and whether the owner can skip.
- Movement controls, and whether mobile is supported at all.
- The per-game open questions in section 11.

## 18. First release

Ship this:

- 2-8 players, one server, no database.
- Room codes, owner with automatic transfer.
- Both playlist modes, per-game round counts (Stop the Clock 4, Crusher Escalator 2, Type Racer Roulette 2, Cube Counter 2, Log Dodge 2), one point per round, leaderboard at the end.
- Three games: **Stop the Clock, Cube Counter, Log Dodge.**

Those three cover the self-timed runner, server-held answers, and replay-judged timing. The remaining seven add game logic; Minefield, Hidden Crossfire, and Hexa-Gone also need the shared-world simulation layer.

Explicitly not in v1: multiple server instances, Redis, a database, surviving a restart, accounts, matchmaking, delta compression, binary encoding, spectators if they turn out to be fiddly.

## 19. A game is done when

- It's clear whether it's self-timed or shared-world, and it's built that way.
- It resets between its own rounds, if it has more than one.
- It returns exactly one winner and never touches the score table itself.
- Self-timed: it doesn't start until everyone's ready, and it resolves when someone never reports.
- Shared: deadlines are server-side and nothing is shown as final before the server says so.
- Reconnect and disconnect behaviour is defined and not embarrassing.
- Adding 300 ms of latency doesn't change who wins.
- It doesn't leak hidden state through snapshots or spectator views.
- It handles a backgrounded tab sensibly.
- Its rules have tests.

## 20. Summary

Everyone connects to one Socket.IO server. Whoever clicks "host a game" gets a room code and lobby controls; if they leave, someone else gets them and the match carries on.

Most games run in the browser. The server hands out the round, waits for everyone to be ready, says go, and collects results. Latency never touches a measurement, which means no clock correction anywhere in the platform and very little networking in most of the catalogue.

The three shared-world games run on the server, because players share hazards, positions, or elimination timing and need one authoritative outcome. Those use a tick loop, snapshots with interpolation, and local prediction where movement is allowed.

Shared code is: the lobby, the competition runner, the self-timed round runner, one shared-world layer, and the per-game rules. Everything else is specific to a game.

Build the lobby first with fake games, then Stop the Clock, then work outward. By the fourth game most of what a new game needs already exists.
