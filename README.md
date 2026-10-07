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

- `pipeline/` (Python) downloads your games, with their computer analysis, from the
  [Lichess API](https://lichess.org/api) into an NDJSON file.
- `web/scripts/buildDeck.ts` finds your mistakes in those games, the same way Lichess's "Learn from
  your mistakes" does, and saves them as a deck of cards.
- `web/` is the review page: Lichess's analysis board and "Learn from your mistakes" panel, ported
  from [lila](https://github.com/lichess-org/lila) (the software behind lichess.org), dealing the
  cards in spaced-repetition order. Your review history is saved to `web/data/reviews.json`.
  Its dashboard (the link at the top right) has your settings, such as which new cards come first
  and how far apart reviews are, saved to `web/data/settings.json`, and the cards you've suspended.

## Running it

You need Node.js, Python 3, git, and a [Lichess API token](https://lichess.org/account/oauth/token).

1. Install the page's dependencies: `cd web`, then `npm install`.
2. Build lila's stylesheets and copy the fonts and images they use. `web/scripts/buildLilaCss.ts`
   explains how to fetch the parts of lila it needs; then run
   `npx tsx scripts/buildLilaCss.ts <path to lila>` from `web`.
3. Save your games: put `LICHESS_TOKEN=...` in `pipeline/.env` (it's gitignored), set `USERNAME`
   in `pipeline/save_my_games.py`, and run it from `pipeline` (`python save_my_games.py`; later,
   `--update` adds only new games). The games go to `pipeline/data/games.ndjson`.
4. Build the deck, from `web`: `npx tsx scripts/buildDeck.ts <your Lichess username>`.
5. Start the page with `npm run dev`, and open the address it prints.

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

- `web/src/mousetrap.ts` is lila's adaptation of [Mousetrap](https://craig.is/killing/mice),
  copyright 2012-2017 Craig Campbell, under the Apache License 2.0 (see the notice in the file).
- The dependencies that `npm install` and `pip install` fetch aren't included in this repository:
  [chessground](https://github.com/lichess-org/chessground) and
  [chessops](https://github.com/niklasf/chessops) (GPL-3.0-or-later),
  [python-chess](https://github.com/niklasf/python-chess) (GPL-3.0-or-later),
  [snabbdom](https://github.com/snabbdom/snabbdom), [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs),
  and [Chart.js](https://www.chartjs.org/) (MIT), and development tools under MIT or Apache 2.0.
- lila's stylesheets, fonts, piece set, and board images aren't included either: step 2 above builds
  them from your own copy of lila, into `web/public/lila` (gitignored). They keep their own licences,
  listed in lila's
  [COPYING.md](https://github.com/lichess-org/lila/blob/27ffc8b5f296d180e7a648d6bfdad27eef3f86a2/COPYING.md).
  The script only copies ones with free licences: the brown board (AGPL-3.0+), the cburnett pieces
  (GPL-2.0+, Colin M.L. Burnett), Noto Sans and Roboto (Apache 2.0), and the icon and chess fonts
  (OFL, MIT, CC BY 3.0, GPL-2.0+, and AGPL-3.0+). If you change the board or pieces, check their
  entry in COPYING.md: some of lila's are non-free or non-commercial.
- Mistake Trainer doesn't use the Lichess name or logo as its own; lila's COPYING.md reserves the
  logo for referring to lichess.org.
- The games in `web/fixtures` are from lichess.org, whose game database Lichess releases under
  [CC0](https://database.lichess.org/).

## AI assistance

Most of the code was written with Anthropic's Claude, under Dan Nagel's direction: the first steps
through the Claude chat app, and the rest with Claude Code, its coding tool. Commits made with
Claude Code end with a `Co-Authored-By: Claude` line.
