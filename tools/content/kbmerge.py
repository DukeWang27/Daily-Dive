"""Merges an imported dataset (content/kb/<domain>.json) into a question's answers, so a real answer is recognised even
when nobody thought to list it. Used by the build (tools/content/build.py) and by the answer benchmark.

Rarity for a dataset-only answer is a PROVISIONAL prior, marked pv=1: nobody has estimated it and no player has given it
yet. It starts very rare (about 1 in 50,000), nudged up a little if its words are common in English, and it is capped
(see build.py: provisional answers can't reach the deepest zones until real players supply evidence)."""
import json, os, re, unicodedata
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
try:
    from wordfreq import zipf_frequency
except ImportError:                       # optional: without it every dataset answer gets the base prior
    zipf_frequency = lambda w, lang: 0.0

def norm(s):
    s = "".join(c for c in unicodedata.normalize("NFD", str(s)) if unicodedata.category(c) != "Mn").lower()
    s = s.replace("&", " and ").replace("'", "").replace("’", "")
    return re.sub(r"^(a|an|the|some) ", "", re.sub(r"[^a-z0-9]+", " ", s).strip())

def prior(name, base=2e-5, cap=2e-4, links=None):
    """A first guess at the share of players who'd give a name nobody listed. Two signals, the larger wins: how common
    its words are in English (wordfreq), and how well known the thing is: the number of Wikipedia language editions
    with an article on it (Wikidata sitelinks). 1 edition is about 1 in 65,000 players; 10 about 1 in 6,500; 200 or
    more about 1 in 330 (150 m). Nothing from a dataset can reach Unfathomable on this alone: that needs real players."""
    z = min((zipf_frequency(w, "en") for w in norm(name).split()), default=0.0)   # the rarest word decides
    wf = min(cap, base * 10 ** (0.35 * max(0.0, z - 2.5)))
    lk = min(3e-3, 1.5e-5 * float(links)) if links else 0.0
    return round(max(wf, lk), 7)

# Designations and descriptive tails people don't type: "Castelmagno PDO" is Castelmagno, "Sbrinz (cheese)" is Sbrinz.
TAIL = re.compile(r"\s*(\([^)]*\)|,? (pdo|aop|dop|aoc|pgi|igp|doc|docg|dog breed|cheese|sauce|soup|bread|pasta|opera|painting|typeface|font|desert))+$", re.I)
def clean(label):
    c = TAIL.sub("", label).strip(" ,")
    return c if len(c) >= 2 else label

def load(domain):
    return json.load(open(os.path.join(ROOT, "content", "kb", domain + ".json")))

SHORT_OK = {"uk", "us", "usa", "uae", "drc", "png", "nz", "ussr"}
def good_alias(a):
    """Datasets list codes and one-letter tags as other names ("PE", "B"): only real names a player would type."""
    k = norm(a); return len(k) >= 3 or k in SHORT_OK

# Names that keep their capitals (people, places, works, brands).
PROPER = {"countries", "cities", "former_countries", "languages", "constellations", "volcanoes", "car_brands", "deities", "mathematicians",
          "inventors", "photographers", "operas", "paintings", "typefaces", "deserts", "seas", "creatures"}
# Things a category drags in that aren't answers to it (a shrine filed under deities, "music of Russia" as a genre).
EXCLUDE = {"deities": r"shrine|temple|church|monastery|cult of|statue", "music_genres": r"^music of |music in |^history of ",
           "car_brands": r"alliance|holdings|group$|^[a-z]+ [A-Z]", "creatures": r"^list of ", "sports": r" at the |^list of ",
           "paintings": r"^untitled$", "film_genres": r"^list of "}
def items_of(kb, flt=None):
    """Dataset entries as {a, al}: birds use species (+ scientific name) and group names; others use items."""
    flt = flt or {}
    if kb["domain"] == "birds":
        out = []
        for x in kb["species"]:
            if flt.get("extinct") is False and x["extinct"]: continue
            if flt.get("regions") and not any(r in x["region"] for r in flt["regions"]): continue
            if flt.get("families") and x["family"] not in flt["families"]: continue
            if flt.get("name_any") and not any(w in x["a"].split() for w in flt["name_any"]): continue
            out.append({"a": x["a"], "al": [x["sci"]], "kind": "species"})
        if flt.get("groups", True): out += [{"a": g, "al": [], "kind": "group"} for g in kb["groups"]]
        return out
    out = []
    for x in kb["items"]:
        ok = all((x.get(k) == v) if not isinstance(v, list) else any(c in x.get(k, []) for c in v) for k, v in flt.items() if k not in ("groups",))
        if not ok: continue
        if kb["domain"] in EXCLUDE and re.search(EXCLUDE[kb["domain"]], x["a"], re.I if not kb["domain"] == "car_brands" else 0): continue
        a0 = clean(x["a"]); names = [x["a"]] if a0 != x["a"] else []
        proper = kb["domain"] in PROPER
        out.append({"a": a0 if a0[:1].isupper() and proper else a0.lower(),
                    "al": [a for a in names + [clean(y) for y in x.get("al", [])] + x.get("al", []) if len(a) <= 50 and good_alias(a) and norm(a) != norm(a0)][:12],
                    "kind": "item", "links": int(x["links"]) if x.get("links") else None})
    return out

def merge(answers, domain, flt=None, share_key="s"):
    """answers: list of {a, al?, s|p}. Returns (merged list, number added). Existing answers keep their estimates; a
    dataset name already known as an answer or other name only adds its missing other names."""
    kb = load(domain); index = {}
    for a in answers:
        for n in [a["a"], *a.get("al", [])]: index.setdefault(norm(n), a)
    added = 0
    for it in items_of(kb, flt):
        names = [it["a"], *it["al"]]
        hit = next((index[norm(n)] for n in names if norm(n) in index), None)
        if hit:
            have = {norm(x) for x in [hit["a"], *hit.get("al", [])]}
            extra = [n for n in names if norm(n) not in have and norm(n) not in index]
            if extra: hit.setdefault("al", []).extend(extra); [index.setdefault(norm(n), hit) for n in extra]
            continue
        row = {"a": it["a"], "al": sorted({n for n in it["al"] if norm(n) not in index}), share_key: prior(it["a"], links=it.get("links")) * (3 if it["kind"] == "group" else 1), "src": "dataset:" + domain, "pv": 1}
        answers.append(row); added += 1
        for n in names: index.setdefault(norm(n), row)
    return answers, added

if __name__ == "__main__":
    # Benchmark fixtures: the shipped questions with their matching dataset merged in.
    import glob, sys
    MAP = {"birds": ("birds", None), "dogbreeds": ("dog_breeds", None), "cheese": ("cheeses", None), "instruments": ("instruments", None),
           "countries": ("countries", None), "elements": ("elements", None), "languages": ("languages", None), "dinos": ("dinosaurs", None)}
    out = os.path.join(ROOT, "tests", "answers", "fixtures"); os.makedirs(out, exist_ok=True)
    for f in glob.glob(os.path.join(ROOT, "days", "*.json")):
        if f.endswith("index.json"): continue
        for q in json.load(open(f))["questions"]:
            if q["key"] in MAP and os.path.exists(os.path.join(ROOT, "content", "kb", MAP[q["key"]][0] + ".json")):
                q = json.loads(json.dumps(q)); _, n = merge(q["answers"], *MAP[q["key"]])
                json.dump(q, open(os.path.join(out, q["key"] + ".json"), "w"), separators=(",", ":")); print(q["key"], "+", n, "->", len(q["answers"]))
