// side.ts: Step 8. The panel beside the board with the game's details: time control, date,
// players and ratings, and the result. lila's server writes this panel into every game page
// (app/views/game/side.scala, `meta`, and the helpers in modules/ui/src/main/helper/GameHelper.scala,
// master, commit 27ffc8b); this makes the same elements from the game's JSON.
// Every change from lila's version is marked with a comment starting "Trim:".

import type { Color } from 'chessops';
import type { VNode } from 'snabbdom';

import type { AnalysisCtrl } from './analysisCtrl';
import { i18n } from './i18n';
import { licon } from './licon';
import { hl } from './snabbdom';
import { statusOf, status } from './status';
import type { LichessGameJson, LichessPlayer } from './tree';

const separator = ' • ';

// The time control, like scalachess's Clock.Config.show: "5+3", or "½+0" for 30 seconds.
function showClock(clock: NonNullable<LichessGameJson['clock']>): string {
  const limit = clock.initial;
  const minutes =
    limit % 60 === 0 ? String(limit / 60)
    : limit === 15 ? '¼'
    : limit === 30 ? '½'
    : limit === 45 ? '¾'
    : limit === 90 ? '1.5'
    : (limit / 60).toFixed(1);
  return `${minutes}+${clock.increment}`;
}

// Each speed's icon, from lila's ui/lib/src/game/perfIcons.ts, and its name.
// Trim: lila shows other icons for variants, imported games, games from a position, and games
// against the computer (GameUi.gameIcon), and names the variant for variants.
const speeds: Record<string, { icon: string; name: string }> = {
  ultraBullet: { icon: licon.UltraBullet, name: i18n.site.ultraBullet },
  bullet: { icon: licon.Bullet, name: i18n.site.bullet },
  blitz: { icon: licon.FlameBlitz, name: i18n.site.blitz },
  rapid: { icon: licon.Rabbit, name: i18n.site.rapid },
  classical: { icon: licon.Turtle, name: i18n.site.classical },
  correspondence: { icon: licon.PaperAirplane, name: i18n.site.correspondence },
};

// Like lila's timeago: "3 days ago". Trim: lila's updates itself as time passes.
function timeAgo(t: Date, now = new Date()): string {
  const seconds = (t.getTime() - now.getTime()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 24 * 3600],
    ['month', 30 * 24 * 3600],
    ['week', 7 * 24 * 3600],
    ['day', 24 * 3600],
    ['hour', 3600],
    ['minute', 60],
  ];
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return 'right now';
}

// A rating change: <good>+9</good> or <bad>−42</bad>, from lila's showRatingDiff.
export const ratingDiff = (diff: number): VNode =>
  diff === 0 ? hl('span', '±0') : diff > 0 ? hl('good', '+' + diff) : hl('bad', '−' + -diff);

// Like lila's playerLink with its defaults: the name, the rating ("?" when provisional), and
// the rating change. The name links to the player's page on lichess.org.
// Trim: no titles (GM, ...) or flairs; the export's `user` doesn't have them.
function playerLink(player: LichessPlayer): VNode {
  if (!player.user)
    return hl('span.user-link', [
      player.aiLevel ? i18n.site.aiNameLevelAiLevel('Stockfish', player.aiLevel) : i18n.site.anonymous,
      player.rating !== undefined && ` (${player.rating})`,
    ]);
  return hl('a.user-link', { attrs: { href: `https://lichess.org/@/${player.user.name}`, target: '_blank' } }, [
    player.user.name,
    hl('span.rating', [' (', player.rating ?? '?', player.provisional ? '?' : '', ')']),
    player.ratingDiff !== undefined && [' ', ratingDiff(player.ratingDiff)],
  ]);
}

export function renderSide(ctrl: AnalysisCtrl): VNode {
  const game = ctrl.game;
  const finished = game.status !== undefined && status[game.status] >= status.mate;
  const lastPly = ctrl.mainline[ctrl.mainline.length - 1].ply;
  const speed = speeds[game.speed ?? ''];
  return hl('aside.analyse__side', [
    hl('div.game__meta', [
      hl('section', [
        hl('div.game__meta__infos', { attrs: { 'data-icon': speed?.icon ?? '' } }, [
          hl('div.header', [
            // Trim: lila also has a bookmark button, and says so for imported games.
            hl('div.setup', [
              game.clock ? showClock(game.clock) : i18n.site.unlimited,
              separator,
              game.rated ? i18n.site.rated : i18n.site.casual,
              separator,
              hl('span', speed?.name ?? game.speed ?? ''),
            ]),
            game.createdAt &&
              hl('time.timeago', { attrs: { title: new Date(game.createdAt).toLocaleString() } }, timeAgo(new Date(game.createdAt))),
          ]),
        ]),
        hl(
          'div.game__meta__players',
          (['white', 'black'] as Color[]).map(color =>
            hl(`div.player.color-icon.is.${color}.text`, game.players ? playerLink(game.players[color]) : '?'),
          ),
        ),
      ]),
      finished && hl('section.status', statusOf({ winner: game.winner, status: game.status!, ply: lastPly })),
      // Step 8: not in lila, which is lichess.org itself. The game there, at the move on the board.
      hl(
        'section',
        hl(
          'a',
          { attrs: { href: `https://lichess.org/${game.id}/${ctrl.bottomColor()}#${ctrl.node.ply}`, target: '_blank' } },
          'Open this position on lichess.org',
        ),
      ),
    ]),
  ]);
}
