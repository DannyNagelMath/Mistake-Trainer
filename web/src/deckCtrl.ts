// deckCtrl.ts: Step 9. Deals the deck's cards into the analysis page in spaced-repetition order
// (schedule.ts), and records how you did on each one (reviews.ts), with your settings
// (settings.ts). Training settings, which shows in the same page, passes on any you save
// (useSettings).
//
// There's one AnalysisCtrl for the whole session. Each card loads its game into it
// (loadGame, like lila changing a study chapter), then opens "Learn from your mistakes" in card
// mode at the card's mistake. retroCtrl reports what you do (onResult), and when the card is done,
// the panel's "Next" calls `next` below.

import { createEmptyCard, type Grade } from 'ts-fsrs';

import { AnalysisCtrl } from './analysisCtrl';
import { gameTimesOf, type Card, type Deck } from './deck';
import type { CardResult, RetroCardOpts } from './retroCtrl';
import { saveReview, saveSuspension, type ReviewEntry, type ReviewHistory } from './reviews';
import {
  activeCards,
  canComeUp,
  cardsInPlay,
  gradeOf,
  nextAvailable,
  orderNewCards,
  pickNext,
  progress,
  recentGames,
  reviewCard,
  winRatings,
  yourLastGames,
  type Progress,
} from './schedule';
import type { Settings } from './settings';

// Fisher-Yates: a random order, with every order equally likely.
function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The card on screen, remembered for this browser tab (sessionStorage), so that reloading the
// page shows it again rather than dealing another. Where there's no storage (the tests), nothing is
// remembered.
const CARD_KEY = 'mistakeTrainer.card';
function rememberCard(cardId: string): void {
  try {
    sessionStorage.setItem(CARD_KEY, cardId);
  } catch {}
}
function rememberedCard(): string | null {
  try {
    return sessionStorage.getItem(CARD_KEY);
  } catch {
    return null;
  }
}

// A card you got right on your first move but haven't rated yet, and the move you played,
// remembered by the browser (localStorage) until you rate it: if you reload the page or close it
// first, the card comes back next time as you left it, waiting for your rating (DeckCtrl.resume),
// and the review isn't lost.
interface Pending {
  cardId: string;
  uci: string;
}
const PENDING_KEY = 'mistakeTrainer.pending';
function rememberPending(pending: Pending | undefined): void {
  try {
    if (pending) localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    else localStorage.removeItem(PENDING_KEY);
  } catch {}
}
function rememberedPending(): Pending | undefined {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

// E.g. "now", "in 8 minutes", or "on Thu, Oct 2, 2:05 PM".
function describeTime(t: Date, now = new Date()): string {
  const minutes = Math.ceil((t.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `on ${t.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

export class DeckCtrl {
  readonly analysis: AnalysisCtrl;
  private readonly shuffled: Card[]; // the deck in a random order, which `cards` sorts
  private cards: Card[]; // the deck in the order new cards are introduced in (settings.newCardOrder)
  private card: Card; // the card being shown
  private graded = false; // whether the card's review has been recorded; only the first attempt counts
  private awaitingRating = false; // right first time, and the panel is asking how it went
  private firstMove?: ReviewEntry['move']; // the move you played first on this card, if you did
  private reviewed = 0; // reviews recorded this session

  // The deck must have at least one card. This sets up the first card; main.ts opens the panel
  // on it after the first render (opening it redraws, and the page needs this object for that).
  constructor(
    readonly deck: Deck,
    private readonly history: ReviewHistory,
    public settings: Settings, // changed only by useSettings
    private readonly redraw: () => void,
  ) {
    this.shuffled = shuffle(deck.cards);
    this.cards = this.inOrder(settings);
    // A card waiting for your rating, then the card you left, if you hadn't answered it and it can
    // still come up (once answered, it isn't due again for days, so it can't); else the next one.
    const pending = rememberedPending();
    if (pending && !canComeUp(this.cards, history, new Date(), settings, pending.cardId)) rememberPending(undefined);
    const left = rememberedPending()?.cardId ?? rememberedCard();
    const first =
      (left && canComeUp(this.cards, history, new Date(), settings, left) && this.cards.find(c => c.id === left)) ||
      pickNext(this.cards, history, new Date(), settings);
    if (first) rememberCard(first.id);
    // With nothing due, show the last card you reviewed, with the panel saying when the next is due.
    // Its ply is -1, which matches no mistake, so the panel opens on that message.
    this.card = first ?? this.lastReviewed() ?? this.cards[0] ?? this.shuffled[0]; // any card, if none are in play
    const game = deck.games[this.card.gameId];
    this.analysis = new AnalysisCtrl(game, this.card.color, redraw, this.cardOpts(first ? this.card.ply : -1));
  }

  // The cards in play (schedule.ts cardsInPlay), in the order new cards are introduced: random among
  // cards the order ties.
  private inOrder(settings: Settings): Card[] {
    return orderNewCards(cardsInPlay(this.shuffled, this.history, gameTimesOf(this.deck), settings), settings);
  }

  // "Recent games", for the progress box and the end of the session.
  recent = (): ReturnType<typeof recentGames> => recentGames(gameTimesOf(this.deck), this.settings);

  private lastReviewed(): Card | undefined {
    const last = this.history.log.at(-1);
    return last && this.cards.find(c => c.id === last.cardId);
  }

  // What retroCtrl needs in card mode.
  private cardOpts(ply: number): RetroCardOpts {
    return {
      ply,
      next: this.next,
      restart: this.restart,
      summary: this.summary,
      onResult: this.onResult,
      ratingChoices: this.ratingChoices,
      suspend: this.suspend,
      openingUcis: this.card.masterMoves ?? [],
      bestMoveOnly: () => this.settings.bestMoveOnly, // the setting as it is when you move
      lastTime: this.lastReviewOf(this.card.id),
    };
  }

  // The card's latest review, if it's had one.
  private lastReviewOf(cardId: string): ReviewEntry | undefined {
    const log = this.history.log;
    for (let i = log.length - 1; i >= 0; i--) if (log[i].cardId === cardId) return log[i];
    return undefined;
  }

  // Training settings you've just saved apply from now on. The card on screen stays as it is; the
  // next one is dealt with them, a rating is scheduled with them, and "Right answers" applies to
  // your next move. The order of new cards is sorted again from the same random order, so
  // switching it back gives the order you had. A change to "Recent games" applies at once.
  useSettings = (settings: Settings): void => {
    this.settings = settings;
    this.cards = this.inOrder(settings);
  };

  // "Suspend card": the card never comes up again. No review is recorded, not even a pending
  // rating. Then the next card, or, with none left, the end screen.
  private suspend = (): void => {
    const at = new Date().toISOString();
    (this.history.suspended ??= {})[this.card.id] = at;
    saveSuspension(this.card.id, at).catch(e => alert(e.message));
    this.awaitingRating = false;
    rememberPending(undefined);
    if (!this.next()) this.showEnd();
  };

  // With nothing to deal: like the constructor with nothing due, show this card's game with the
  // end screen (ply -1 matches no mistake).
  private showEnd(): void {
    this.analysis.loadGame(this.deck.games[this.card.gameId], this.card.color, this.cardOpts(-1));
    this.analysis.toggleRetro();
    this.redraw();
  }

  // The counts for the progress box.
  progress = (): Progress => progress(this.cards, this.history, new Date(), this.settings);

  // Grades the card on your first attempt at it, and ignores later ones. A wrong first move,
  // "View the solution", or "Skip" is recorded as Again at once. The right first move waits for
  // you to choose how it went (ratingChoices). For a move, right or wrong, the board is still on it.
  private onResult = (result: CardResult): void => {
    if (this.graded || this.awaitingRating) return;
    const { san, uci } = this.analysis.node;
    this.firstMove = (result === 'win' || result === 'fail') && san && uci ? { san, uci } : undefined;
    if (result === 'win') {
      this.awaitingRating = true;
      rememberPending({ cardId: this.card.id, uci: this.analysis.node.uci! }); // the move you played
    } else this.record(result, gradeOf(result));
  };

  // After the page opens (main.ts): if the card on screen was waiting for your rating when you
  // left, play your move again, so it's as you left it: solved, with the rating buttons. A move
  // the engine had to check is checked again.
  resume = (): void => {
    const pending = rememberedPending();
    if (!pending || pending.cardId !== this.card.id || this.graded) return;
    try {
      this.analysis.playUci(pending.uci);
    } catch {
      rememberPending(undefined); // e.g. the deck was rebuilt differently
    }
  };

  private ratingChoices = (): { label: string; rate: () => void }[] | undefined =>
    this.awaitingRating
      ? winRatings.map(({ label, grade }) => ({
          label,
          rate: () => {
            this.record('win', grade);
            this.redraw();
          },
        }))
      : undefined;

  // Records the review: FSRS schedules the card from the grade, and the review goes in the log.
  private record(result: CardResult, grade: Grade): void {
    this.graded = true;
    this.awaitingRating = false;
    rememberPending(undefined);
    this.reviewed++;
    const now = new Date();
    const schedule = this.history.cards[this.card.id] ?? createEmptyCard(now); // a new card's is empty
    const { card, log } = reviewCard(schedule, now, grade, this.settings); // FSRS, with the minimum gap
    const entry: ReviewEntry = { cardId: this.card.id, result, move: this.firstMove, log };
    this.history.cards[this.card.id] = card;
    this.history.log.push(entry);
    saveReview(card, entry).catch(e => alert(e.message)); // tell you, rather than lose reviews quietly
  }

  // Deals the next card. False when nothing more is due.
  next = (): boolean => {
    // Leaving a card you got right without saying how it went (e.g. by closing the panel and
    // opening it again): record it as Good, the grade before there was a choice.
    if (this.awaitingRating) this.record('win', gradeOf('win'));
    const card = pickNext(this.cards, this.history, new Date(), this.settings, this.card.id);
    if (!card) return false;
    this.card = card;
    rememberCard(card.id);
    this.graded = false;
    this.firstMove = undefined;
    this.analysis.loadGame(this.deck.games[card.gameId], card.color, this.cardOpts(card.ply));
    this.analysis.toggleRetro(); // jumps to the card's mistake
    this.redraw();
    return true;
  };

  // For the button at the end: deals a card if one has come due since.
  restart = (): void => {
    if (!this.next()) this.showEnd();
  };

  // For the end of the session.
  private summary = (): string => {
    const next = nextAvailable(this.cards, this.history, new Date(), this.settings);
    const limit = this.settings.newCardsPerDay;
    const unstarted = activeCards(this.cards, this.history).filter(c => !this.history.cards[c.id]).length;
    const recent = this.recent();
    const fromRecent = recent ? ` from ${yourLastGames(recent.games)}` : '';
    return [
      `Nothing more to review right now (${this.reviewed} reviewed this session).`,
      next && `The next card comes up ${describeTime(next)}.`,
      unstarted
        ? `${unstarted} new cards${fromRecent} haven't been started yet` +
          (limit === null ? '.' : ` (up to ${limit} in any 24 hours).`)
        : recent &&
          `You've started all the cards${fromRecent}. For more, raise that number in Training settings ` +
            '(Recent games).',
    ]
      .filter(Boolean)
      .join(' ');
  };
}
