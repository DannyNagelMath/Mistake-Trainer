// licon.ts: characters of the lichess icon font (public/lila/font/lichess.woff2), from lila's
// ui/lib/src/licon.ts (27ffc8b). Only the ones we use; copy more from there as needed.
// lila writes the characters themselves, which are invisible in most editors; these are the same
// characters written as escapes, with lila's hex codes.
export const licon = {
  Rabbit: '\ue002',
  Gear: '\ue005',
  FlameBlitz: '\ue008',
  Turtle: '\ue00a',
  GraduateCap: '\ue018',
  PaperAirplane: '\ue019',
  ChasingArrows: '\ue020',
  Checkmark: '\ue023',
  InternalArrow: '\ue024',
  PlayTriangle: '\ue025',
  GreaterThan: '\ue026',
  LessThan: '\ue027',
  X: '\ue02a',
  PlusButton: '\ue02d',
  MinusButton: '\ue02e',
  UpTriangle: '\ue031',
  Bullet: '\ue032',
  JumpLast: '\ue034',
  JumpFirst: '\ue035',
  Hamburger: '\ue039',
  Trash: '\ue04f',
  UltraBullet: '\ue059',
  Clipboard: '\ue070',
} as const;
