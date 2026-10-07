// deckCtrl.ts: Step 9. Deals the deck's cards into the analysis page in spaced-repetition order
// (schedule.ts), and records how you did on each one (reviews.ts).
//
// There's one AnalysisCtrl for the whole session. Each card loads its game into it
// (loadGame, like lila changing a study chapter), then opens "Learn from your mistakes" in card
// mode at the card's mistake. retroCtrl reports what you do (onResult), and when the card is done,
// the panel's "Next" calls `next` below.

import { createEmptyCard, type Grade } from 'ts-fsrs';

import { AnalysisCtrl } from './analysisCtrl';
import type { Card, Deck } from './deck';
import type { CardResult, RetroCardOpts } from './retroCtrl';
import { saveReview, saveSuspension, type ReviewEntry, type ReviewHistory } from './reviews';
import { activeCards, cardsLeft, gradeOf, NEW_CARDS_PER_DAY, nextAvailable, pickNext, scheduler, winRatings } from './schedule';

// Fisher-Yates: a random order, with every order equally likely.
function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
  private readonly cards: Card[]; // the deck in a random order, the order new cards are introduced in
  private card: Card; // the card being shown
  private graded = false; // whether the card's review has been recorded; only the first attempt counts
  private awaitingRating = false; // right first time, and the panel is asking how it went
  private reviewed = 0; // reviews recorded this session

  // The deck must have at least one card. This sets up the first card; main.ts opens the panel
  // on it after the first render (opening it redraws, and the page needs this object for that).
  constructor(
    readonly deck: Deck,
    private readonly history: ReviewHistory,
    private readonly redraw: () => void,
  ) {
    this.cards = shuffle(deck.cards);
    const first = pickNext(this.cards, history, new Date());
    // With nothing due, show the last card you reviewed, with the panel saying when the next is due.
    // Its ply is -1, which matches no mistake, so the panel opens on that message.
    this.card = first ?? this.lastReviewed() ?? this.cards[0];
    const game = deck.games[this.card.gameId];
    this.analysis = new AnalysisCtrl(game, this.card.color, redraw, this.cardOpts(first ? this.card.ply : -1));
  }

  private lastReviewed(): Card | undefined {
    const last = this.history.log.at(-1);
    return last && this.cards.find(c => c.id === last.cardId);
  }

  // What retroCtrl needs in card mode.
  private cardOpts(ply: number): RetroCardOpts {
    return {
      ply,
      next: this.next,
      // [reviews before this card, reviews in the session]: the title shows "4 / 20" for the 4th.
      progress: () => {
        const total = this.reviewed + cardsLeft(this.cards, this.history, new Date());
        return [this.reviewed - (this.graded ? 1 : 0), total];
      },
      restart: this.restart,
      summary: this.summary,
      onResult: this.onResult,
      ratingChoices: this.ratingChoices,
      suspend: this.suspend,
    };
  }

  // "Suspend card": the card never comes up again. No review is recorded, not even a pending
  // rating. Then the next card, or, with none left, the end screen.
  private suspend = (): void => {
    const at = new Date().toISOString();
    (this.history.suspended ??= {})[this.card.id] = at;
    saveSuspension(this.card.id, at).catch(e => alert(e.message));
    this.awaitingRating = false;
    if (this.next()) return;
    // Nothing left: like the constructor with nothing due, show this game with the end screen
    // (ply -1 matches no mistake).
    this.analysis.loadGame(this.deck.games[this.card.gameId], this.card.color, this.cardOpts(-1));
    this.analysis.toggleRetro();
    this.redraw();
  };

  // Grades the card on your first attempt at it, and ignores later ones. A wrong first move,
  // "View the solution", or "Skip" is recorded as Again at once. The right first move waits for
  // you to choose how it went (ratingChoices).
  private onResult = (result: CardResult): void => {
    if (this.graded || this.awaitingRating) return;
    if (result === 'win') this.awaitingRating = true;
    else this.record(result, gradeOf(result));
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
    this.reviewed++;
    const now = new Date();
    const schedule = this.history.cards[this.card.id] ?? createEmptyCard(now); // a new card's is empty
    const { card, log } = scheduler.next(schedule, now, grade);
    const entry: ReviewEntry = { cardId: this.card.id, result, log };
    this.history.cards[this.card.id] = card;
    this.history.log.push(entry);
    saveReview(card, entry).catch(e => alert(e.message)); // tell you, rather than lose reviews quietly
  }

  // Deals the next card. False when nothing more is due.
  next = (): boolean => {
    // Leaving a card you got right without saying how it went (e.g. by closing the panel and
    // opening it again): record it as Good, the grade before there was a choice.
    if (this.awaitingRating) this.record('win', gradeOf('win'));
    const card = pickNext(this.cards, this.history, new Date(), this.card.id);
    if (!card) return false;
    this.card = card;
    this.graded = false;
    this.analysis.loadGame(this.deck.games[card.gameId], card.color, this.cardOpts(card.ply));
    this.analysis.toggleRetro(); // jumps to the card's mistake
    this.redraw();
    return true;
  };

  // For the button at the end: deals a card if one has come due since.
  restart = (): void => {
    if (!this.next()) this.redraw();
  };

  // For the end of the session.
  private summary = (): string => {
    const next = nextAvailable(this.cards, this.history, new Date());
    const unstarted = activeCards(this.cards, this.history).filter(c => !this.history.cards[c.id]).length;
    return [
      `Nothing more to review right now (${this.reviewed} reviewed this session).`,
      next && `The next card comes up ${describeTime(next)}.`,
      unstarted &&
        `${unstarted} new cards haven't been started yet` +
          (Number.isFinite(NEW_CARDS_PER_DAY) ? ` (up to ${NEW_CARDS_PER_DAY} in any 24 hours).` : '.'),
    ]
      .filter(Boolean)
      .join(' ');
  };
}
