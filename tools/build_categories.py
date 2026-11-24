"""Build the category data: every recognised answer, its other names, its rules and an early-estimate share.

Recognition comes from four layers, merged here so the game can check answers instantly with no network:
  1. Hand-made core lists (the answers most people give), with hand-set shares for the most typical ones.
  2. WordNet (Princeton's English lexical database): every kind of animal, fruit, kitchen utensil or wheeled vehicle
     it knows, plus its synonym groups (car = auto = automobile). Only senses that are a word's main meaning are used,
     so "silver" isn't a kitchen object and "emperor" isn't a fruit.
  3. Hand-made lists WordNet lacks: car, motorbike and bike makes; models that count as their make.
  4. Category rules: breeds count as their animal, apple and grape varieties as the fruit, word forms in the SN round
     as one word, group words ("mammal") are too general, and at most 3 vehicle makes score per round.

Sample shares come from simulating players of the three-guess game (see simulate_three_guesses): each simulated
player can think of some answers, then picks up to three, mostly preferring their less obvious ideas. A share is the
fraction of players who gave that answer at least once. They are shown as sample data until real counts replace them.
Run with the project venv:  NLTK_ALLOW_PROXIED_URLOPEN=1 venv/bin/python tools/build_categories.py
(the first run downloads WordNet through nltk; the env var is only needed behind a proxy).
"""

import json
import math
import pathlib
import re

import nltk
import numpy as np
from english_words import get_english_words_set
from nltk.corpus import wordnet as wn
from wordfreq import zipf_frequency

OUT = pathlib.Path(__file__).resolve().parents[1] / "categories.json"

ANIMALS = """dog cat lion tiger elephant giraffe monkey zebra bear horse cow pig sheep goat chicken duck rabbit mouse rat
fox wolf deer moose elk bison buffalo camel llama alpaca kangaroo koala panda polar bear grizzly bear black bear
hippo rhino gorilla chimpanzee orangutan baboon lemur sloth armadillo anteater aardvark hedgehog porcupine squirrel
chipmunk beaver otter sea otter raccoon skunk badger weasel ferret mink wolverine hyena cheetah leopard jaguar puma
cougar lynx bobcat ocelot meerkat mongoose warthog wild boar hamster guinea pig gerbil chinchilla bat mole shrew
opossum platypus echidna wombat tasmanian devil dingo jackal coyote antelope gazelle impala gnu wildebeest okapi tapir
yak ox donkey mule pony seal sea lion walrus whale dolphin orca narwhal beluga manatee dugong shark octopus squid
jellyfish starfish crab lobster shrimp clam oyster snail slug worm frog toad salamander newt axolotl turtle tortoise
lizard gecko iguana chameleon komodo dragon crocodile alligator snake python cobra rattlesnake anaconda viper boa
eagle hawk falcon owl parrot penguin flamingo ostrich emu peacock swan goose pigeon dove crow raven sparrow robin
hummingbird woodpecker seagull pelican stork heron crane toucan kiwi turkey vulture albatross puffin bluejay cardinal
canary finch magpie kingfisher fish goldfish salmon tuna cod trout catfish clownfish piranha eel stingray seahorse
pufferfish swordfish barracuda anchovy sardine bee wasp ant butterfly moth beetle ladybug spider scorpion grasshopper
cricket dragonfly mosquito fly cockroach termite caterpillar centipede millipede tick flea firefly praying mantis
hornet snow leopard red panda capybara quokka pangolin numbat blobfish nudibranch mantis shrimp sea cucumber
sea urchin coral hermit crab manta ray hammerhead shark great white shark killer whale blue whale humpback whale
reindeer caribou ibex chamois markhor gibbon tarsier aye-aye fennec fox arctic fox kinkajou coati binturong
serval caracal saiga quoll bilby tamarin marmoset capuchin mandrill okapi zebu water buffalo""".split("\n")

ANIMAL_MULTI = ["polar bear", "grizzly bear", "black bear", "sea otter", "wild boar", "guinea pig", "tasmanian devil",
                "sea lion", "komodo dragon", "praying mantis", "snow leopard", "red panda", "mantis shrimp",
                "sea cucumber", "sea urchin", "hermit crab", "manta ray", "hammerhead shark", "great white shark",
                "killer whale", "blue whale", "humpback whale", "fennec fox", "arctic fox", "water buffalo"]

FRUITS = ["apple", "banana", "orange", "strawberry", "grape", "watermelon", "pineapple", "mango", "peach", "pear",
          "cherry", "blueberry", "raspberry", "blackberry", "lemon", "lime", "kiwi", "plum", "apricot", "coconut",
          "papaya", "cantaloupe", "honeydew", "melon", "pomegranate", "grapefruit", "tangerine", "clementine",
          "mandarin", "nectarine", "fig", "date", "cranberry", "avocado", "tomato", "guava", "passion fruit",
          "dragon fruit", "lychee", "persimmon", "quince", "kumquat", "rambutan", "durian", "jackfruit", "starfruit",
          "pomelo", "gooseberry", "elderberry", "boysenberry", "mulberry", "currant", "blackcurrant", "redcurrant",
          "loganberry", "huckleberry", "cloudberry", "lingonberry", "acai", "goji berry", "olive", "plantain",
          "breadfruit", "soursop", "custard apple", "cherimoya", "longan", "mangosteen", "salak", "tamarind",
          "feijoa", "yuzu", "blood orange", "ugli fruit", "sapodilla", "chikoo", "jabuticaba", "physalis",
          "kiwano", "horned melon", "rhubarb", "prune", "raisin", "sultana", "crabapple", "medlar", "loquat",
          "ackee", "noni", "marula", "bilberry", "dewberry", "serviceberry", "pawpaw", "persimmon", "satsuma",
          "bergamot", "citron", "key lime", "cactus pear", "prickly pear", "jujube"]

KITCHEN = ["fridge", "refrigerator", "oven", "stove", "microwave", "sink", "dishwasher", "toaster", "kettle", "blender",
           "pan", "pot", "frying pan", "saucepan", "knife", "fork", "spoon", "plate", "bowl", "cup", "mug", "glass",
           "cutting board", "spatula", "whisk", "ladle", "tongs", "peeler", "grater", "colander", "strainer",
           "can opener", "bottle opener", "corkscrew", "rolling pin", "measuring cup", "measuring spoon", "mixing bowl",
           "baking sheet", "baking tray", "oven mitt", "pot holder", "apron", "towel", "dish towel", "sponge",
           "dish soap", "trash can", "bin", "recycling bin", "cabinet", "cupboard", "drawer", "counter", "countertop",
           "table", "chair", "stool", "freezer", "coffee maker", "coffee machine", "air fryer", "rice cooker",
           "slow cooker", "pressure cooker", "food processor", "mixer", "stand mixer", "hand mixer", "scale",
           "timer", "thermometer", "napkin", "paper towel", "foil", "aluminum foil", "plastic wrap", "cling film",
           "tupperware", "container", "jar", "lid", "teapot", "chopsticks", "skewer", "wok", "griddle", "grill",
           "salt", "pepper", "salt shaker", "pepper grinder", "spice rack", "oil", "sugar", "flour", "butter", "egg",
           "bread", "milk", "cereal", "fruit bowl", "toothpick", "zester", "mandoline", "mortar", "pestle",
           "sieve", "funnel", "pitcher", "jug", "carafe", "thermos", "water bottle", "lunchbox", "placemat",
           "coaster", "tablecloth", "dish rack", "drying rack", "faucet", "tap", "garbage disposal", "range hood",
           "light", "outlet", "calendar", "magnet", "fridge magnet", "cookbook", "recipe", "broom", "mop", "dustpan",
           "fire extinguisher", "smoke detector", "ice tray", "ice cube tray", "ice maker", "cookie cutter",
           "muffin tin", "cake pan", "pie dish", "casserole dish", "dutch oven", "steamer", "pizza cutter",
           "pizza stone", "garlic press", "nutcracker", "egg timer", "kitchen scissors", "scissors", "baster",
           "brush", "pastry brush", "piping bag", "sifter", "waffle iron", "juicer", "toaster oven", "hot plate"]

WHEELS = ["car", "bike", "bicycle", "bus", "truck", "motorcycle", "skateboard", "scooter", "train", "tractor",
          "wagon", "cart", "shopping cart", "wheelbarrow", "wheelchair", "stroller", "pram", "tricycle", "unicycle",
          "van", "taxi", "ambulance", "fire truck", "police car", "airplane", "plane", "jet", "helicopter",
          "roller skate", "rollerblade", "inline skate", "suitcase", "luggage", "office chair", "chair", "trolley",
          "tram", "streetcar", "subway", "forklift", "bulldozer", "excavator", "crane", "dump truck", "cement mixer",
          "garbage truck", "limousine", "limo", "jeep", "suv", "pickup truck", "go-kart", "golf cart", "atv",
          "quad bike", "dirt bike", "moped", "segway", "hoverboard", "rickshaw", "carriage", "stagecoach", "chariot",
          "trailer", "caravan", "rv", "camper", "tank", "skateboard", "longboard", "toy car", "monster truck",
          "race car", "tow truck", "steamroller", "snowplow", "lawn mower", "hand truck", "dolly", "gurney",
          "hospital bed", "baby walker", "pram", "trolley bus", "food truck", "ice cream truck", "school bus",
          "double-decker bus", "minivan", "convertible", "sports car", "semi truck", "18-wheeler", "lorry",
          "pizza cutter", "ferris wheel", "roulette wheel", "spinning wheel", "pottery wheel", "hamster wheel",
          "mill", "watermill", "windmill", "clock", "steering wheel", "lazy susan", "rolling pin", "zamboni",
          "penny-farthing", "tuk tuk", "wheelie bin", "roller coaster", "cannon", "wheel loader", "skateboard truck",
          "baby walker", "toy train", "remote control car", "rc car", "lawnmower", "wheelbarrow", "trolley jack"]

ALIASES = {
    "animals": {"hippo": ["hippopotamus"], "rhino": ["rhinoceros"], "orca": ["killer whale"],
                "puma": ["cougar", "mountain lion"], "gnu": ["wildebeest"], "bison": ["american buffalo"],
                "ladybug": ["ladybird"], "chimpanzee": ["chimp"], "orangutan": ["orangutang"],
                "bluejay": ["blue jay"], "seagull": ["gull"], "dragonfly": ["dragon fly"],
                "praying mantis": ["mantis"], "great white shark": ["great white"], "cat": ["kitten", "kitty", "kitty cat", "siamese", "siamese cat", "persian", "persian cat", "maine coon", "tabby", "tabby cat", "ragdoll", "sphynx", "sphynx cat", "tomcat", "moggy"],
                "dog": ["puppy", "pup", "doggo", "pupper", "lab", "labrador", "pitbull", "pit bull", "husky", "golden retriever", "german shepherd", "chihuahua", "corgi", "beagle", "dachshund", "wiener dog", "sausage dog", "poodle", "pug", "bulldog", "french bulldog", "rottweiler", "doberman", "shih tzu", "yorkie", "border collie", "collie", "greyhound", "dalmatian"],
                "rabbit": ["bunny", "hare"], "pig": ["hog", "piglet", "swine", "boar"], "cow": ["cattle", "calf", "heifer", "bull", "ox", "steer"],
                "horse": ["stallion", "mare", "foal", "colt", "filly"], "sheep": ["lamb", "ewe", "ram"], "goat": ["kid goat", "billy goat", "nanny goat"],
                "chicken": ["chick", "hen", "rooster", "cockerel", "chook", "bantam"], "duck": ["duckling", "drake", "mallard"], "goose": ["gosling", "gander"],
                "swan": ["cygnet"], "frog": ["tadpole", "polliwog"], "kangaroo": ["joey", "roo"], "seahorse": ["sea horse"],
                "tyrannosaurus": ["t rex", "trex", "t-rex", "tyrannosaurus rex"], "deer": ["fawn", "doe", "stag", "buck"], "raccoon": ["racoon"], "porcupine": ["porky"]},
    "fruits": {"watermelon": ["water melon"], "cantaloupe": ["rockmelon"], "starfruit": ["carambola", "star fruit"],
               "dragon fruit": ["pitaya", "pitahaya"], "kiwi": ["kiwifruit", "kiwi fruit"],
               "passion fruit": ["passionfruit", "maracuya"], "tangerine": [], "chikoo": ["sapota", "chiku"],
               "physalis": ["cape gooseberry", "groundcherry", "ground cherry"], "lychee": ["litchi", "lichee"],
               "cactus pear": ["prickly pear"], "pawpaw": [], "papaya": ["papaw"], "acai": ["acai berry"],
               "kiwano": ["horned melon"], "apple": ["granny smith", "honeycrisp", "fuji", "fuji apple", "gala", "gala apple", "pink lady", "braeburn", "golden delicious", "red delicious", "jazz apple", "cosmic crisp", "mcintosh", "envy apple", "green apple", "red apple"], "blackcurrant": ["black currant"], "redcurrant": ["red currant"]},
    "kitchen": {"pressure cooker": ["instant pot", "instapot"], "stand mixer": ["kitchenaid", "kitchen aid"], "fridge": ["refrigerator"], "trash can": ["garbage can", "bin", "rubbish bin"],
                "faucet": ["tap"], "cupboard": ["cabinet"], "plastic wrap": ["cling film", "saran wrap"],
                "aluminum foil": ["foil", "tin foil", "aluminium foil"], "frying pan": ["skillet", "fry pan"],
                "oven mitt": ["oven glove", "pot holder"], "dish towel": ["tea towel"],
                "tupperware": ["food container", "container"], "coffee maker": ["coffee machine", "coffee pot"],
                "kettle": ["electric kettle"], "colander": ["strainer"], "range hood": ["extractor fan"],
                "ice cube tray": ["ice tray"], "kitchen scissors": ["scissors", "shears"], "counter": ["countertop"]},
    "wheels": {"bike": ["bicycle", "push bike"], "airplane": ["plane", "aeroplane", "jet"], "stroller": ["pram", "buggy", "pushchair"],
               "shopping cart": ["shopping trolley", "trolley"], "limousine": ["limo"], "go-kart": ["go kart", "gokart", "kart"],
               "semi truck": ["18-wheeler", "eighteen wheeler", "lorry", "semi", "big rig"], "rv": ["camper", "motorhome", "caravan"],
               "rollerblade": ["inline skate", "roller blade"], "roller skate": ["rollerskate"], "subway": ["metro", "underground", "tube"],
               "tram": ["streetcar", "trolley car"], "atv": ["quad bike", "four wheeler", "quad"], "suitcase": ["luggage", "rolling suitcase"],
               "taxi": ["cab"], "dolly": ["hand truck"], "fire truck": ["fire engine"], "dump truck": ["tipper truck"],
               "motorcycle": ["motorbike"], "suv": ["sport utility vehicle"], "penny-farthing": ["penny farthing", "high wheeler"],
               "tuk tuk": ["tuk-tuk", "tuktuk", "auto rickshaw", "autorickshaw"], "wheelie bin": ["wheely bin", "rolling bin"],
               "remote control car": ["rc car", "radio controlled car"], "zamboni": ["ice resurfacer"], "lawn mower": ["lawnmower", "mower"]},
}

TOP = {  # hand-set early estimates for the most typical answers (share of players)
    "animals": {"insect": .04, "bug": .03, "dinosaur": .02, "kangaroo": .11, "panda": .11, "bird": .1, "fish": .1, "duck": .09, "chicken": .09, "sheep": .08, "goat": .07, "koala": .07, "hippo": .07, "rhino": .06, "deer": .06, "frog": .06, "turtle": .06, "whale": .06, "owl": .05, "eagle": .05, "squirrel": .05, "gorilla": .05, "cheetah": .05, "crocodile": .05, "alligator": .04, "camel": .04, "octopus": .04, "parrot": .04, "spider": .04, "bee": .04, "butterfly": .04, "hamster": .04, "leopard": .03, "jellyfish": .03, "ant": .03, "seal": .03, "otter": .03, "hedgehog": .03, "sloth": .03, "llama": .03, "flamingo": .03, "lizard": .03, "dog": .74, "cat": .72, "lion": .55, "elephant": .5, "tiger": .45, "giraffe": .4, "monkey": .36,
                "zebra": .3, "bear": .3, "horse": .28, "cow": .26, "pig": .24, "snake": .2, "shark": .18,
                "dolphin": .16, "rabbit": .16, "mouse": .14, "fox": .13, "wolf": .13, "penguin": .12},
    "fruits": {"melon": .07, "avocado": .06, "papaya": .06, "pomegranate": .06, "blackberry": .06, "apricot": .05, "grapefruit": .05, "tangerine": .04, "cantaloupe": .04, "fig": .04, "date": .03, "cranberry": .03, "nectarine": .03, "passion fruit": .03, "dragon fruit": .03, "lychee": .03, "tomato": .03, "guava": .025, "clementine": .025, "olive": .02, "apple": .78, "banana": .71, "orange": .55, "strawberry": .4, "grape": .33, "watermelon": .3,
               "pineapple": .27, "mango": .22, "peach": .2, "pear": .2, "cherry": .18, "blueberry": .16,
               "lemon": .14, "kiwi": .13, "raspberry": .12, "plum": .1, "coconut": .09, "lime": .08},
    "kitchen": {"freezer": .09, "cabinet": .09, "drawer": .07, "counter": .07, "chair": .07, "glass": .07, "mug": .06, "cutting board": .06, "whisk": .06, "ladle": .05, "napkin": .05, "towel": .05, "trash can": .05, "coffee maker": .05, "air fryer": .04, "tongs": .04, "grater": .04, "peeler": .04, "colander": .03, "rolling pin": .03, "sponge": .03, "salt": .03, "pepper": .03, "frying pan": .03, "oven mitt": .03, "chopsticks": .02, "fridge": .62, "oven": .45, "stove": .4, "microwave": .4, "sink": .38, "knife": .32, "fork": .3,
                "spoon": .3, "plate": .26, "pan": .25, "pot": .24, "toaster": .2, "dishwasher": .18, "bowl": .18,
                "cup": .17, "kettle": .14, "blender": .12, "table": .11, "spatula": .1},
    "wheels": {"car": .82, "skateboard": .3, "rollerblade": .06, "roller skate": .06, "suitcase": .06, "office chair": .06, "golf cart": .05, "go-kart": .05, "fire truck": .05, "ambulance": .05, "tricycle": .05, "unicycle": .04, "trailer": .04, "cart": .04, "jeep": .03, "rv": .03, "police car": .03, "moped": .03, "trolley": .02, "tank": .02, "lawn mower": .02, "car": .82, "bike": .65, "bus": .5, "truck": .45, "motorcycle": .32, "skateboard": .3,
               "train": .25, "scooter": .25, "wagon": .12, "tractor": .12, "wheelchair": .12, "shopping cart": .1,
               "van": .1, "airplane": .09, "stroller": .08, "wheelbarrow": .07, "taxi": .06},
    "sn": {"snowflake": .06, "snatch": .05, "snapper": .02, "snicker": .03, "sniffle": .03, "snowboard": .06, "snowstorm": .04, "snowfall": .03, "snooker": .02, "snob": .03, "snag": .03, "snare": .02, "sneer": .02, "snipe": .02, "sniper": .04, "snuggle": .04, "snobby": .02, "snake": .55, "snow": .5, "snack": .42, "snail": .35, "sneeze": .3, "snap": .25, "sneaker": .22,
           "snore": .2, "sniff": .15, "snowman": .15, "snot": .14, "snitch": .12, "snowball": .12, "sneak": .12,
           "snorkel": .08, "snooze": .08, "snug": .06, "snout": .06},
}

BLURBS = {
    "rambutan": "hairy red fruit from Southeast Asia", "mangosteen": "purple fruit with sweet white segments",
    "feijoa": "green fruit popular in New Zealand", "chikoo": "brown, sweet fruit common in India",
    "jabuticaba": "Brazilian grape-like fruit that grows on the trunk", "salak": "snake fruit, scaly skin",
    "loquat": "small orange fruit, tastes like apricot", "soursop": "spiky green fruit, creamy inside",
    "ackee": "Jamaica's national fruit", "marula": "African fruit, used in a famous cream liqueur",
    "axolotl": "Mexican salamander that keeps its gills", "quokka": "tiny smiling wallaby from Australia",
    "nudibranch": "brightly coloured sea slug", "binturong": "bearcat that smells like popcorn",
    "saiga": "antelope with a big floppy nose", "kinkajou": "rainforest relative of the raccoon",
    "pangolin": "scaly anteater", "markhor": "wild goat with corkscrew horns", "aye-aye": "lemur with a long thin finger",
    "snorkel": "breathing tube for swimming", "snafu": "a messed-up situation", "snood": "a hood or loose net for hair",
    "mandoline": "slicer with a sharp blade", "zester": "tool for peeling citrus skin", "lazy susan": "spinning tray on a table",
}

CATEGORIES = [
    # key, short title, icon name in icons.js (custom SVG, never platform emoji), the question, a one-line hint.
    ("animals", "Animals", "animals", "Name an animal", "Any real animal: mammals, birds, fish, insects."),
    ("fruits", "Fruits", "fruits", "Name a fruit", "Anything sold or eaten as a fruit."),
    ("kitchen", "In a kitchen", "kitchen", "Name something in a kitchen", "Tools, appliances, dishes, furniture."),
    ("sn", "SN words", "sn", "Name a word that starts with SN", "Any real English word."),
    ("wheels", "On wheels", "wheels", "Name something with wheels", "Vehicles, toys, furniture, machines."),
]

# What players see under "How answers are judged" on the results screen.
RULES = {
    "animals": ["Any real animal counts, including insects, fish and birds.",
                "Breeds count as their animal: poodle is dog, Siamese is cat.",
                "Group words like mammal or reptile are too general."],
    "fruits": ["Anything sold or eaten as a fruit, including berries and botanical fruits like tomato.",
               "Varieties count as their fruit: Granny Smith is apple."],
    "kitchen": ["Objects you'd find in a kitchen: tools, appliances, dishes, furniture.",
                "Different names for one thing count once: fridge and refrigerator."],
    "sn": ["Any real English word that starts with SN.",
           "Forms of one word count once: snap, snaps, snapped and snapping."],
    "wheels": ["Vehicles, toys, furniture or machines that have wheels.",
               "Car and bike makes count. Models count as their make: Mustang is Ford.",
               "Different names for one thing count once: car and automobile."],
}

# WordNet subtrees that hold each category's answers.
WN_ROOTS = {
    "animals": ["chordate.n.01", "invertebrate.n.01"],
    "fruits": ["edible_fruit.n.01", "berry.n.01", "berry.n.02"],
    "kitchen": ["kitchen_utensil.n.01", "kitchen_appliance.n.01", "cooking_utensil.n.01", "tableware.n.01",
                "crockery.n.01", "cutlery.n.02", "drinking_vessel.n.01", "cookware.n.01"],
    "wheels": ["wheeled_vehicle.n.01"],
}
# Everything under these counts as the named core answer (breeds, varieties).
COLLAPSE = {
    "animals": {"dog.n.01": "dog", "domestic_cat.n.01": "cat", "cattle.n.01": "cow", "domestic_goat.n.01": "goat",
                "domestic_sheep.n.01": "sheep", "chicken.n.02": "chicken", "hog.n.03": "pig"},
    "fruits": {"apple.n.01": "apple", "grape.n.01": "grape", "pear.n.01": "pear", "sweet_cherry.n.01": "cherry"},
}
# Kept as their own answer even though they sit under a collapsed group.
COLLAPSE_KEEP = {"animals": {"wolf", "dingo", "coyote", "jackal", "fox", "pony", "bull", "ox", "zebu", "yak", "rooster", "hen"},
                 "fruits": {"crabapple", "crab apple"}}
# Group words: real answers in a loose sense, but too general to reward.
TOO_GENERAL = {
    "animals": {"animal", "mammal", "vertebrate", "invertebrate", "chordate", "reptile", "amphibian", "arthropod",
                "creature", "beast", "critter", "placental", "carnivore", "herbivore", "omnivore", "predator", "prey",
                "pet", "pest", "young", "larva", "invertebrate", "insectivore", "ungulate", "rodent", "primate",
                "marsupial", "crustacean", "mollusk", "mollusc", "cephalopod", "bivalve", "gastropod", "feline",
                "canine", "bovine", "equine", "male", "female", "baby"},
    "fruits": {"fruit", "edible fruit", "berry", "citrus", "citrus fruit", "drupe", "pome", "melon"},
    "kitchen": {"utensil", "kitchen utensil", "appliance", "kitchen appliance", "tableware", "cookware", "crockery",
                "cutlery", "silverware", "dish", "dishes", "thing", "stuff"},
    "wheels": {"vehicle", "wheeled vehicle", "wheel", "wheels", "transport", "transportation", "machine"},
}
# Common wrong answers worth catching outright (they'd otherwise wait for review).
NOT_IN = {
    "animals": {"unicorn", "dragon", "mermaid", "phoenix", "griffin", "yeti", "bigfoot", "human", "person", "tree", "plant", "flower"},
    "fruits": {"carrot", "potato", "lettuce", "broccoli", "onion", "cabbage", "spinach", "celery", "corn", "nut", "peanut", "almond", "walnut"},
    "wheels": {"boat", "ship", "sled", "sledge", "horse", "canoe", "kayak", "sailboat", "submarine", "rocket", "glider", "snowboard", "ski", "skis"},
}
# Not in WordNet: makes, with the models that count as them.
MAKES = {
    "Ferrari": ["enzo", "testarossa", "laferrari"], "Lamborghini": ["lambo", "countach", "aventador", "huracan", "diablo", "urus"],
    "Porsche": ["911", "cayenne", "boxster", "taycan"], "Toyota": ["prius", "corolla", "camry", "supra", "rav4", "tacoma"],
    "Honda": ["civic", "accord"], "Ford": ["mustang", "f-150", "f150", "model t", "bronco", "fiesta", "focus"],
    "Chevrolet": ["chevy", "corvette", "camaro", "impala", "silverado"], "BMW": ["beemer"], "Mercedes": ["mercedes-benz", "mercedes benz", "benz", "merc"],
    "Audi": [], "Volkswagen": ["vw", "volkswagen beetle", "vw beetle", "beetle", "golf gti", "vw bus"], "Tesla": ["model s", "model 3", "model x", "model y", "cybertruck"],
    "Nissan": ["gt-r", "skyline"], "Hyundai": [], "Kia": [], "Mazda": ["miata"], "Subaru": ["impreza"], "Mitsubishi": [], "Lexus": [],
    "Dodge": ["charger", "challenger", "viper"], "Chrysler": [], "Cadillac": ["caddy", "escalade"], "Buick": [], "GMC": [], "Lincoln": [],
    "Jaguar": ["jag"], "Land Rover": ["range rover", "defender"], "Mini": ["mini cooper"], "Volvo": [], "Saab": [], "Fiat": [], "Alfa Romeo": [],
    "Maserati": [], "Bugatti": ["veyron", "chiron"], "McLaren": [], "Aston Martin": [], "Bentley": [], "Rolls-Royce": ["rolls royce", "rolls"],
    "Lotus": [], "Peugeot": [], "Renault": [], "Citroen": [], "Skoda": [], "Opel": [], "Vauxhall": [], "Suzuki": [], "Isuzu": [], "Acura": [],
    "Infiniti": [], "Rivian": [], "Lucid": [], "Polestar": [], "Pagani": [], "Koenigsegg": [], "Lada": [], "Tata": [], "Mahindra": [], "BYD": [],
    "Datsun": [], "Pontiac": ["firebird", "trans am"], "Oldsmobile": [], "Plymouth": [], "Hummer": [], "DeLorean": [], "Smart car": ["smart fortwo"],
    "Holden": [], "Daewoo": [], "Studebaker": [], "Harley-Davidson": ["harley", "harley davidson"], "Ducati": [], "Yamaha": [], "Kawasaki": [],
    "Triumph": [], "KTM": [], "Aprilia": [], "Vespa": [], "Schwinn": [], "Trek": [], "Cannondale": [], "Brompton": [], "Huffy": [],
    "Mack truck": ["mack"], "Peterbilt": [], "Kenworth": [], "Freightliner": [], "John Deere": ["deere"], "Hot Wheels": [], "Matchbox car": ["matchbox"],
    "Tonka truck": ["tonka"],
}
# WordNet synonym groups where a different core answer should be the canonical one.
PREFER = {"baby_buggy.n.01": "stroller", "hand_truck.n.01": "dolly", "streetcar.n.01": "tram"}
# Ambiguous words WordNet files under a category by a minor sense ("admiral" the butterfly, "boat" the gravy boat).
STOP = {
    "animals": {"admiral", "argentine", "billy", "brent", "charger", "chat", "das", "entire", "fetus", "jenny", "livestock",
                "molly", "mount", "queen", "royal", "sierra", "soldier", "stint", "tom", "sire", "dam", "humans", "pup",
                "game", "stock", "stray", "mutt", "mongrel", "worker", "drone", "racer", "pacer", "trotter", "stepper",
                "pointer", "setter", "springer", "boxer", "hound", "toy", "bantam", "layer", "broiler", "fryer", "roaster",
                "capon", "nanny", "kid", "lamb", "calf", "foal", "cub", "joey", "whelp", "fawn", "kit", "chick", "duckling",
                "leveret", "gosling", "cygnet", "eaglet", "owlet", "tadpole", "polliwog", "grub", "maggot", "nymph", "pupa"},
    "fruits": {"emperor", "muscat", "concord", "catawba", "delaware", "date plum"},
    "kitchen": {"boat", "toby", "service", "setting", "crystal", "silver", "plate", "gold plate", "potbelly", "range", "boiler"},
    "wheels": {"electric", "technical", "clarence", "used-car", "berlin", "remise", "sleeper", "racer", "transporter", "machine"},
}
# Extra core answers WordNet doesn't need to find.
EXTRA_CORE = {"animals": ["bird", "insect", "bug", "dinosaur", "tyrannosaurus"], "wheels": ["bmx", "hoverboard", "scooter", "e-scooter", "electric scooter", "pedal car", "baby stroller"],
              "sn": ["snarky", "snuggly", "snowblower", "snowshoe", "snow cone", "snowplow", "snowmobile", "snowboarder", "snowstorm"]}

SIM_PLAYERS = 240_000      # players simulated to estimate shares
SAMPLE_PLAYERS = 50_000    # the population the game displays with sample data; no share goes below 1 player of this
PREFIX = {"sn": "sn"}





def zipf_estimate(term: str) -> float:
    z = zipf_frequency(term, "en")
    if " " in term or "-" in term:
        z -= 1.2  # multi-word phrases are scored too generously by wordfreq
    return z


def curve(z: float) -> float:
    return 1 / (1 + math.exp(-(z - 4.6) * 1.6))


def clean(lemma: str) -> str:
    return lemma.replace("_", " ").lower().strip()


def subtree(names):
    seen = []
    for n in names:
        root = wn.synset(n)
        for s in [root] + list(root.closure(lambda s: s.hyponyms())):
            if s not in seen:
                seen.append(s)
    return seen


def main_sense(lemma: str, synset, allowed: set) -> bool:
    """Only accept a single word when this category is (one of) its main meanings."""
    if "_" in lemma or "-" in lemma:
        return True
    senses = wn.synsets(lemma, "n")
    return any(s in allowed for s in senses[:2]) and (senses[0] in allowed or len(senses) <= 3)


def gloss(synset) -> str:
    text = synset.definition().split(";")[0].strip()
    return text if 12 <= len(text) <= 80 else ""


def wordnet_rows(key: str, core: dict):
    """Returns extra answers {name: (share_guess, synonyms, blurb)} and aliases pointing into core answers."""
    if key not in WN_ROOTS:
        return {}, {}
    synsets = subtree(WN_ROOTS[key])
    allowed = set(synsets)
    collapse_into = {}
    for root, target in COLLAPSE.get(key, {}).items():
        for s in [wn.synset(root)] + list(wn.synset(root).closure(lambda s: s.hyponyms())):
            collapse_into.setdefault(s, target)
    keep = COLLAPSE_KEEP.get(key, set())
    general = TOO_GENERAL.get(key, set()) | STOP.get(key, set())
    hand_aliases = {a for v in ALIASES.get(key, {}).values() for a in v}
    taken = core | hand_aliases  # never re-point a core answer or a hand-made alias
    extra, into_core = {}, {}
    for s in synsets:
        names = [clean(l) for l in s.lemma_names()]
        ok = [n for n, l in zip(names, s.lemma_names()) if n not in general and (l[0].islower() or s in collapse_into) and main_sense(l, s, allowed)]
        if not ok:
            continue
        target = collapse_into.get(s)
        if target and not any(n in keep for n in ok):
            for n in ok:
                if n != target and n not in taken:
                    into_core.setdefault(target, set()).add(n)
            continue
        # One answer per synonym group. Prefer a name already in the core list, else the most common name.
        in_core = [n for n in ok if n in core]
        if in_core:
            head_name = clean(s.name().split(".")[0])
            target = PREFER.get(s.name()) or (head_name if head_name in in_core else in_core[0])
            for n in ok:
                if n != target and n not in taken:
                    into_core.setdefault(target, set()).add(n)
            continue
        if any(n in taken for n in ok):
            continue  # a group overlapping a hand-made alias (caravan = rv) is already covered
        ok = [n for n in ok if len(n) <= 28 and zipf_estimate(n) >= 0.3]
        if not ok:
            continue
        head = max(ok, key=lambda n: zipf_estimate(n))
        if head in extra:
            continue
        others = [n for n in ok if n != head]
        extra[head] = (zipf_estimate(head), others, gloss(s))
    return extra, into_core


INFLECTIONS = ("s", "es", "ed", "d", "ing", "er", "ers")


def sn_words() -> tuple[list[str], dict]:
    """Every dictionary word starting with SN; inflected forms (snapped, snapping) fold into their base word.
    A word counts if a dictionary (web2 or WordNet) has it, so names (Snowden) and brands (Snapchat) wait for review."""
    from wordfreq import top_n_list
    web2 = {w for w in get_english_words_set(["web2"], lower=True) if w.startswith("sn")}
    lemmas = {clean(l) for s in wn.all_synsets() for l in s.lemma_names() if l.lower().startswith("sn") and l[0].islower()}
    dictionary = {w for w in web2 | lemmas if re.fullmatch(r"[a-z]+", w)}
    common = [w for w in top_n_list("en", 500000) if w.startswith("sn") and w.isalpha()]

    def base_of(w):
        for pos in ("v", "n", "a"):
            b = wn.morphy(w, pos)
            if b and b != w and b in dictionary:
                return b
        return None

    bases = {}
    for w in dictionary | set(common):
        b = base_of(w)
        if b:
            bases[w] = b
    words = {w for w in dictionary if w not in bases}  # rare but real words count: that's the point of the game
    words |= set(TOP["sn"]) | {w for w in EXTRA_CORE["sn"] if " " not in w}
    aliases = {}
    for f, b in bases.items():
        if b in words:
            aliases.setdefault(b, set()).add(f)
    return sorted(words), aliases


def build(key: str, answers: list[str], extra_aliases: dict | None = None) -> list[dict]:
    aliases = {k: list(v) for k, v in ALIASES.get(key, {}).items()}
    for k, v in (extra_aliases or {}).items():
        aliases.setdefault(k, [])
        aliases[k] += [x for x in v if x not in aliases[k]]
    alias_targets = {a for v in aliases.values() for a in v}
    canon, seen = [], set()
    for a in answers:
        a = a.strip().lower()
        if not a or a in seen or (a in alias_targets and a not in aliases):
            continue
        seen.add(a)
        canon.append(a)
    top = TOP.get(key, {})
    rows = []
    for a in canon:
        share = top.get(a, min(0.09, 0.25 * curve(zipf_estimate(a))))
        rows.append({"a": a, "s": share, "al": sorted(set(aliases.get(a, [])) - {a}), **({"b": BLURBS[a]} if a in BLURBS else {})})
    # Scale the long tail so an average player names about 7 answers per round.
    fixed = sum(r["s"] for r in rows if r["a"] in top)
    tail = [r for r in rows if r["a"] not in top]
    tail_sum = sum(r["s"] for r in tail) or 1
    factor = max(1.2, 7.0 - fixed) / tail_sum  # the long tail always keeps some weight, or rare answers collapse to the floor
    for r in tail:
        r["s"] = min(0.09, r["s"] * factor)
    for r in rows:
        r["s"] = round(max(r["s"], 0.0003), 5)
    return rows, factor


def simulate_three_guesses(recall, seed=7):
    """Sample statistics for the three-guess game.

    recall[i] is how readily answer i comes to mind (the old "named within 20 seconds" estimate). Each simulated player
    knows answer i with a somewhat higher probability (there is no clock now), takes 1 to 3 guesses, and chooses among
    what they know in one of three styles: the obvious ones, any of them, or the rarest they can think of.
    Returns the fraction of players who gave each answer at least once (these add up to about 2.7, not 1).
    """
    rng = np.random.default_rng(seed)
    p = np.asarray(recall, dtype=float)
    n = len(p)
    know_p = 1 - (1 - p) ** 1.6
    counts = np.zeros(n)
    for start in range(0, SIM_PLAYERS, 4000):
        m = min(4000, SIM_PLAYERS - start)
        know = rng.random((m, n)) < know_p
        guesses = rng.choice([3, 2, 1], size=m, p=[0.8, 0.12, 0.08])
        style = rng.choice(3, size=m, p=[0.35, 0.35, 0.30])[:, None]
        logw = np.where(style == 0, np.log(p)[None, :], np.where(style == 1, 0.0, -0.7 * np.log(p)[None, :]))
        key = np.where(know, logw + rng.gumbel(size=(m, n)), -np.inf)   # Gumbel top-k = weighted picks without repeats
        top = np.argpartition(-key, 3, axis=1)[:, :3]
        vals = np.take_along_axis(key, top, axis=1)
        order = vals.argsort(axis=1)[:, ::-1]
        top, vals = np.take_along_axis(top, order, axis=1), np.take_along_axis(vals, order, axis=1)
        for g in range(3):
            ok = (guesses > g) & np.isfinite(vals[:, g])
            np.add.at(counts, top[ok, g], 1)
    return counts / SIM_PLAYERS


def add_extras(rows, extra, factor, scale=0.5):
    """WordNet answers beyond the core list: rarer by nature, so they get half the core tail's estimate."""
    have = {r["a"] for r in rows} | {a for r in rows for a in r["al"]}
    for name, (z, others, blurb) in extra.items():
        if name in have:
            continue
        share = round(max(0.0003, min(0.03, 0.25 * curve(z) * factor * scale)), 5)
        row = {"a": name, "s": share, "al": [o for o in others if o not in have], "x": 1}  # x: from the dictionary, not the hand-made list
        if blurb and share < 0.005:
            row["b"] = blurb
        rows.append(row)
        have |= {name, *others}


def add_makes(rows, factor):
    have = {r["a"] for r in rows} | {a for r in rows for a in r["al"]}
    for display, models in MAKES.items():
        key = display.lower()
        if key in have:
            continue
        z = zipf_estimate(key)
        share = round(max(0.0003, min(0.03, 0.25 * curve(z) * factor * 0.6)), 5)
        rows.append({"a": key, "d": display, "s": share, "al": [m for m in models if m not in have], "f": "make", "x": 1})


def main() -> None:
    nltk.download("wordnet", quiet=True)
    animal_words = []
    multi = set(ANIMAL_MULTI)
    for line in ANIMALS:
        text = " " + line + " "
        for m in multi:
            text = text.replace(" " + m + " ", " ")
        animal_words += text.split()
    sn_list, sn_alias = sn_words()
    sources = {"animals": animal_words + ANIMAL_MULTI, "fruits": FRUITS, "kitchen": KITCHEN, "sn": sn_list, "wheels": WHEELS}
    out = []
    for key, title, icon, prompt, hint in CATEGORIES:
        sources[key] = sources[key] + [w for w in EXTRA_CORE.get(key, []) if key != "sn"]
        hand_targets = {a for k2, v in ALIASES.get(key, {}).items() for a in v if a not in ALIASES.get(key, {})}
        core = {a.strip().lower() for a in sources[key]} - hand_targets
        extra, into_core = wordnet_rows(key, core)
        if key == "sn":
            into_core = sn_alias
        rows, factor = build(key, sources[key], into_core)
        add_extras(rows, extra, factor)
        if key == "wheels":
            add_makes(rows, factor)
        # A name claimed by two answers (panther: jaguar or puma?) is dropped, unless one answer is that name spaced differently.
        owners = {}
        for r in rows:
            for a in r["al"]:
                owners.setdefault(a, []).append(r)
        for a, rs in owners.items():
            if len(rs) > 1:
                same = [r for r in rs if r["a"].replace(" ", "").replace("-", "") == a.replace(" ", "").replace("-", "")]
                for r in rs:
                    if r not in same[:1]:
                        r["al"].remove(a)
        # Too-general words and known wrong answers never count, even if a list above contains them.
        general = TOO_GENERAL.get(key, set())
        rows = [r for r in rows if r["a"] not in general and r["a"] not in NOT_IN.get(key, set())]
        for r in rows:
            r["al"] = [a for a in r["al"] if a not in general]
            if not r["al"]:
                del r["al"]
        # Turn "comes to mind" estimates into three-guess shares.
        shares = simulate_three_guesses([r["s"] for r in rows])
        for r, share in zip(rows, shares):
            r["s"] = round(max(float(share), 1 / SAMPLE_PLAYERS), 6)
        rows.sort(key=lambda r: (-r["s"], r["a"]))
        cat = {"key": key, "title": title, "icon": icon, "prompt": prompt, "hint": hint, "rules": RULES[key], "answers": rows,
               "general": sorted(general), "notIn": sorted(NOT_IN.get(key, set()))}
        if key in PREFIX:
            cat["prefix"] = PREFIX[key]
        out.append(cat)
        n_alias = sum(len(r.get("al", [])) for r in rows)
        print(f"{title}: {len(rows)} answers, {n_alias} other names; top: {[(r['a'], round(r['s'], 3)) for r in rows[:4]]}; "
              f"guesses per player {sum(r['s'] for r in rows):.2f}; at the floor: {sum(r['s'] <= 1 / SAMPLE_PLAYERS for r in rows)}")
    # Common English words: a real word is never "corrected" into a different answer ("house" is not a typo of "horse").
    from wordfreq import top_n_list
    names = {n for c in out for r in c["answers"] for n in [r["a"], *r.get("al", [])]}
    common = [w for w in top_n_list("en", 12000) if re.fullmatch(r"[a-z]{4,}", w) and w not in names]
    data = {"version": 3, "samplePlayers": SAMPLE_PLAYERS, "commonWords": " ".join(common), "categories": out}
    OUT.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
