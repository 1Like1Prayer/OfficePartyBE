What I built

src/shared/ — imported by both sides, no I/O:
- protocol.ts — event names, the {roundId, attempt} envelope, all payload types, PROTOCOL_VERSION
- constants.ts — the section-17 decisions made concrete (2–8 players, 4-char codes, 30 s disconnect grace, 2 s start lead, 5 min empty-room TTL)
- games/catalog.ts — all ten games with kind and implemented
- games/selfTimed.ts — the SelfTimedGameModule contract the other four self-timed games will satisfy
- games/stopTheClock.ts — the rules as plain functions: target picking, result parsing, absolute-error ranking with shared rank on ties

src/game/ — server machinery, none of it touching Socket.IO:
- selfTimedRound.ts — the runner five games will reuse: round data → ready check → scheduled start → collect → rank. Tiebreakers run internally as extra attempts and hand back exactly one winner.
- competition.ts — playlist building, two rounds per game, one point per round, leaderboard
- room.ts — membership, owner succession, spectators, reconnect, round orchestration
- roomManager.ts, clock.ts (monotonic + a FakeClock), ids.ts, registry.ts

src/controller/gameSocketController.ts — the /game namespace. Validates with zod, acks every request, rejects protocol mismatches in a connection middleware.

Two things worth flagging

Random mode is currently a 1-game playlist. It picks only from games that are actually built, and Stop the Clock is the only one. It'll widen on its own as modules get registered — no code change needed.

The build was already broken when I started: src/controller/socketPageController.ts was missing but imported by socketRouter.ts. I restored it from the compiled dist/ copy. Worth checking that wasn't an intentional deletion.

Design choices you may want to revisit

- Nobody reports → the round awards no point rather than inventing a winner.
- Ready-check timeout (20 s) drops the straggler and starts without them, rather than hanging the room.
- Three tied attempts → the winner is drawn at random, and the results message says decidedByCoinFlip: true rather than hiding it.
- Backgrounded tabs: the client's timingSuspect flag is carried into the results for display, but the result is still scored. Section 17 leaves this open — voiding instead is a one-line change in rank.

Latency invariance is tested directly (selfTimedRound.spec.ts): the same two results, one submitted 600 ms later in fake-clock time, produce an identical ranking.