"""Experimental days for the playtest (round types, themes, branching routes, answer chains). Not for the live game.
Writes <out>/pt/<n>.json for days 191-212 and returns their list entries. Called by tools/playtest/build.py.

Sources, all already in the repo: the live and prepared answer banks (estimated shares from a simulated sample of
players), the reviewed v4 sample, and content/experiments/questions.json (hand-written tiers). Every share here is an
ESTIMATE; no real player counts are involved. Round order is shuffled per day with a fixed seed, so everyone who plays a
day gets the same order and the same objectives."""
import json, os, glob, re, random
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
norm = lambda s: re.sub(r"[^a-z0-9]+", " ", str(s).lower()).strip()

# ---------- Sources ----------
BANK = {}
for p in sorted(glob.glob(os.path.join(ROOT, "days", "[0-9]*.json"))) + sorted(glob.glob(os.path.join(ROOT, "content", "build", "days", "*.json"))):
    for q in json.load(open(p))["questions"]:
        BANK.setdefault(q["key"], q); BANK.setdefault("prompt:" + (q.get("prompt") or q.get("title")), q)
TIERS = [("common", 0.16, 0.03), ("less_common", 0.012, 0.002), ("obscure", 0.0006, 0.00005)]
DROP = {norm(x) for x in ["Great Boston Molasses", "Pope's banana", "Halifax", "Great Pumpkin heist", "Lowestoft lighthouse", "Great Pacific Garbage Patch",
        "Charles Lindbergh baby", "Shitpost", "Gyatt", "Tiny Tim", "Mime", "Mute", "Mr. Bean's car", "Mr Trololo", "Emu War"]}
def from_tiers(q, key_prefix=""):
    rows, seen = [], set()
    for tier, hi, lo in TIERS:
        items = q["answers"].get(tier, [])
        for j, a in enumerate(items):
            name, al = (a, []) if isinstance(a, str) else ((a[0], a[1:]) if isinstance(a, list) else (a["canonical"], a.get("aliases", [])))
            if norm(name) in seen or norm(name) in DROP: continue
            seen.add(norm(name)); s = hi if len(items) == 1 else hi * (lo / hi) ** (j / (len(items) - 1))
            rows.append({"a": name.lower() if not any(c.isupper() for c in name[1:]) and not name[:1].isupper() else name, "s": round(s, 6), "al": [x for x in al if norm(x) not in seen]})
    return {"key": key_prefix + q["id"], "title": q.get("title") or q["id"].replace("-", " ").capitalize(), "icon": q.get("icon", "default"), "prompt": q["prompt"],
            "hint": "", "rules": q.get("rules") or [q.get("acceptance_rule", "")], "answers": rows, "general": [], "notIn": []}
AUTH = {q["id"]: from_tiers(q, "x-") for q in json.load(open(os.path.join(ROOT, "content", "experiments", "questions.json")))["questions"]}
V4 = {}
for d in json.load(open(os.path.join(ROOT, "content", "review", "sample-14-days-v4.json")))["days"]:
    for q in d["questions"]: V4[q["id"]] = from_tiers(q, "v4-")

def Q(ref):
    """'auth:id', 'v4:id', a bank key, or 'prompt:Name a ...'."""
    if ref.startswith("auth:"): return json.loads(json.dumps(AUTH[ref[5:]]))
    if ref.startswith("v4:"): return json.loads(json.dumps(V4[ref[3:]]))
    return json.loads(json.dumps(BANK[ref]))

# ---------- Round types ----------
def std(ref): return Q(ref)
def wild(ref): q = Q(ref); q["mode"] = {"type": "wildcard"}; return q
def risk(ref): q = Q(ref); q["mode"] = {"type": "risk"}; return q
def target(ref, lo=None, hi=None, goal=None, pct=None, rule=None):
    q = Q(ref); m = {"type": "target"}
    if goal: m["goal"] = goal
    if goal == "common": m["top"] = max(a["s"] for a in q["answers"] if not a.get("pv"))   # the server's copy of the bullseye (0010)
    if pct: m["pct"] = pct
    if lo is not None: m["lo"], m["hi"] = lo, hi
    if rule: m["rule"] = rule
    q["mode"] = m; return q
def forbidden(ref, n=7, extra=()):
    """The obvious answers: the n most common by estimated share (the playtest has no real history yet)."""
    q = Q(ref); top = sorted([a for a in q["answers"] if not a.get("pv")], key=lambda a: -a["s"])[:n]
    q["mode"] = {"type": "forbidden", "forbid": [a["a"] for a in top] + list(extra)}; return q

def shuffled(day, qs):
    r = random.Random(day * 7919); qs = list(qs); r.shuffle(qs); return qs

# ---------- Days ----------
def days():
    D = []
    # Practice: one mechanic at a time.
    D.append((191, "practice", "Practice: Rarity target", None, [
        target("prompt:Name a country", 0.01, 0.03), target("prompt:Name a fruit", goal="common", rule="Find the most common answer. Only the most common hits the centre."),
        target("prompt:Name an animal", goal="closest", pct=0.005, rule="Get as close as you can to 0.5% of players: uncommon, not obscure."),
        target("prompt:Name a car brand", 0.003, 0.02, rule="Uncommon but not obscure: an answer 0.3% to 2% of players give.")]))
    D.append((192, "practice", "Practice: Forbidden", None, [
        forbidden("prompt:Name a fruit"), forbidden("prompt:Name a sport"), forbidden("prompt:Name a musical instrument"), forbidden("prompt:Name a colour", 8)]))
    D.append((193, "practice", "Practice: Risk and reward", None, [risk("prompt:Name a cheese"), risk("prompt:Name a dog breed"), risk("video-game-before-2000")]))
    D.append((194, "practice", "Practice: Wildcards", None, [wild("auth:sounds-fictional"), wild("auth:silent-character"), wild("auth:survives-extremes"), wild("v4:misleading-name"), wild("auth:invented-before-1900")]))
    # Full expeditions: one of each round type, in a fixed shuffled order.
    full = [
        (201, None, [std("prompt:Name a cheese"), target("prompt:Name a country", 0.01, 0.03), forbidden("prompt:Name a fruit"), risk("video-game-before-2000"), wild("auth:sounds-fictional")]),
        (202, ("The Gaming Expedition", "Everything today comes with a power-up."), [std("auth:before-minecraft"), target("video-game-before-2000", goal="closest", pct=0.01), forbidden("auth:not-human-game", 6),
            risk("game-played-at-parties"), wild("v4:play-as-animal")]),
        (203, ("Internet Archaeology", "Dig through the layers of the old web."), [std("auth:shut-down-site"), target("auth:pre-2015-viral", 0.005, 0.02, rule="An answer 0.5% to 2% of players would give (estimated)."),
            forbidden("auth:2000s-gadget", 6), risk("obsolete-media-format"), wild("auth:brainrot-word")]),
        (204, ("Strange but True", "Every answer today really happened, really exists, or really is called that."), [wild("auth:sounds-fictional"), std("v4:misleading-name"),
            target("e-named-after-place", 0.002, 0.01), risk("auth:survives-extremes"), forbidden("v4:animal-myth", 4)]),
        (205, ("Things That No Longer Exist", "Gone, but not forgotten. Yet."), [std("auth:extinct-animal"), target("dropped-olympic-event", goal="closest", pct=0.02),
            forbidden("obsolete-media-format", 6), risk("former-capital-city"), wild("auth:shut-down-site")]),
        (206, ("The Science Expedition", None), [std("makes-its-own-light"), target("prompt:Name a chemical element", 0.002, 0.01), forbidden("inside-a-cell", 6),
            risk("auth:survives-extremes"), wild("auth:invented-before-1900")]),
        (207, ("The Sports Expedition", None), [target("prompt:Name a sport", 0.002, 0.01), forbidden("sport-played-with-ball", 7), std("sports-idiom"),
            risk("dropped-olympic-event"), wild("hit-a-ball-with")]),
        (208, ("The 2000s", "Low-rise jeans, ringtones and dial-up."), [std("auth:2000s-gadget"), target("auth:pre-2015-viral", goal="common"), forbidden("auth:student-food", 6),
            risk("auth:before-minecraft"), wild("auth:silent-character")]),
    ]
    for n, theme, qs in full: D.append((n, "expedition", (theme[0] if theme else "Mixed expedition"), theme, shuffled(n, qs)))
    # Branching: two ordinary questions, then a choice of route for the last three.
    routes = [
        {"key": "wreck", "label": "The shipwreck", "blurb": "History. Old things, lost things.", "questions": [std("ancient-peoples"), std("egyptian-tomb-finds"), wild("auth:sounds-fictional")]},
        {"key": "station", "label": "The research station", "blurb": "Science. Lights, cells and survivors.", "questions": [std("makes-its-own-light"), std("inside-a-cell"), wild("auth:survives-extremes")]},
        {"key": "cavern", "label": "The cavern", "blurb": "Wildcards. Nobody knows what's down there.", "questions": [wild("v4:misleading-name"), wild("auth:silent-character"), wild("auth:brainrot-word")]},
        {"key": "trench", "label": "The trench", "blurb": "Harder questions, for divers who like it dark.", "questions": [std("e-deep-sea"), std("named-science-law"), std("auth:extinct-animal")]},
    ]
    first = [std("prompt:Name a bird"), target("prompt:Name a dog breed", 0.005, 0.03)]
    D.append((209, "prototype", "Branching expedition", ("Choose your route", "Halfway down, the water splits four ways."), first + routes[0]["questions"], {"branch": {"at": 2, "routes": routes}}))
    # Answer chain: the country you choose decides the next two questions.
    D.append(chain_day())
    # The rotating daily mix: two weeks of it.
    used = set()
    for n in range(211, 225): D.append((n, "mix", f"Daily mix #{n - 210}", None, mix_day(n, used)))
    D.extend(short_chains())
    # The community sounding (rollover prototype): an ordinary day with a community challenge on top. Mock state only.
    D.append((225, "prototype", "Community sounding (rollover prototype)", ("The Deep Signal", "A community challenge rides on today's dive."),
              [std("animals"), std("countries"), forbidden("fruits", 6), std("myth"), wild("auth:sounds-fictional")],
              {"signal": {"threshold": 0.0005, "rollovers": 2, "max": 3, "min_players": 2000,
                          "unlock": "the Lantern Reef, a glowing reef in the Midnight Zone, for everyone who dived that day",
                          "finder": "a Signal Finder mark in your field journal (no depth, no ranking)"}}))
    # One of each new prototype on its own.
    D.append((191 + 4, "practice", "Practice: Sea mines", None, [mines("animals"), mines("countries"), mines("fish")]))
    return D

# Answer chains: curated, verified relationships only (no model-written answers). Country -> its native animals ->
# another native animal from a different family. Families are written beside each animal.
CHAIN = {
 "Australia": [("kangaroo", "Macropodidae", "c"), ("koala", "Phascolarctidae", "c"), ("platypus", "Ornithorhynchidae", "c"), ("wombat", "Vombatidae", "c"), ("emu", "Casuariidae", "c"), ("kookaburra", "Alcedinidae", "l"),
   ("Tasmanian devil", "Dasyuridae", "l"), ("echidna", "Tachyglossidae", "l"), ("wallaby", "Macropodidae", "l"), ("quokka", "Macropodidae", "l"), ("dingo", "Canidae", "l"), ("cassowary", "Casuariidae", "l"), ("frilled lizard", "Agamidae", "o"),
   ("sugar glider", "Petauridae", "o"), ("numbat", "Myrmecobiidae", "o"), ("lyrebird", "Menuridae", "o"), ("taipan", "Elapidae", "o"), ("bilby", "Thylacomyidae", "o"), ("thorny devil", "Agamidae", "o")],
 "Madagascar": [("lemur", "Lemuridae", "c"), ("ring-tailed lemur", "Lemuridae", "c"), ("chameleon", "Chamaeleonidae", "c"), ("fossa", "Eupleridae", "l"), ("aye-aye", "Daubentoniidae", "l"), ("tenrec", "Tenrecidae", "l"),
   ("indri", "Indriidae", "o"), ("sifaka", "Indriidae", "o"), ("tomato frog", "Microhylidae", "o"), ("leaf-tailed gecko", "Gekkonidae", "o"), ("hissing cockroach", "Blaberidae", "o"), ("radiated tortoise", "Testudinidae", "o"), ("mouse lemur", "Cheirogaleidae", "o")],
 "India": [("tiger", "Felidae", "c"), ("Indian elephant", "Elephantidae", "c"), ("peacock", "Phasianidae", "c"), ("king cobra", "Elapidae", "c"), ("Indian rhinoceros", "Rhinocerotidae", "l"), ("sloth bear", "Ursidae", "l"), ("mongoose", "Herpestidae", "l"),
   ("gharial", "Gavialidae", "o"), ("Asiatic lion", "Felidae", "o"), ("nilgai", "Bovidae", "o"), ("blackbuck", "Bovidae", "o"), ("langur", "Cercopithecidae", "o"), ("red panda", "Ailuridae", "o")],
 "Brazil": [("jaguar", "Felidae", "c"), ("toucan", "Ramphastidae", "c"), ("sloth", "Bradypodidae", "c"), ("capybara", "Caviidae", "c"), ("macaw", "Psittacidae", "c"), ("piranha", "Serrasalmidae", "l"), ("anaconda", "Boidae", "l"),
   ("tapir", "Tapiridae", "l"), ("giant anteater", "Myrmecophagidae", "l"), ("armadillo", "Dasypodidae", "l"), ("poison dart frog", "Dendrobatidae", "o"), ("howler monkey", "Atelidae", "o"), ("pink river dolphin", "Iniidae", "o"), ("golden lion tamarin", "Callitrichidae", "o"), ("ocelot", "Felidae", "o")],
 "Kenya": [("lion", "Felidae", "c"), ("elephant", "Elephantidae", "c"), ("giraffe", "Giraffidae", "c"), ("zebra", "Equidae", "c"), ("rhino", "Rhinocerotidae", "l"), ("hippo", "Hippopotamidae", "l"), ("cheetah", "Felidae", "l"),
   ("wildebeest", "Bovidae", "l"), ("hyena", "Hyaenidae", "l"), ("flamingo", "Phoenicopteridae", "o"), ("warthog", "Suidae", "o"), ("ostrich", "Struthionidae", "o"), ("dik-dik", "Bovidae", "o"), ("aardvark", "Orycteropodidae", "o"), ("pangolin", "Manidae", "o")],
}
SH = {"c": (0.16, 0.05), "l": (0.02, 0.004), "o": (0.002, 0.0002)}
def chain_rows(items, exclude_family=None):
    out = []
    for tier in "clo":
        its = [x for x in items if x[2] == tier and x[1] != exclude_family]
        for j, (a, fam, _) in enumerate(its):
            hi, lo = SH[tier]; s = hi if len(its) == 1 else hi * (lo / hi) ** (j / (len(its) - 1))
            out.append({"a": a if a[:1].isupper() else a.lower(), "s": round(s, 6), "al": [], "fam": fam})
    return out
def chain_day():
    q1 = {"key": "ch-country", "title": "Choose your waters", "icon": "globe", "prompt": "Choose a country to explore: Australia, Madagascar, India, Brazil or Kenya",
          "hint": "Your answer decides the next two questions.", "rules": ["One of the five countries listed."], "general": [], "notIn": [],
          "answers": [{"a": c, "s": s, "al": []} for c, s in [("Australia", 0.34), ("India", 0.22), ("Brazil", 0.2), ("Kenya", 0.16), ("Madagascar", 0.08)]]}
    v2, v3 = {}, {}
    for c, items in CHAIN.items():
        v2[c] = {"key": "ch-native-" + norm(c).replace(" ", "-"), "title": "Native wildlife", "icon": "paw", "prompt": f"An animal native to {c}", "hint": "",
                 "rules": [f"An animal that lives in the wild in {c} and was there before people brought anything in.", "Common names; the animal's family decides the next question."],
                 "answers": chain_rows(items), "general": [], "notIn": []}
        v3[c] = {}
        for a, fam, _ in items:
            k = f"ch-other-{norm(c).replace(' ', '-')}-{norm(fam)}"
            if k in v3[c]: continue
            v3[c][fam] = {"key": k, "title": "Another family", "icon": "paw", "prompt": f"Another animal native to {c}, from a different family than the {{last}}",
                          "hint": "", "rules": [f"Native to {c}, and not in the family {fam}."], "answers": chain_rows(items, fam), "general": [], "notIn": []}
    q2 = dict(v2["Australia"]); q2["chain"] = {"from": 0, "by": {c: v2[c] for c in CHAIN}}
    q3 = json.loads(json.dumps(v3["Australia"]["Macropodidae"])); q3["chain"] = {"from": 1, "fam": True, "by": {f"{c}|{fam}": v3[c][fam] for c in CHAIN for fam in v3[c]}, "country_from": 0}
    rest = [target("prompt:Name an animal", goal="closest", pct=0.01), std("e-deep-sea")]
    return (210, "prototype", "Answer chain", ("Follow the chain", "Each answer leads somewhere. Choose your country with care."), [q1, q2, q3] + rest)

def build(out, widen=None):
    entries = []
    for d in days():
        n, group, name, theme, qs = d[:5]; extra = d[5] if len(d) > 5 else {}
        # The widened answer lists apply here too, except to target rounds (those score measured answers only).
        if widen:
            for q in qs + [x for r in extra.get("branch", {}).get("routes", []) for x in r["questions"]]:
                if (q.get("mode") or {}).get("type") != "target": widen(q)
        day = {"v": 3, "day": n, "questions": qs, "experimental": True, "label": name, **({"theme": {"name": theme[0], "line": theme[1]}} if theme else {}), **extra}
        json.dump(day, open(os.path.join(out, "pt", f"{n}.json"), "w"), separators=(",", ":"))
        entries.append({"n": n, "group": {"prototype": "prototype", "mix": "mix"}.get(group, "experimental"), "source": name,
                        "questions": [f"[{(q.get('mode') or {}).get('type', 'rarity')}] " + (q.get("prompt") or q.get("title")) for q in qs]})
    return entries

# ---------- The rotating daily mix ----------
# A day is five questions. Most days: two rarity rounds, one target, one forbidden and one special (risk, wildcard or
# sea mines). Some days swap the target or the forbidden round for a third rarity round, so the mix never feels set.
# Everything comes from the day number alone (a fixed seed), so every player gets the same mix, order, bans, bands and
# mines on the same day. The first question is always an ordinary rarity round, to settle in.
MIX = {
    "std": ["animals", "birds", "countries", "kitchen", "wheels", "buildings", "bread", "soup", "boats", "space", "jobs", "fish", "veg", "myth", "bugs",
            "trees", "drinks", "furniture", "dessert", "capitals", "tools", "emotions", "reptiles", "flowers", "languages", "gods", "clothing", "body",
            "e-afraid-of", "e-tin", "e-hotel", "black-and-white-things", "has-head-not-alive", "three-d-shape", "kind-of-parrot", "drink-served-hot",
            "sea", "e-night-job", "backstage-at-a-theatre", "has-electronic-screen", "e-animal-material", "something-naturally-red", "e-expiry"],
    "target": ["animals", "countries", "carbrands", "dogbreeds", "fish", "birds", "trees", "capitals", "flowers", "herbs", "candy", "fastfood", "genres", "languages"],
    "forbidden": ["fruits", "colours", "sports", "instruments", "pizza", "farm", "weather", "hats", "icecream", "pasta", "sauces", "nuts", "wildcats", "primates"],
    "risk": ["cheese", "dogbreeds", "video-game-before-2000", "dinos", "elements", "gems", "dances", "rooms", "classroom", "bathroom"],
    "wild": ["auth:sounds-fictional", "auth:silent-character", "auth:survives-extremes", "auth:invented-before-1900", "auth:brainrot-word", "auth:shut-down-site",
             "auth:before-minecraft", "auth:student-food", "e-sofa", "e-magician", "e-phone-replaced", "e-mouth-not-food", "e-nervous", "e-hold"],
    "mines": ["animals", "countries", "birds", "fish", "trees", "jobs", "myth", "bugs", "flowers", "body", "clothing", "capitals"],
}
TARGETS = [dict(lo=0.01, hi=0.03), dict(goal="closest", pct=0.005, rule="Get as close as you can to 0.5% of players: uncommon, not obscure."),
           dict(lo=0.003, hi=0.02, rule="Uncommon but not obscure: an answer 0.3% to 2% of players give."), dict(goal="common", rule="Find the most common answer.")]
SHAPES = [["std", "std", "target", "forbidden", "special"]] * 4 + [["std", "std", "std", "target", "special"], ["std", "std", "std", "forbidden", "special"]]

def mines(ref, day_rng=None):
    """Sea mines: two marked bands of popularity that blow up a guess. Placed where real answers are thick, so they
    matter: one in the familiar middle (the answers that come to mind second), one in the rare water you aim for."""
    q = Q(ref); s = sorted([a["s"] for a in q["answers"] if not a.get("pv")], reverse=True)
    def band_at(x, w):
        return {"lo": round(x / w, 6), "hi": round(x * w, 6)}
    # The middle mine: around the 10th to 15th answer; the deep mine: around the answer a third of the way into the rare end.
    mid = s[min(len(s) - 1, 12)] if len(s) > 12 else s[len(s) // 2]
    deep = s[min(len(s) - 1, max(30, len(s) // 3))]
    m1, m2 = band_at(mid, 1.6), band_at(deep, 1.6)
    if m2["hi"] >= m1["lo"]: m2 = band_at(m1["lo"] / 4, 1.6)
    q["mode"] = {"type": "mines", "mines": [m1, m2]}; return q

def mix_day(day, used=None):
    r = random.Random(day * 104729 + 17); used = set() if used is None else used
    def pick(pool):
        choices = [k for k in MIX[pool] if k not in used] or MIX[pool]
        k = r.choice(choices); used.add(k); return k
    shape = list(SHAPES[r.randrange(len(SHAPES))])
    special = ["risk", "wild", "mines"][day % 3]   # the special round rotates: no kind of round two days running
    qs = []
    for slot in shape:
        if slot == "std": qs.append(std(pick("std")))
        elif slot == "target": qs.append(target(pick("target"), **TARGETS[r.randrange(len(TARGETS))]))
        elif slot == "forbidden": qs.append(forbidden(pick("forbidden"), r.choice([5, 6, 7])))
        elif special == "risk": qs.append(risk(pick("risk")))
        elif special == "wild": qs.append(wild(pick("wild")))
        else: qs.append(mines(pick("mines")))
    first, rest = qs[0], qs[1:]; r.shuffle(rest)
    return [first] + rest

# ---------- Short chains (2 questions) ----------
# Your answer to the first question decides the second. Only well-established facts, written out by hand: where a
# claim is disputed between countries (the telephone, the radio, the light bulb, the World Wide Web) it is left out.
# Tiers: c = what most people would say, l = less common, o = obscure. When your answer has no checked list behind
# it, the second question falls back to a general one, and says so.
INVENTED = {
 "japan": [("instant noodles", "c"), ("karaoke machine", "c"), ("emoji", "c"), ("Walkman", "l"), ("bullet train", "l"), ("QR code", "l"), ("Tamagotchi", "l"), ("Game Boy", "l"),
           ("PlayStation", "l"), ("electric rice cooker", "o"), ("Pocky", "o"), ("blue LED", "o")],
 "china": [("paper", "c"), ("gunpowder", "c"), ("compass", "c"), ("fireworks", "c"), ("porcelain", "l"), ("kite", "l"), ("woodblock printing", "l"), ("paper money", "l"),
           ("movable type", "o"), ("seismoscope", "o"), ("wheelbarrow", "o")],
 "united states": [("airplane", "c"), ("microwave oven", "l"), ("jeans", "l"), ("basketball", "l"), ("air conditioning", "l"), ("phonograph", "l"), ("transistor", "o"),
                   ("Post-it note", "o"), ("laser", "o"), ("chocolate chip cookie", "o"), ("Ferris wheel", "o"), ("Frisbee", "o"), ("GPS", "o")],
 "united kingdom": [("steam engine", "c"), ("steam locomotive", "c"), ("postage stamp", "l"), ("hovercraft", "l"), ("jigsaw puzzle", "l"), ("Christmas card", "o"),
                    ("lawn mower", "o"), ("cat's eyes", "o"), ("rubber band", "o"), ("sandwich", "l")],
 "germany": [("printing press", "c"), ("car", "c"), ("diesel engine", "l"), ("aspirin", "l"), ("MP3", "l"), ("gummy bears", "l"), ("Bunsen burner", "o"), ("Petri dish", "o"),
             ("dandy horse", "o")],
 "italy": [("piano", "c"), ("espresso machine", "c"), ("battery", "l"), ("eyeglasses", "l"), ("violin", "l"), ("barometer", "o"), ("Nutella", "l"), ("opera", "o")],
 "france": [("hot air balloon", "c"), ("photography", "l"), ("Braille", "l"), ("stethoscope", "l"), ("pasteurisation", "l"), ("bikini", "o"), ("canning", "o"),
            ("metric system", "o"), ("cinematograph", "o")],
 "sweden": [("dynamite", "c"), ("three-point seatbelt", "l"), ("safety match", "l"), ("Celsius scale", "l"), ("Bluetooth", "l"), ("Tetra Pak", "o"), ("adjustable spanner", "o"),
            ("implantable pacemaker", "o")],
 "canada": [("insulin", "c"), ("snowmobile", "l"), ("Trivial Pursuit", "l"), ("IMAX", "l"), ("paint roller", "o"), ("egg carton", "o"), ("Hawaiian pizza", "l"), ("Canadarm", "o"), ("poutine", "l")],
 "australia": [("black box flight recorder", "c"), ("boomerang", "c"), ("electric drill", "l"), ("cochlear implant", "l"), ("Hills Hoist", "o"), ("polymer banknote", "o"), ("ute", "o")],
 "netherlands": [("telescope", "c"), ("cassette tape", "l"), ("compact disc", "l"), ("pendulum clock", "l"), ("stroopwafel", "o")],
 "india": [("chess", "c"), ("snakes and ladders", "l"), ("yoga", "l"), ("ludo", "l"), ("shampoo", "o"), ("buttons", "o")],
}
# Kept short and conservative: the countries where each animal lives wild today (native, not introduced).
LIVES = {
 "kangaroo": [("australia", "c"), ("papua new guinea", "o")],
 "koala": [("australia", "c")], "platypus": [("australia", "c")],
 "panda": [("china", "c")],
 "lion": [("kenya", "c"), ("south africa", "c"), ("tanzania", "c"), ("botswana", "l"), ("india", "l"), ("zambia", "l"), ("zimbabwe", "l"), ("namibia", "l"), ("uganda", "o"), ("ethiopia", "o"), ("mozambique", "o")],
 "tiger": [("india", "c"), ("russia", "l"), ("bangladesh", "l"), ("nepal", "l"), ("indonesia", "l"), ("thailand", "o"), ("malaysia", "o"), ("bhutan", "o")],
 "polar bear": [("canada", "c"), ("russia", "c"), ("united states", "l"), ("norway", "l"), ("greenland", "o", ["denmark"])],
 "orangutan": [("indonesia", "c"), ("malaysia", "l")],
 "lemur": [("madagascar", "c")],
 "jaguar": [("brazil", "c"), ("mexico", "l"), ("peru", "l"), ("colombia", "l"), ("venezuela", "o"), ("bolivia", "o"), ("argentina", "o"), ("belize", "o"), ("guatemala", "o"), ("costa rica", "o"), ("ecuador", "o"), ("paraguay", "o"), ("panama", "o")],
 "moose": [("canada", "c"), ("united states", "c"), ("sweden", "l"), ("norway", "l"), ("finland", "l"), ("russia", "l"), ("estonia", "o"), ("poland", "o"), ("mongolia", "o")],
 "giraffe": [("kenya", "c"), ("tanzania", "c"), ("south africa", "l"), ("namibia", "l"), ("botswana", "l"), ("zambia", "o"), ("zimbabwe", "o"), ("uganda", "o"), ("niger", "o"), ("chad", "o"), ("ethiopia", "o")],
 "zebra": [("kenya", "c"), ("tanzania", "c"), ("south africa", "l"), ("botswana", "l"), ("namibia", "l"), ("ethiopia", "o"), ("zambia", "o"), ("zimbabwe", "o"), ("mozambique", "o")],
 "penguin": [("antarctica", "c", []), ("south africa", "l"), ("new zealand", "l"), ("australia", "l"), ("chile", "l"), ("argentina", "l"), ("peru", "o"), ("namibia", "o"), ("ecuador", "o")],
 "koala bear": [("australia", "c")],
 "snow leopard": [("china", "c"), ("nepal", "l"), ("india", "l"), ("mongolia", "l"), ("bhutan", "o"), ("pakistan", "o"), ("afghanistan", "o"), ("kyrgyzstan", "o"), ("kazakhstan", "o"), ("tajikistan", "o"), ("russia", "o")],
 "komodo dragon": [("indonesia", "c")], "kiwi": [("new zealand", "c")],
 "red panda": [("nepal", "c"), ("china", "c"), ("india", "l"), ("bhutan", "l"), ("myanmar", "o")],
 "capybara": [("brazil", "c"), ("venezuela", "l"), ("colombia", "l"), ("argentina", "l"), ("paraguay", "o"), ("uruguay", "o"), ("peru", "o"), ("bolivia", "o"), ("ecuador", "o"), ("panama", "o"), ("guyana", "o"), ("suriname", "o")],
 "bald eagle": [("united states", "c"), ("canada", "c"), ("mexico", "o")],
}
def tier_rows(items):
    out = []
    for tier in "clo":
        its = [x for x in items if x[1] == tier]
        for j, it in enumerate(its):
            hi, lo = SH[tier]; s = hi if len(its) == 1 else hi * (lo / hi) ** (j / (len(its) - 1))
            out.append({"a": it[0], "s": round(s, 6), "al": list(it[2]) if len(it) > 2 else []})
    return out

THE = {"united states": "the United States", "united kingdom": "the United Kingdom", "netherlands": "the Netherlands"}
def disp(k): return THE.get(k) or (k.title() if k in INVENTED else k)
def short_chain(n, label, first_ref, first_prompt, rule, table, prompt2, rules2, fallback):
    q1 = Q(first_ref); q1["key"] = f"sc{n}-1"; q1["prompt"] = first_prompt; q1["hint"] = rule
    by = {}
    for k, items in table.items():
        by[k] = {"key": f"sc{n}-2-{norm(k).replace(' ', '-')}", "title": "Chain", "icon": q1.get("icon", "default"), "prompt": prompt2.replace("{last}", disp(k)),
                 "hint": "", "rules": [r.replace("{last}", disp(k)) for r in rules2], "answers": tier_rows(items), "general": [], "notIn": []}
    fb = Q(fallback[0]); fb["key"] = f"sc{n}-2-fallback"; fb["prompt"] = fallback[1]
    fb["hint"] = "No checked list for {last} yet, so this one is general. (Prototype: how often this happens is part of the test.)"
    q2 = json.loads(json.dumps(next(iter(by.values())))); q2["chain"] = {"from": 0, "by": by, "fallback": fb}
    rest = [std("bread"), target("prompt:Name a sport", 0.002, 0.01), std("e-tin")] if n == 226 else [std("trees"), forbidden("weather", 6), std("e-hotel")]
    return (n, "prototype", label, ("A short chain", "Your first answer decides the second question."), [q1, q2] + rest)

def short_chains():
    return [
        short_chain(226, "Short chain: country → invention", "countries", "Name a country. (Then: something invented there.)",
                    "Your answer decides the next question: an invention from that country.", INVENTED,
                    "Something invented in {last}", ["Invented or first made in {last}. Only well-established firsts count, not disputed ones."],
                    ("auth:invented-before-1900", "Something invented before 1900 that you still use")),
        short_chain(227, "Short chain: animal → where it lives", "animals", "Name a wild animal. (Then: a country where it lives in the wild.)",
                    "Your answer decides the next question: a country where that animal lives wild.", LIVES,
                    "A country where the {last} lives in the wild", ["A country where the {last} is found in the wild today, natively (not in zoos, not introduced)."],
                    ("countries", "Name a country")),
    ]
