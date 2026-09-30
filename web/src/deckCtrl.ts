// deckCtrl.ts: Step 9. Deals the cards of a deck one at a time into the analysis page.
// A session goes through every card once, in random order. Spaced repetition will replace the
// random order with the cards that are due.
//
// There's one AnalysisCtrl for the whole session. Each card loads its game into it
// (loadGame, like lila changing a study chapter), then opens "Learn from your mistakes" in card
// mode at the card's mistake. When the card is done, the panel's "Next" calls `next` below.

import { AnalysisCtrl } from './analysisCtrl';
import type { Card, Deck } from './deck';
import type { RetroCardOpts } from './retroCtrl';

// Fisher-Yates: a random order, with every order equally likely.
function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class DeckCtrl {
  readonly analysis: AnalysisCtrl;
  private session: Card[] = []; // this session's cards, in the order they're dealt
  private index = 0; // the card being shown

  // What retroCtrl needs in card mode; `ply` changes with each card.
  private cardOpts(card: Card): RetroCardOpts {
    return {
      ply: card.ply,
      next: this.next,
      progress: () => [this.index, this.session.length],
      restart: this.start,
    };
  }

  // The deck must have at least one card. This sets up the first card; main.ts opens the panel
  // on it after the first render (opening it redraws, and the page needs this object for that).
  constructor(
    readonly deck: Deck,
    private readonly redraw: () => void,
  ) {
    this.session = shuffle(deck.cards);
    const card = this.session[0];
    this.analysis = new AnalysisCtrl(deck.games[card.gameId], card.color, redraw, this.cardOpts(card));
  }

  get card(): Card {
    return this.session[this.index];
  }

  // Shows the card at this.index.
  private deal(): void {
    const card = this.card;
    this.analysis.loadGame(this.deck.games[card.gameId], card.color, this.cardOpts(card));
    this.analysis.toggleRetro(); // jumps to the card's mistake
    this.redraw();
  }

  // Deals the next card. False when the session is over.
  next = (): boolean => {
    if (this.index + 1 >= this.session.length) return false;
    this.index++;
    this.deal();
    return true;
  };

  // A new session: all the cards again, in a new random order.
  start = (): void => {
    this.session = shuffle(this.deck.cards);
    this.index = 0;
    this.deal();
  };
}
