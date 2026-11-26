"""content/kb/products.json: brands and product models people name instead of a kind of thing ("Rolex Submariner" for
a watch), written by hand from well-known product lines. Each brand lists the kinds of thing it is known for; each
model names its brand and what it is. Used by questions with an answer granularity (see validate.js):
  category questions ("Name something you wear"): a brand or model counts as the kind of thing it is, and scores as
    that thing (a Rolex Submariner is a watch). Specificity is accepted, never rewarded with extra rarity.
  brand questions ("Name a watch brand"): a model counts as its brand.
  model questions ("Name a luxury watch model"): a brand alone is asked to be made specific.
Run: python3 tools/content/products.py"""
import json, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
# brand: (kinds it is known for, other names). One kind = unambiguous; several = the player is asked which.
WEAR_BRANDS = {
 "Rolex": (["watch"], []), "Omega": (["watch"], []), "Patek Philippe": (["watch"], ["patek"]), "Audemars Piguet": (["watch"], ["ap"]),
 "TAG Heuer": (["watch"], ["tag"]), "Breitling": (["watch"], []), "Seiko": (["watch"], []), "Grand Seiko": (["watch"], []), "Citizen": (["watch"], []),
 "Casio": (["watch"], []), "Swatch": (["watch"], []), "Tissot": (["watch"], []), "Longines": (["watch"], []), "IWC": (["watch"], ["iwc schaffhausen"]),
 "Jaeger-LeCoultre": (["watch"], ["jlc"]), "Panerai": (["watch"], []), "Hublot": (["watch"], []), "Tudor": (["watch"], []),
 "Vacheron Constantin": (["watch"], []), "A. Lange & Söhne": (["watch"], ["a lange and sohne", "lange"]), "Richard Mille": (["watch"], []),
 "Zenith": (["watch"], []), "Bulova": (["watch"], []), "Timex": (["watch"], []), "Fossil": (["watch"], []), "Garmin": (["watch"], []),
 "Breguet": (["watch"], []), "Blancpain": (["watch"], []), "Oris": (["watch"], []), "Hamilton": (["watch"], []), "Movado": (["watch"], []),
 "Cartier": (["watch", "ring", "bracelet", "necklace"], []), "Bulgari": (["ring", "necklace", "watch"], ["bvlgari"]),
 "Tiffany": (["ring", "necklace", "bracelet"], ["tiffany and co", "tiffanys"]), "Pandora": (["bracelet", "ring"], []), "Swarovski": (["necklace", "earrings"], []),
 "Van Cleef & Arpels": (["necklace", "bracelet"], ["van cleef"]),
 "Nike": (["trainers", "hoodie", "t-shirt"], []), "Adidas": (["trainers", "tracksuit"], []), "Reebok": (["trainers"], []), "Puma": (["trainers"], []),
 "New Balance": (["trainers"], []), "Asics": (["trainers"], []), "Skechers": (["trainers"], []), "Vans": (["trainers"], []), "Hoka": (["trainers"], []),
 "Salomon": (["trainers", "hiking boots"], []), "On": (["trainers"], ["on running", "on cloud"]), "Fila": (["trainers"], []), "Saucony": (["trainers"], []),
 "Converse": (["converse"], []), "Dr. Martens": (["doc martens"], ["dr martens", "docs"]), "Timberland": (["boots"], ["timbs", "timberlands"]),
 "UGG": (["uggs"], ["ugg boots"]), "Crocs": (["crocs"], []), "Birkenstock": (["sandals"], ["birkenstocks", "birks"]), "Havaianas": (["flip-flops"], []),
 "Christian Louboutin": (["high heels"], ["louboutin", "louboutins"]), "Manolo Blahnik": (["high heels"], ["manolos"]), "Jimmy Choo": (["high heels"], []),
 "Clarks": (["shoe"], []), "Hush Puppies": (["shoe"], []), "Church's": (["brogues"], []), "Red Wing": (["boots"], []), "Hunter": (["wellies"], ["hunter boots"]),
 "Levi's": (["jeans"], ["levis", "levi strauss"]), "Wrangler": (["jeans"], []), "Lee": (["jeans"], []), "True Religion": (["jeans"], []),
 "Ray-Ban": (["sunglasses"], ["rayban", "ray bans"]), "Oakley": (["sunglasses"], []), "Persol": (["sunglasses"], []), "Warby Parker": (["glasses"], []),
 "Gucci": (["shoe", "belt", "sunglasses"], []), "Prada": (["shoe", "sunglasses"], []), "Louis Vuitton": (["belt", "scarf"], ["lv"]), "Chanel": (["jacket", "shoe"], []),
 "Hermès": (["scarf", "tie", "belt"], ["hermes"]), "Burberry": (["trench coat", "scarf"], []), "Versace": (["shirt"], []), "Dior": (["shoe", "dress"], ["christian dior"]),
 "Balenciaga": (["trainers", "hoodie"], []), "Armani": (["suit"], ["giorgio armani", "emporio armani"]), "Ralph Lauren": (["polo shirt"], ["polo ralph lauren"]),
 "Lacoste": (["polo shirt"], []), "Fred Perry": (["polo shirt"], []), "Tommy Hilfiger": (["shirt", "jacket"], []), "Calvin Klein": (["underpants", "jeans"], ["ck"]),
 "Supreme": (["hoodie", "t-shirt"], []), "Stone Island": (["jacket"], []), "Canada Goose": (["parka"], []), "Moncler": (["puffer jacket"], []),
 "The North Face": (["jacket", "puffer jacket"], ["north face", "tnf"]), "Patagonia": (["fleece", "jacket"], []), "Barbour": (["jacket"], []),
 "Arc'teryx": (["jacket"], ["arcteryx"]), "Columbia": (["jacket"], []), "Champion": (["hoodie", "sweatshirt"], []), "Carhartt": (["jacket", "beanie"], []),
 "Victoria's Secret": (["bra", "lingerie"], ["victorias secret"]), "Spanx": (["shapewear"], []), "Speedo": (["swimsuit", "swimming trunks"], []),
 "Stetson": (["cowboy hat"], []), "Kangol": (["flat cap", "beret"], []), "Borsalino": (["fedora"], []), "Uniqlo": (["t-shirt", "jacket"], []),
 "Zara": (["dress", "jacket"], []), "H&M": (["t-shirt", "dress"], ["h and m"]), "Gap": (["jeans", "hoodie"], []), "Hanes": (["t-shirt", "underpants"], []),
}
# model: (brand, what it is, other names)
WEAR_MODELS = {
 "Submariner": ("Rolex", "watch", ["sub"]), "Daytona": ("Rolex", "watch", ["cosmograph daytona"]), "Datejust": ("Rolex", "watch", []), "Day-Date": ("Rolex", "watch", ["president"]),
 "GMT-Master": ("Rolex", "watch", ["gmt master ii", "pepsi"]), "Explorer": ("Rolex", "watch", []), "Oyster Perpetual": ("Rolex", "watch", []), "Yacht-Master": ("Rolex", "watch", []),
 "Speedmaster": ("Omega", "watch", ["moonwatch", "speedy"]), "Seamaster": ("Omega", "watch", []), "Constellation": ("Omega", "watch", []),
 "Tank": ("Cartier", "watch", ["tank louis cartier", "tank francaise"]), "Santos": ("Cartier", "watch", []), "Ballon Bleu": ("Cartier", "watch", []), "Love bracelet": ("Cartier", "bracelet", []),
 "Royal Oak": ("Audemars Piguet", "watch", []), "Nautilus": ("Patek Philippe", "watch", []), "Aquanaut": ("Patek Philippe", "watch", []), "Calatrava": ("Patek Philippe", "watch", []),
 "Reverso": ("Jaeger-LeCoultre", "watch", []), "Carrera": ("TAG Heuer", "watch", []), "Monaco": ("TAG Heuer", "watch", []), "Navitimer": ("Breitling", "watch", []),
 "G-Shock": ("Casio", "watch", ["gshock"]), "F-91W": ("Casio", "watch", ["f91w"]), "Black Bay": ("Tudor", "watch", []), "Luminor": ("Panerai", "watch", []),
 "Big Bang": ("Hublot", "watch", []), "Overseas": ("Vacheron Constantin", "watch", []), "Portugieser": ("IWC", "watch", []), "Prospex": ("Seiko", "watch", []),
 "Apple Watch": ("Apple", "watch", []), "Fitbit": ("Fitbit", "watch", []), "Fenix": ("Garmin", "watch", []),
 "Air Force 1": ("Nike", "trainers", ["af1", "air forces"]), "Air Jordan": ("Nike", "trainers", ["jordans", "jordan 1", "air jordan 1"]), "Air Max": ("Nike", "trainers", ["air max 90", "air max 1"]),
 "Cortez": ("Nike", "trainers", []), "Dunk": ("Nike", "trainers", ["dunks", "sb dunk"]), "Blazer": ("Nike", "trainers", []),
 "Samba": ("Adidas", "trainers", ["sambas"]), "Stan Smith": ("Adidas", "trainers", []), "Superstar": ("Adidas", "trainers", []), "Gazelle": ("Adidas", "trainers", []),
 "Ultraboost": ("Adidas", "trainers", []), "Yeezy": ("Adidas", "trainers", ["yeezys"]), "Chuck Taylor All Star": ("Converse", "converse", ["chuck taylors", "chucks", "all star"]),
 "Old Skool": ("Vans", "trainers", []), "Sk8-Hi": ("Vans", "trainers", []), "Club C": ("Reebok", "trainers", []), "Suede": ("Puma", "trainers", []),
 "990": ("New Balance", "trainers", []), "550": ("New Balance", "trainers", []), "Gel-Lyte": ("Asics", "trainers", []),
 "1460": ("Dr. Martens", "doc martens", []), "Classic Short": ("UGG", "uggs", []), "501": ("Levi's", "jeans", ["501s"]),
 "Wayfarer": ("Ray-Ban", "sunglasses", ["wayfarers"]), "Aviator": ("Ray-Ban", "sunglasses", ["aviators"]), "Clubmaster": ("Ray-Ban", "sunglasses", []),
 "Holbrook": ("Oakley", "sunglasses", []), "Expedition Parka": ("Canada Goose", "parka", []), "Maya": ("Moncler", "puffer jacket", []),
 "Nuptse": ("The North Face", "puffer jacket", []), "Better Sweater": ("Patagonia", "fleece", []), "Bedale": ("Barbour", "jacket", []),
 "Birkin": ("Hermès", "bag", []), "Kelly": ("Hermès", "bag", []), "Speedy": ("Louis Vuitton", "bag", []), "Neverfull": ("Louis Vuitton", "bag", []),
 "Boston": ("Birkenstock", "clog", []), "Arizona": ("Birkenstock", "sandals", []),
}
out = {"wearables": {"brands": {k: {"makes": v[0], "al": v[1]} for k, v in WEAR_BRANDS.items()},
                     "models": {k: {"brand": v[0], "is": v[1], "al": v[2]} for k, v in WEAR_MODELS.items()}}}
json.dump(out, open(os.path.join(ROOT, "content", "kb", "products.json"), "w"), indent=0, ensure_ascii=False)
print(len(WEAR_BRANDS), "brands,", len(WEAR_MODELS), "models")
