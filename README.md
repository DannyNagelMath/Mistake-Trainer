# Mistake Trainer

Spaced-repetition practice on the mistakes from your own Lichess games.

Lichess's analysis board has "Learn from your mistakes": it steps through one game, showing each
position where you went wrong and asking you to find a better move. Mistake Trainer takes that
feature and turns every mistake from all your analysed games into a flashcard. It then schedules
the cards with spaced repetition (FSRS, the algorithm Anki uses), so each position comes back just
as you're about to forget it.

It is an unofficial personal project, and isn't affiliated with or endorsed by Lichess. It's built
on Lichess's open-source code, with gratitude: if you find it useful, please consider
[supporting Lichess](https://lichess.org/patron).

## How it works

- The page downloads your games, with their computer analysis, from the
  [Lichess API](https://lichess.org/api), and finds your mistakes in them, the same way Lichess's
  "Learn from your mistakes" does: a card for each. For a game Lichess hasn't analysed, it uses
  the analysis made on your computer, if there is one (see Training settings below). Like Lichess,
  it looks opening mistakes up in the [masters database](https://lichess.org/analysis#explorer),
  if you sign in with Lichess: a move masters have played isn't a mistake, and their other moves
  count as right answers. It asks about each position only once.
- The review page is Lichess's analysis board and "Learn from your mistakes" panel, ported
  from [lila](https://github.com/lichess-org/lila) (the software behind lichess.org), dealing the
  cards in spaced-repetition order. As on Lichess, a move other than the engine's best is checked by
  [Stockfish](https://stockfishchess.org/), running in the browser with its full network on
  several threads: it counts as right if it's nearly as good. Once a card is done, you can switch
  the engine on to analyse any position. Your review history is saved to `data/reviews.json`.
  Its Training settings page (the link at the top right) is where you choose, for example, which
  new cards come first and how far apart reviews are (saved to `data/settings.json`), and
  where you can bring back cards you've suspended. It's also where your games without Lichess's
  analysis can be analysed on your computer, the way Lichess's servers do it: Stockfish 19,
  1,000,000 positions a move, one thread per engine, as in
  [fishnet](https://github.com/lichess-org/fishnet). Each game's analysis is saved to
  `data/analysis.json`.

## Running it

You need Node.js and git.

1. Install the page's dependencies with `npm install`.
2. Start the page with `npm run dev`, open the address it prints, and give your Lichess username:
   the page downloads your games and builds your deck. Everything it saves is in `data`.

Later, to add the games you've played since, and the games analysed in Training settings since,
press **Update deck** in Training settings: it downloads the new games and builds the deck again. Your review history is backed up once a day, in
`data/backups`; to go back to a backup, stop the page and copy it over `data/reviews.json`.

## Licence

Mistake Trainer is free software: you can redistribute it and/or modify it under the terms of the
GNU Affero General Public License as published by the Free Software Foundation, either version 3 of
the License, or (at your option) any later version. See [LICENSE](LICENSE). It uses this licence
because much of it is ported from lila, which is licensed the same way.

- Portions copyright (c) 2012-2026 the
  [lila authors](https://github.com/lichess-org/lila/graphs/contributors).
- Everything else copyright (c) 2026 Dan Nagel.

Each file ported from lila says which lila file it comes from, at lila commit
[27ffc8b](https://github.com/lichess-org/lila/tree/27ffc8b5f296d180e7a648d6bfdad27eef3f86a2). Every
change from lila's version is marked in the code with a comment: `Trim:` where something was
removed or simplified, `Fix:` for a bug fix, and `Step N:` for additions.

The AGPL also covers use over a network: if you run Mistake Trainer as a service for other people,
you must offer them its source code.

### Third-party code and assets

- `src/mousetrap.ts` is lila's adaptation of [Mousetrap](https://craig.is/killing/mice),
  copyright 2012-2017 Craig Campbell, under the Apache License 2.0 (see the notice in the file).
- The dependencies that `npm install` fetches aren't included in this repository:
  [chessground](https://github.com/lichess-org/chessground) and
  [chessops](https://github.com/niklasf/chessops) (GPL-3.0-or-later),
  [snabbdom](https://github.com/snabbdom/snabbdom) and
  [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (MIT),
  [stockfish.js](https://github.com/nmrugg/stockfish.js), Stockfish compiled to WebAssembly
  (GPL-3.0), and development tools under MIT or Apache 2.0.
- lila's stylesheets, fonts, piece sets, board image, and help videos are in `public/lila`,
  built from lila's source by `scripts/buildLilaCss.ts`. They keep their own licences, all
  free: `public/lila/README.md` lists each file's authors and licence, and the licences' texts
  are beside it. If you change the board or pieces, check their entry in lila's
  [COPYING.md](https://github.com/lichess-org/lila/blob/27ffc8b5f296d180e7a648d6bfdad27eef3f86a2/COPYING.md):
  some of lila's are non-free or non-commercial.
- Mistake Trainer doesn't use the Lichess name or logo as its own; lila's COPYING.md reserves the
  logo for referring to lichess.org.
- The games in `fixtures` are from lichess.org, whose game database Lichess releases under
  [CC0](https://database.lichess.org/).

## AI assistance

Most of the code was written with Anthropic's Claude, under Dan Nagel's direction: the first steps
through the Claude chat app, and the rest with Claude Code, its coding tool. Commits made with
Claude Code end with a `Co-Authored-By: Claude` line.
