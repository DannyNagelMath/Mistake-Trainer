"""Download all of a user's blitz and rapid games from Lichess, as NDJSON (one game per line).

Usage, from the pipeline folder:
    python save_my_games.py            download everything into data/games.ndjson
                                       (the old file is kept as a dated backup)
    python save_my_games.py --update   add only the games played since the newest one saved

Games that have Lichess's computer analysis come with it (evals, judgments, and best lines),
which is what scripts/buildDeck.ts turns into cards. The others are saved too, without it.

Being gentle with Lichess's servers, as its API documentation asks
(https://lichess.org/api, "Rate limiting"):
  - one request, streamed, never several at once;
  - with your token, Lichess streams your own games at up to 60 a second;
  - if Lichess answers 429 (too many requests), wait a full minute, try once more, then stop;
  - --update asks only for games newer than the newest one saved, rather than everything again.
"""
import json
import os
import shutil
import sys
import time
from datetime import date
from pathlib import Path

import requests
from dotenv import load_dotenv

USERNAME = "mugglesman1982"
SPEEDS = "blitz,rapid"

SCRIPT_DIR = Path(__file__).parent
GAMES_FILE = SCRIPT_DIR / "data" / "games.ndjson"

# Read variables from pipeline/.env into the environment, then get the token.
load_dotenv(SCRIPT_DIR / ".env")
token = os.getenv("LICHESS_TOKEN")
if not token:
    raise SystemExit("LICHESS_TOKEN not found. Check that pipeline/.env exists and defines it.")

url = f"https://lichess.org/api/games/user/{USERNAME}"
headers = {
    "Accept": "application/x-ndjson",
    "Authorization": f"Bearer {token}",
    # Says who is asking, so Lichess can tell what's making the request.
    "User-Agent": "Mistake Trainer (personal script; github.com/DannyNagelMath/Mistake-Trainer)",
}
params = {
    "perfType": SPEEDS,
    "evals": "true",  # computer analysis, for games that have it
    "clocks": "true",  # clock times, for the player strips
    "accuracy": "true",  # each player's accuracy, when analysed
    "opening": "true",  # the opening's name
    "division": "true",  # where the middlegame and endgame start, for the eval chart
}


def read_games(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


update = "--update" in sys.argv
existing = read_games(GAMES_FILE) if update else []
if update and existing:
    # Lichess's `since` is a game's start time, in milliseconds.
    params["since"] = str(max(g["createdAt"] for g in existing) + 1)


def download(path: Path) -> int:
    """Streams the games into `path`, one per line, and returns how many arrived."""
    for attempt in (1, 2):
        with requests.get(url, headers=headers, params=params, stream=True, timeout=(10, 120)) as response:
            if response.status_code == 429 and attempt == 1:
                print("Lichess says too many requests (429). Waiting a full minute before trying once more.")
                time.sleep(60)
                continue
            response.raise_for_status()
            response.encoding = "utf-8"  # Lichess doesn't say, and iter_lines needs it to give text
            count = 0
            with open(path, "w", encoding="utf-8") as f:
                for line in response.iter_lines(decode_unicode=True):
                    if line:
                        f.write(line + "\n")
                        count += 1
                        if count % 100 == 0:
                            print(f"  {count} games...")
            return count
    raise SystemExit("Lichess still says too many requests. Try again later.")


GAMES_FILE.parent.mkdir(exist_ok=True)
temp_file = GAMES_FILE.with_suffix(".download")
print(f"Downloading {USERNAME}'s {SPEEDS} games" + (f" since the newest saved one" if update else "") + "...")
count = download(temp_file)
new_games = read_games(temp_file)

if update:
    known = {g["id"] for g in existing}
    added = [g for g in new_games if g["id"] not in known]
    with open(GAMES_FILE, "a", encoding="utf-8") as f:
        for game in added:
            f.write(json.dumps(game) + "\n")
    temp_file.unlink()
    print(f"Added {len(added)} new games to {GAMES_FILE.name}.")
else:
    if GAMES_FILE.exists():
        backup = GAMES_FILE.with_name(f"games-backup-{date.today()}.ndjson")
        shutil.copy(GAMES_FILE, backup)
        print(f"Kept the old file as {backup.name}.")
    temp_file.replace(GAMES_FILE)  # only now, once the download has finished
    print(f"Saved {count} games to {GAMES_FILE.name}.")

games = read_games(GAMES_FILE)
analysed = sum(1 for g in games if g.get("analysis"))
by_speed: dict[str, int] = {}
for g in games:
    by_speed[g.get("speed", "?")] = by_speed.get(g.get("speed", "?"), 0) + 1
print(f"The file now has {len(games)} games ({by_speed}), {analysed} of them with computer analysis.")
