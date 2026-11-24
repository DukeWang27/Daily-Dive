"""Build the daily question files: days/1.json, days/2.json, ... plus days/index.json and words.json.

Reads the question bank and calendar from tools/questions.py (and the first five questions' word lists from
tools/build_categories.py). For each question it gathers every accepted answer and its other names, estimates how
readily each comes to mind, simulates three-guess players to get sample shares, and writes one file per day.

Run from the project folder (about 5 minutes for 15 days):
    pip install nltk wordfreq english-words numpy
    python3 tools/build_days.py            # every day
    python3 tools/build_days.py birds qu   # only rebuild days containing these questions (others are left as they are)
Behind a proxy, set NLTK_ALLOW_PROXIED_URLOPEN=1 for the first run (it downloads WordNet).
"""

import json
import math
import pathlib
import re
import sys

import nltk
from english_words import get_english_words_set
from nltk.corpus import wordnet as wn
from wordfreq import top_n_list, zipf_frequency

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import build_categories as bc  # noqa: E402  (classic word lists and shared helpers)
import questions as qb  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "days"
SAMPLE_PLAYERS = bc.SAMPLE_PLAYERS
bc.SIM_PLAYERS = 120_000   # players simulated per question (see simulate_three_guesses in build_categories.py)
# Real words that are fine as answers but should never be put on a public board.
HIDE = set("""cock bitch twat prick dick slut whore cunt fuck shit piss arse ass bastard bollock bollocks wank wanker tit tits
crap sex sexy boob boobs dyke fag faggot nigger negro spic chink gook kike wog paki coon tranny retard spaz
cripple bugger shag turd poo poop fart knob knobhead cocksucker motherfucker bullshit horseshit dumbass jackass asshole
arsehole snatch quim skank hooker pimp porn porno rape rapist nazi hitler suicide
cocaine heroin meth""".split())


# Words whose frequency in text comes from a name, not from the word itself.
DEMOTE = {"trump": 3.0, "twitter": 3.4, "yahoo": 3.0, "x": 2.0, "glee": 3.2, "tinder": 3.0, "amazon": 3.5, "apple": 4.2}
ROMAN = re.compile(r"^[ivxlcdm]+$")
NOT_ROMAN = {"mix", "mild", "civil", "dim", "lid", "vivid", "livid", "did", "mid", "ill", "mill", "dill", "mimic", "civic", "lilac", "clad", "mi", "mm", "dvd"}


def key_of(name: str) -> str:
    return re.sub(r"\s+", " ", name.replace("_", " ").strip().lower())


def subtree(names, inst=False):
    seen, order = set(), []
    step = (lambda s: s.hyponyms() + s.instance_hyponyms()) if inst else (lambda s: s.hyponyms())
    for n in names:
        try:
            root = wn.synset(n)
        except Exception:
            print(f"   (no WordNet entry {n}, skipped)")
            continue
        for s in [root] + list(root.closure(step)):
            if s not in seen:
                seen.add(s)
                order.append(s)
    return order


def recall_guess(name: str) -> float:
    return 0.25 * bc.curve(bc.zipf_estimate(name))


def build_topic(spec):
    """Returns the list of answer rows for a topic question."""
    proper = spec.get("proper", False)
    general = {key_of(g) for g in spec.get("general", [])}
    stop = {key_of(g) for g in spec.get("stop", [])}
    notin = {key_of(g) for g in spec.get("notin", [])}
    top = {key_of(k): v for k, v in spec.get("top", {}).items()}
    answers = {}   # key -> {"d": display or None, "al": set(), "core": bool, "gloss": str}

    def add(name, core):
        k = key_of(name)
        if k in general or (k in notin and not core):
            return None
        row = answers.setdefault(k, {"d": None, "al": set(), "core": core, "gloss": ""})
        row["core"] = row["core"] or core
        shown = name.replace("_", " ").strip()
        if shown != k and (proper or core) and row["d"] is None:
            row["d"] = shown
        return k

    for name in spec.get("core", []):
        add(name, True)
    for name in top:
        if name not in answers:
            add(name, True)
    hand_alias = {}
    for target, alts in spec.get("aliases", {}).items():
        t = key_of(target)
        if t not in answers and add(target, True) is None:
            continue   # the target itself is ruled out (too general)
        for a in alts:
            a = key_of(a)
            if a != t:
                hand_alias[a] = t
    # A hand alias beats an answer of the same name (budgerigar -> budgie).
    for a, t in hand_alias.items():
        if a in answers and not (a in top):
            answers.pop(a)
        if a not in answers:
            answers[t]["al"].add(a)

    roots = spec.get("roots", [])
    if roots:
        synsets = subtree(roots, spec.get("inst", False))
        allowed = set(synsets)
        collapse = {}
        for root, target in spec.get("collapse", {}).items():
            for s in [wn.synset(root)] + list(wn.synset(root).closure(lambda s: s.hyponyms())):
                collapse.setdefault(s, key_of(target))
        keep = {key_of(k) for k in spec.get("keep", [])}
        for s in synsets:
            names = []
            for lemma in s.lemmas():
                raw = lemma.name()
                k = key_of(raw)
                if k in general or k in stop or key_of(raw) in notin or len(k) > 30 or not re.search(r"[a-z]", k):
                    continue
                caps = raw[0].isupper()
                if caps and not (proper or s in collapse):
                    continue
                if not caps and not bc.main_sense(raw, s, allowed):
                    continue
                names.append((k, raw, lemma))
            if not names:
                continue
            keys = [k for k, _, _ in names]
            target = collapse.get(s)
            if target and not any(k in keep for k in keys):
                owner = target
            else:
                known = [k for k in keys if k in answers or k in hand_alias]
                if known:
                    owner = known[0] if known[0] in answers else hand_alias[known[0]]
                else:
                    usable = [(k, raw) for k, raw, _ in names if bc.zipf_estimate(k) >= 0.3 or proper]
                    if not usable:
                        continue
                    k, raw = usable[0] if proper else max(usable, key=lambda p: bc.zipf_estimate(p[0]))
                    owner = add(raw, False)
                    if owner is None:
                        continue
                    answers[owner]["gloss"] = bc.gloss(s)
            if owner not in answers:
                continue
            for k, raw, lemma in names:
                if k != owner and k not in answers and hand_alias.get(k, owner) == owner:
                    answers[owner]["al"].add(k)
                if spec.get("adj"):   # happy for happiness, rainy for rain
                    for rel in lemma.derivationally_related_forms():
                        if rel.synset().pos() in ("a", "s"):
                            a = key_of(rel.name())
                            if a not in answers and a not in hand_alias and a not in general:
                                answers[owner]["al"].add(a)

    # A name claimed by two answers is dropped, unless it is just one of them spaced differently.
    owners = {}
    for k, row in answers.items():
        for a in row["al"]:
            owners.setdefault(a, []).append(k)
    squash = lambda x: re.sub(r"[^a-z0-9]", "", x)
    for a, ks in owners.items():
        if a in answers or len(ks) > 1:
            same = [k for k in ks if squash(k) == squash(a)] if a not in answers else []
            hand = [k for k in ks if hand_alias.get(a) == k]
            winner = (hand or same or [None])[0]
            for k in ks:
                if k != winner or a in answers:
                    answers[k]["al"].discard(a)

    # How readily each answer comes to mind: hand-set for the typical ones, word frequency for the rest.
    rows = []
    for k, row in answers.items():
        rows.append({"a": k, "core": row["core"], "recall": top.get(k, recall_guess(k)), "al": sorted(row["al"]), "d": row["d"], "gloss": row["gloss"]})
    fixed = sum(r["recall"] for r in rows if r["a"] in top)
    tail = [r for r in rows if r["a"] not in top]
    core_sum = sum(r["recall"] for r in tail if r["core"]) or 1
    factor = max(1.2, 7.0 - fixed) / core_sum
    for r in tail:
        r["recall"] = min(0.09, r["recall"] * factor) if r["core"] else min(0.03, r["recall"] * factor * 0.5)
    return rows, general, notin


def pattern_words():
    """Every dictionary word, with which are proper names, loaded once."""
    if not hasattr(pattern_words, "cache"):
        web_raw = get_english_words_set(["web2"], lower=False)
        web_lower = {w.lower() for w in web_raw if w.islower()}
        lemmas = {l for s in wn.all_synsets() for l in s.lemma_names() if l.islower() and re.fullmatch(r"[a-z]+", l)}
        common = [w for w in top_n_list("en", 400000) if re.fullmatch(r"[a-z]+", w)]
        pattern_words.cache = ({w for w in web_lower | lemmas if re.fullmatch(r"[a-z]+", w)}, lemmas, common)
    return pattern_words.cache


def build_pattern(spec):
    kind, text = spec["pattern"]
    fits = {"start": lambda w: w.startswith(text), "end": lambda w: w.endswith(text), "has": lambda w: text in w}[kind]
    dictionary, lemmas, common = pattern_words()

    def base_of(w):
        for pos in ("v", "n", "a"):
            b = wn.morphy(w, pos)
            if b and b != w and b in dictionary:
                return b
        return None

    words = {w for w in dictionary if fits(w) and len(w) > len(text)}
    # Fold word forms into their base (snapped -> snap) when the base is an answer too.
    bases = {}
    for w in set(words) | {w for w in common if len(w) > len(text)}:
        b = base_of(w)
        if b and b in words:
            bases[w] = b
    words -= set(bases)
    # Obscure dictionary-only entries are kept only if a second source knows them or they are in real use.
    words = {w for w in words if w in lemmas or zipf_frequency(w, "en") >= 1.0}
    words = {w for w in words if not (ROMAN.match(w) and w not in NOT_ROMAN)}   # xxix is a numeral, not a word
    rows = []
    for w in sorted(words):
        z = DEMOTE.get(w, zipf_frequency(w, "en"))
        recall = max(0.0003, 0.55 / (1 + math.exp(-(z - 4.3) * 1.8)))
        rows.append({"a": w, "core": z >= 2.2, "recall": recall, "al": sorted(f for f, b in bases.items() if b == w), "d": None, "gloss": ""})
    return rows, set(), set()


def classic(key):
    """The first five questions, defined from the lists in build_categories.py."""
    title, icon, prompt, hint = next((t, i, p, h) for k, t, i, p, h in bc.CATEGORIES if k == key)
    sources = {"fruits": bc.FRUITS, "kitchen": bc.KITCHEN, "wheels": bc.WHEELS}
    if key == "animals":
        animal = []
        for line in bc.ANIMALS:
            text = " " + line + " "
            for m in bc.ANIMAL_MULTI:
                text = text.replace(" " + m + " ", " ")
            animal += text.split()
        sources["animals"] = animal + bc.ANIMAL_MULTI
    hand_targets = {a for v in bc.ALIASES.get(key, {}).values() for a in v if a not in bc.ALIASES.get(key, {})}
    core = [a for a in sources[key] + bc.EXTRA_CORE.get(key, []) if a.strip().lower() not in hand_targets]
    aliases = {k: list(v) for k, v in bc.ALIASES.get(key, {}).items()}
    spec = dict(key=key, title=title, icon={"animals": "paw", "fruits": "apple", "kitchen": "pan", "wheels": "wheel"}[key], prompt=prompt, hint=hint,
                rules=bc.RULES[key], roots=bc.WN_ROOTS[key], core=core, aliases=aliases, top=bc.TOP.get(key, {}),
                collapse=bc.COLLAPSE.get(key, {}), keep=bc.COLLAPSE_KEEP.get(key, set()), general=bc.TOO_GENERAL.get(key, set()),
                notin=bc.NOT_IN.get(key, set()), stop=bc.STOP.get(key, set()))
    if key == "wheels":
        spec["core"] = core + list(bc.MAKES)
        for make, models in bc.MAKES.items():
            spec["aliases"].setdefault(make.lower(), [])
            spec["aliases"][make.lower()] += models
    return spec


def build_question(key):
    spec = qb.Q.get(key) or classic(key)
    rows, general, notin = build_pattern(spec) if "pattern" in spec else build_topic(spec)
    shares = bc.simulate_three_guesses([r["recall"] for r in rows])
    answers = []
    for r, share in zip(rows, shares):
        row = {"a": r["a"], "s": round(max(float(share), 1 / SAMPLE_PLAYERS), 6)}
        if r["d"]:
            row["d"] = r["d"]
        if r["al"]:
            row["al"] = r["al"]
        if not r["core"]:
            row["x"] = 1                      # from the dictionary only: accepted, but not shown on sample boards
        if r["a"] in HIDE:
            row["h"] = 1                      # accepted, never shown on any board
        if r["gloss"] and not r["core"] and row["s"] < 0.002:
            row["b"] = r["gloss"]
        answers.append(row)
    answers.sort(key=lambda r: (-r["s"], r["a"]))
    q = {"key": spec["key"], "title": spec["title"], "icon": spec["icon"], "prompt": spec["prompt"], "hint": spec["hint"],
         "rules": spec["rules"], "answers": answers, "general": sorted(general), "notIn": sorted(notin)}
    if "pattern" in spec:
        q["pattern"] = {"type": spec["pattern"][0], "s": spec["pattern"][1]}
    names = sum(len(r.get("al", [])) for r in answers)
    tip = [r.get("d", r["a"]) for r in answers if r["s"] >= 0.1]
    print(f"  {key:11} {len(answers):5} answers {names:5} other names | tip: {', '.join(tip[:6]) or '(none)'} | "
          f"deep: {', '.join(r.get('d', r['a']) for r in [x for x in answers if not x.get('x')][-3:])}")
    return q


def main() -> None:
    nltk.download("wordnet", quiet=True)
    only = set(sys.argv[1:])
    OUT.mkdir(exist_ok=True)
    # Day 0 is a fixed set used only by the automated tests (tests/matrix.cjs): the first five questions ever written.
    if not only or not (OUT / "0.json").exists():
        print("Day 0 (test fixture)")
        fixture = {"v": 3, "day": 0, "samplePlayers": SAMPLE_PLAYERS, "questions": [build_question(k) for k in ["animals", "fruits", "kitchen", "sn", "wheels"]]}
        (OUT / "0.json").write_text(json.dumps(fixture, separators=(",", ":"), ensure_ascii=False))
    used = [k for row in qb.DAYS for k in row]
    assert len(used) == len(set(used)), "a question is used on two days"
    built = {}
    all_names = set()
    for n, row in enumerate(qb.DAYS, start=1):
        path = OUT / f"{n}.json"
        if only and not (only & set(row)) and path.exists():
            day = json.loads(path.read_text())
        else:
            print(f"Day {n}")
            # Mix the order day to day. The word question (last in each row) moves around but never opens the day.
            topics = row[:4][(n - 1) % 4:] + row[:4][:(n - 1) % 4]
            spot = 4 - (n - 1) % 4
            order = topics[:spot] + [row[4]] + topics[spot:]
            for k in order:
                built[k] = build_question(k)
            day = {"v": 3, "day": n, "samplePlayers": SAMPLE_PLAYERS, "questions": [built[k] for k in order]}
            path.write_text(json.dumps(day, separators=(",", ":"), ensure_ascii=False))
        for q in day["questions"]:
            for r in q["answers"]:
                all_names.add(r["a"])
                all_names.update(r.get("al", []))
    (OUT / "index.json").write_text(json.dumps({"v": 3, "count": len(qb.DAYS), "samplePlayers": SAMPLE_PLAYERS}))
    # Common English words: a real word is never "corrected" into a different answer ("house" is not a typo of "horse").
    common = [w for w in top_n_list("en", 12000) if re.fullmatch(r"[a-z]{4,}", w)]
    (ROOT / "words.json").write_text(json.dumps({"v": 3, "commonWords": " ".join(common)}))
    sizes = [p.stat().st_size // 1024 for p in sorted(OUT.glob("[0-9]*.json"))]
    print(f"wrote {len(sizes)} days ({min(sizes)}-{max(sizes)} KB each), {len(all_names)} names in total")


if __name__ == "__main__":
    main()
