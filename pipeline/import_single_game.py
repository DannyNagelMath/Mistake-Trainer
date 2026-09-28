import requests

game_id = "NQCR3D29"  # replace with a real id from one of your games
url = f"https://lichess.org/game/export/{game_id}"

headers = {"Accept": "application/json"}  # ask for JSON instead of PGN


response = requests.get(url, headers=headers)
# response = requests.get(url)

response.raise_for_status()  # raises an error if the request failed

# data = response.json()       # parses the JSON body into a Python dict
data = response.text

print(data)

# print(data)
# print(data.keys())
# for entry in data["analysis"]:
#     if "judgment" in entry:
#         print(entry)
