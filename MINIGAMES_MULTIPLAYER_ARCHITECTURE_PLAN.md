# Multiplayer Minigames — Architecture and Implementation Plan

## 1. What this is

A plan for eleven browser-based minigames played by a small office group, running on a Node.js server with Socket.IO.

The scale this is built for: up to 8 players in a room, a handful of rooms at once, everyone friendly. That scale rules out most of what a "real" multiplayer platform would need. There is no matchmaking, no accounts, no database, no scaling tier, no anti-cheat. Adding those later is possible; building them now would be most of the work for none of the fun.

The goal is one shared foundation the games sit on, so that adding the eleventh game is much less work than the first.

Games without supplied titles use working names:

| # | Working title |
|---|---|
| 1 | Minefield |
| 2 | Chisel Gauntlet |
| 3 | Crusher Escalator |
| 4 | Blade Arena |
| 5 | Stop the Clock |
| 6 | Type Racer Roulette |
| 7 | Liar's Deck |
| 8 | Hidden Crossfire |
| 9 | Infinite Tic-Tac-Toe |
| 10 | Log Dodge |
| 11 | Word Bomb |

## 2. The core idea: three kinds of game

This is the decision everything else follows from.

**Four games are played alone, together.** Stop the Clock, Chisel Gauntlet, Crusher Escalator, and Type Racer Roulette all have each player doing their own thing in their own space. Nothing you do affects my cube, my lane, or my timer. For these, **the browser runs the whole game and reports the result.** The server hands out the round data, waits for everyone to be ready, says go, and collects what comes back.

**Four games use a shared world.** Blade Arena, Minefield, Hidden Crossfire, and Log Dodge share hazards, positions, or elimination timing. Two browsers cannot agree on who got hit, so the server runs those. Hidden Crossfire also keeps each player's aim private until the reveal; Log Dodge uses a fixed lineup rather than free movement.

**Three games are turn-based.** Liar's Deck, Infinite Tic-Tac-Toe, and Word Bomb use server-owned turns and validated actions rather than continuous movement. The server holds private cards, maintains the board and placement order, or manages word deadlines and power-ups, depending on the game.

So the work splits into: a lobby and result collector that four games share and which is mostly not networking at all, one real-time simulation layer for four shared-world games, and turn-based action handling for three games.

## 3. Stack

**Server:** Node.js, TypeScript, Socket.IO. Nothing else required.

**Client:** TypeScript, Socket.IO client, a UI framework (React or Svelte), and Three.js for the 3D games. `performance.now()` for local timing. Web Audio for sound.

**Physics:** only the four shared-world games need collision rules, and they need very little. Use simple shapes — circles, boxes, capsules on a grid — and write the collision code by hand rather than pulling in a physics engine. A mine grid, a blade bouncing off walls, and a moving harvester are each a few dozen lines. Hidden Crossfire adds shot-line intersections; Log Dodge adds jump/duck collision windows. A physics engine would be more work to configure than to replace, and it would have to run on the server too.

**JSON messages.** At 8 players and 15 snapshots a second, JSON is fine. Binary encoding is a real optimization but not one to do before there's a measured problem.

## 4. Project layout

```
server/          Socket.IO server, rooms, tick loop
client/          Browser app, menus, rendering
shared/
  protocol.ts    Message types
  games/         One folder per game: rules, state types, constants
```

Game rules that both sides need — the mine grid, the voxel target check, the typing validation — live in `shared/` and are imported by both. Keep them as plain functions with no I/O so they can be tested directly.

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

- **Random** — the server picks 5 of the 11 games at random, no repeats, shuffled.
- **Custom** — the owner picks 1 to 11 games in whatever order.

Each selected game is played **twice**. Each play is a scoring round and the winner gets 1 point. Random mode therefore hands out 10 points total; custom mode hands out twice the number of games chosen.

The flow:

```
Lobby → for each game: [round 1 → results → round 2 → results] → final leaderboard → Lobby
```

Each round runs through the same short lifecycle:

```
Loading → ReadyCheck → Start → Playing → Results
```

Between rounds, the game resets everything of its own — eliminations, hands, progress, and in-game currencies. Competition points never reset until the leaderboard has been shown. Word Bomb's spendable word points are local to that game, not the competition score.

Several games have their own internal rounds or turns: Minefield's corridor sections, Stop the Clock's tiebreakers, Hidden Crossfire's aim/reveal cycles, and the turn-based games' moves. Those are the game's business. From the outside, a scoring round hands back exactly one winner. If a game can end with nobody standing, it runs its own sudden-death to break it, and still returns one winner.

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
| Turn-based | your hand, play, challenge, place mark, submit word, activate power-up, game state |

Use Socket.IO acknowledgements where the client wants a direct reply — submitting a result, playing a card. It saves inventing a correlation-ID scheme.

Add a protocol version to the connection handshake and reject mismatches with "please reload". Client and server ship separately, and with game logic in the browser a stale client is running different rules.

## 8. How each kind of game syncs

### 8.1 Self-timed games

The pattern, shared by four games:

1. Server sends the round data — the target time, the carved shape, the beat sequence, the race text.
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

Build this once. Four games use it and only the "compare results" function differs.

### 8.2 Shared-world games

The server runs a fixed tick — 30/second is a reasonable start — for the four shared-world games. Each tick it reads inputs, moves everything, checks collisions, and emits events. Snapshots go out at half the tick rate or so; they don't need to match it.

Clients send input at 20-30 Hz, coalesced. Hold one pending input and replace it rather than queueing; a stale movement vector isn't worth sending.

Clients render other players slightly behind, interpolating between the last two snapshots. Buffer roughly one snapshot interval plus measured jitter.

Clients predict their own movement so it feels immediate, and correct when the server's version arrives. Small differences get smoothed; eliminations and big corrections snap.

**Snapshots for what's true, events for what happened.** Position, velocity, phase, alive state go in snapshots. Exploded, eliminated, hit go out as events. Events must arrive; snapshots can be dropped once they're stale — emit those with Socket.IO's `volatile` flag so a congested socket skips them instead of piling them up.

Send full snapshots. Delta encoding is a real technique but it optimizes a bandwidth problem an 8-player room doesn't have.

### 8.3 Turn-based games

Liar's Deck, Infinite Tic-Tac-Toe, and Word Bomb send actions and broadcast the resulting game state. No continuous tick loop is needed; use scheduled deadlines for timed turns and send full state for reconnects.

The server validates who may perform each action, including Word Bomb power-ups activated by waiting players. It owns turn order, board changes, word validation, deadlines, point balances, and power-up effects.

For Liar's Deck, the server holds the deck and every hand. Each player's socket gets only their own cards. Infinite Tic-Tac-Toe's board and placement order are public; Word Bomb publishes the active turn, letter combination, deadline, and resolved effects.

## 9. Timing and deadlines

The server keeps a monotonic clock per room. Never use wall-clock time; an OS clock adjustment shouldn't change a match.

Clients ping the server every couple of seconds to estimate round-trip time and clock offset. **This is used only to convert a scheduled server time into a local one** — for countdowns, animations, and audio cues. It never adjusts a reported result.

Shared-world deadlines are evaluated on the server tick, since they depend on where everyone actually is. Send the deadline ahead of time so clients can animate toward it, and allow a small grace window so an input sent just before the visible cutoff still counts. That's a courtesy for normal lag.

Turn-based deadlines are server-owned too. Word Bomb's extra-time power-up changes the player's next-turn deadline on the server, and the updated deadline is sent to everyone.

## 10. Hidden information

Some state stays on the server, not because anyone would go looking, but because the games don't work if the answers are visible:

- Mine positions, until revealed or triggered
- The Chisel target, once memorization ends
- Liar's Deck hands and deck order
- Hidden Crossfire aim directions and shot lines, visible only to their owner until the reveal
- Reported times, until everyone has reported

One habit keeps this from leaking by accident: when building a snapshot, list the fields you're sending rather than filtering a copy of the full state. Then a new field has to be added deliberately before anyone can see it.

Don't send a client a seed that generates hidden content — the seed reveals everything it produces. Send the generated public content instead.

## 11. What each game needs

Enough per game to know what's being built. Full rules go in each game's own notes.

### Minefield — shared
Run a corridor, harvester chasing, hidden mines. A detector scans but only while nearly still. Server holds mines, simulates the harvester, resolves mine hits and the finish line. Mines are circles in a grid; only check nearby cells. The harvester is a moving box, not machinery.

*Open:* is it a race, a survival, or last-alive? Do scans reveal exact positions or a direction?

### Chisel Gauntlet — self-timed
Memorize a carved 3×3×3 shape, then reproduce it by removing voxels before time runs out. A 27-bit integer holds the whole cube and comparison is one equality check. The client carves locally so clicks are instant, then submits its mask and elapsed time. Send the target during memorization and stop sending it after.

Send periodic mask updates so a disconnect mid-carve is recoverable.

*Open:* does a wrong carve kill you immediately or only fail at submission?

### Crusher Escalator — self-timed
Hit a directional sequence on rhythm to climb away from a crusher. Own lane, own crusher, nobody interferes — so the client runs the entire ride: judging inputs, applying momentum, advancing the crusher, deciding its own fate. Sends progress for display and a final outcome.

Because judging is local, the beat the player hears is exactly the beat that scores. That removes the hardest problem this game would otherwise have.

*Open:* first to the top, last alive, or survive a duration?

### Blade Arena — shared
Blades spawn from three holes and ricochet. Dodge. Server simulates blade motion and hits. Use swept collision so fast blades don't tunnel through players. Cap the blade count.

This is the heaviest game in the set for both bandwidth and server CPU — build it last and measure it. Don't try to derive blade paths on the client from the seed; they'll drift apart.

### Stop the Clock — self-timed
Hit a target between 2.00 and 8.00 seconds. Server sends the target and a start time; each client times itself and reports. Results stay hidden until everyone's in, then reveal together. Exact ties go to a tiebreaker among just those players.

The simplest game in the set, and the right one to build first.

### Type Racer Roulette — self-timed, with one round trip
Race through a text. Three mistakes triggers an elimination roll; survive and the odds get worse. The client validates typing locally so every keystroke is instant, and reports progress at a low rate. When it hits the third mistake it pauses and asks the server, which rolls and replies — keeping the outcome a genuine surprise. The pause makes that round trip feel deliberate rather than laggy.

*Open:* case sensitivity, punctuation, unicode normalization, whether backspace repairs errors, whether paste counts. Put these rules in `shared/` so client and server agree by construction.

### Liar's Deck — shared, turn-based
Private hands, a declared rank, face-down plays, challenges. Server shuffles, deals to individual sockets, validates turns, reveals on challenge, applies penalties. Broadcast the public table after every action.

Accept a challenge that arrives just after the deadline if it was sent before the client's displayed cutoff.

*Open:* deck composition, cards per play, penalty odds, when the deck resets.

### Hidden Crossfire — shared
Each player can move around the map and aim during a short window of a few seconds. They see their own line of fire, but nobody else's. When the timer stops, movement and aim lock, all shot lines are revealed, and shots resolve. The map gets smaller after each internal round. Last survivor wins.

The server owns positions, private aim, the phase deadline, map bounds, and eliminations. Send aim feedback only to its owner before the reveal; do not leak it through public snapshots or facing animations. Resolve all shots from the same frozen state so processing order cannot decide who survives.

*Open:* exact aim/reveal timings, shot width and range, map-shrink rules, what happens to players outside the new bounds, and sudden-death rules if everyone is eliminated together.

### Infinite Tic-Tac-Toe — turn-based
Play tic-tac-toe with no more than three X marks and three O marks on the board. When a player places a fourth mark, their oldest mark disappears; every subsequent placement does the same. Three in a row wins, evaluated on the board after the oldest mark is removed.

The server keeps a placement-order queue for each symbol, validates the active player's move, removes the oldest mark when necessary, and broadcasts the resulting board. Reconnect state includes placement order so players can see which mark will disappear next.

*Open:* how a room with more than two players is organized into matches and produces one scoring-round winner, whether a player can place directly on their own expiring square, and how repeated positions or indefinitely long games are handled.

### Log Dodge — shared
All players stand in a line while logs come toward them. Each incoming log demands a quick choice: jump or duck. Players hit by a log are eliminated; last survivor wins.

The server owns the common obstacle timing, jump/duck action windows, collisions, and eliminations. Clients animate the approach and their own response immediately. Jump and duck are discrete actions, not movement vectors to discard through input coalescing.

*Open:* log patterns and warning time, action duration and cooldowns, whether ducking is held or tapped, difficulty progression, and simultaneous-last-elimination tiebreaks.

### Word Bomb — turn-based, with power-ups
Players take timed turns submitting a word that matches the required letter combination. Each correct word earns in-game points. While waiting for their turn, players can spend those points to activate power-ups:

- **Reverse direction:** change the direction of play.
- **Four-letter target:** force a chosen player to use a four-letter combination.
- **One-bullet revolver:** equip a revolver containing one bullet for your next turn and choose which opponent to aim at.
- **Extra time:** add time to your next turn.

The server validates words, awards and spends points, manages turn order and targeted combinations, applies next-turn effects, and resolves revolver actions. Purchases must not overspend the balance, and any extra time must update the authoritative deadline. These spendable points are separate from the competition's one-point round award.

*Open:* dictionary and letter-matching rules, repeated words, points earned and power-up costs, activation timing and stacking, revolver firing rules/chance model/hit consequences, lives, and the round's end condition and winner.

## 12. When things go wrong

**Player disconnects.** Hold the slot ~30s. Shared games: their character goes inert, then they're out. Self-timed games: the round finishes without their result. Liar's Deck: pause briefly, then auto-pass. Other turn-based games need an explicit timeout or forfeit rule; never invent a board move or word for a disconnected player.

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

**Game rules as plain functions.** Everything in `shared/games/` should be testable by calling it — no sockets, no rendering, no clock. Voxel comparison, mine collisions, typing validation, blade bounces, scoring. This is where most of the value is.

**New game rules.** Check that Hidden Crossfire never exposes another player's aim before the reveal and resolves shots from one frozen state; Infinite Tic-Tac-Toe removes each symbol's oldest mark before checking a win; Log Dodge judges jump/duck windows consistently; and Word Bomb handles valid words, point spending, reversed turns, targeted four-letter combinations, next-turn revolvers, and extra time without double activation.

**The self-timed round runner.** Four games depend on it, so test: everyone reports; someone doesn't; nobody does; duplicate reports; exact ties; a late ready check pushing the start back; a result arriving after the round closed.

**The competition layer**, with fake games standing in: random picks 5 unique, custom keeps order, two rounds per game, one point per round, scores survive game changes and reconnects, leaderboard sorts and handles ties, a new competition clears the old one.

**Latency.** The one test worth writing specifically: a client with 300 ms added latency should get an identical result to one with none in every self-timed game. If latency changes a Stop the Clock outcome, timing has leaked into the network layer.

**Reconnection.** Drop a client mid-round in each game type and confirm it comes back correctly or is handled cleanly.

**Browsers.** Two things matter more than the rest because timing is local: background tabs get their timers throttled, which corrupts a measurement — detect it and say so rather than reporting garbage. And `performance.now()` resolution is reduced in some browsers; confirm it's good enough for Crusher Escalator's beat windows, which are the tightest thing in the set.

## 15. UI the network model requires

- Show connecting, reconnecting, and disconnected states.
- Show a clear message for a bad room code or a full room.
- Show who the owner is, and say so when it changes.
- Show which game you're on, out of how many, and whether it's round 1 or 2.
- Make the ready check visible — show who the room is waiting for. It's what makes the shared start fair, so it shouldn't be a hidden handshake.
- Don't let anyone interact before their snapshot has applied.
- Self-timed rounds run entirely on the local clock, so nothing should stutter or wait on the network mid-round.
- In shared games, never show a local win before the server confirms it. Smooth small corrections; snap eliminations.
- Hidden Crossfire shows only your own aim until the reveal, with a clear freeze/reveal cue and visible shrinking bounds.
- Turn-based games show whose turn it is. Infinite Tic-Tac-Toe marks the next piece to expire; Word Bomb shows the letter combination, timer, spendable points, power-up costs, and queued next-turn effects.
- After each round: winner, point awarded, standings. After both rounds: a game summary. At the end: the full leaderboard.
- If a tab is backgrounded during a timed round, tell the player their timing may be off rather than silently reporting it.
- Prompt for a reload on a protocol mismatch.

## 16. Build order

**1. Lobby and competition shell.** Rooms, join by code, owner and transfer, playlist in both modes, the two-round runner, score table, leaderboard. Test it with placeholder games that return a random winner. This is the spine and it's worth having solid before any real game exists.

**2. Stop the Clock.** The whole self-timed pattern — ready check, scheduled start, local timing, result collection, tiebreakers — with essentially no rendering. Smallest possible first real game, and it proves the machinery four games will reuse.

**3. Chisel Gauntlet, then Type Racer Roulette.** Both reuse the self-timed runner directly. Chisel adds a cube renderer; Type Racer adds the one server round trip and the shared text rules.

**4. Liar's Deck, then Infinite Tic-Tac-Toe and Word Bomb.** Start with turn ownership and per-player private state. Reuse action handling for board moves and timed words, then add Word Bomb's spendable points and targeted power-ups.

**5. Movement layer.** The first real netcode: tick loop, input, snapshots, interpolation, prediction. Test this under packet loss, not just latency.

**6. Minefield, Log Dodge, Hidden Crossfire, then Blade Arena.** Reuse the shared-world layer. Log Dodge adds discrete jump/duck actions; Hidden Crossfire adds private aim, freeze/reveal phases, and shrinking bounds. Blade Arena last since it sets the performance ceiling.

**7. Crusher Escalator.** Almost entirely client-side, so the work is local timing polish and audio, not networking. Could move earlier if someone wants to build it.

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
- Both playlist modes, two rounds per game, one point per round, leaderboard at the end.
- Three games: **Stop the Clock, Chisel Gauntlet, Liar's Deck.**

Those three cover self-timed games, turn-based games, and private state. The remaining eight add game logic; Minefield, Blade Arena, Hidden Crossfire, and Log Dodge also need the shared-world simulation layer.

Explicitly not in v1: multiple server instances, Redis, a database, surviving a restart, accounts, matchmaking, delta compression, binary encoding, spectators if they turn out to be fiddly.

## 19. A game is done when

- It's clear whether it's self-timed, shared-world, or turn-based, and it's built that way.
- It resets between round 1 and round 2.
- It returns exactly one winner and never touches the score table itself.
- Self-timed: it doesn't start until everyone's ready, and it resolves when someone never reports.
- Shared: deadlines are server-side and nothing is shown as final before the server says so.
- Turn-based: actions, turn ownership, deadlines, and in-game point spending are validated by the server.
- Reconnect and disconnect behaviour is defined and not embarrassing.
- Adding 300 ms of latency doesn't change who wins.
- It doesn't leak hidden state through snapshots or spectator views.
- It handles a backgrounded tab sensibly.
- Its rules have tests.

## 20. Summary

Everyone connects to one Socket.IO server. Whoever clicks "host a game" gets a room code and lobby controls; if they leave, someone else gets them and the match carries on.

Four games run in the browser. The server hands out the round, waits for everyone to be ready, says go, and collects results. Latency never touches a measurement, which means no clock correction anywhere in the platform and very little networking in most of the catalogue.

Four shared-world games run on the server, because players share hazards, positions, or elimination timing and need one authoritative outcome. Those use a tick loop, snapshots with interpolation, and local prediction where movement is allowed.

Three turn-based games run on the server: Liar's Deck for private cards, Infinite Tic-Tac-Toe for the board and placement order, and Word Bomb for word validation, turn deadlines, and power-ups.

Shared code is: the lobby, the competition runner, the self-timed round runner, one shared-world layer, turn-based action handling, and the per-game rules. Everything else is specific to a game.

Build the lobby first with fake games, then Stop the Clock, then work outward. By the fourth game most of what a new game needs already exists.
