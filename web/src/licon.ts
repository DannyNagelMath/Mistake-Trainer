// licon.ts: characters of the lichess icon font (public/lila/font/lichess.woff2), from lila's
// ui/lib/src/licon.ts (master, commit 27ffc8b). Only the ones we use; copy more from there as needed.
// lila writes the characters themselves, which are invisible in most editors; these are the same
// characters written as escapes, with lila's hex codes.
export const licon = {
  Rabbit: '\ue002',
  FlameBlitz: '\ue008',
  Turtle: '\ue00a',
  GraduateCap: '\ue018',
  PaperAirplane: '\ue019',
  ChasingArrows: '\ue020',
  PlayTriangle: '\ue025',
  GreaterThan: '\ue026',
  LessThan: '\ue027',
  X: '\ue02a',
  Bullet: '\ue032',
  JumpLast: '\ue034',
  JumpFirst: '\ue035',
  Hamburger: '\ue039',
  UltraBullet: '\ue059',
} as const;
