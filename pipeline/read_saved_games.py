from pathlib import Path
import json

output_path = Path(__file__).parent / "data" / "games.ndjson"

games = []
with open(output_path, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line:
            games.append(json.loads(line))

# print (games[0]["moves"])
# print(games[0]["analysis"])

# print(games[0])

for line in games[0]["analysis"]:
    if "judgment" in line:
        print(line)