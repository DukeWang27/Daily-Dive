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
        entries.append({"n": n, "group": "experimental" if group != "prototype" else "prototype", "source": name,
                        "questions": [f"[{(q.get('mode') or {}).get('type', 'rarity')}] " + (q.get("prompt") or q.get("title")) for q in qs]})
    return entries
