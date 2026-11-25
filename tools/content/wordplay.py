"""Widen the answer lists of the letter-puzzle questions from word lists, so an ordinary word a player types is
recognised even if the writer didn't think of it. Run after writing or editing those questions:

    python3 tools/content/wordplay.py            # adds what's missing, prints counts
    python3 tools/content/wordplay.py --dry      # only says what it would add

A word is added only if it is BOTH reasonably common (in the 60,000 most frequent English words, `wordfreq`) AND a
real dictionary word (WordNet, or the game's own word list). That keeps out names, typos and the truly obscure, so
the puzzle stays "find a surprising word", not "find a legal one" (EDITORIAL.md, "Breadth is not depth").
Added words get a small provisional share by how common they are, and are marked provisional (`pv`): capped at
250 m and shown as "rarity still being measured" until real players give them.
"""
import json, os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
Q = os.path.join(ROOT, "content", "questions")
EXTRA = {"e-five-vowels": ["facetious", "abstemious", "sequoia", "eunoia", "dialogue", "equation", "housemaid", "tambourine", "pneumonia", "cauliflower"]}   # the classics, whatever their frequency

def words():
    import wordfreq
    top = [w for w in wordfreq.top_n_list("en", 60000) if re.fullmatch(r"[a-z]+", w)]
    rank = {w: i for i, w in enumerate(top)}
    real = set(json.load(open(os.path.join(ROOT, "words.json")))["commonWords"].split())
    # WordNet's own entries, but only words it writes in lower case: "Lawrence" and "Saxon" are names, not words.
    wn = os.path.expanduser("~/nltk_data/corpora/wordnet"); lower, caps = set(), set()
    for pos in ("noun", "verb", "adj", "adv"):
        f = os.path.join(wn, "data." + pos)
        if not os.path.exists(f): continue
        for l in open(f, encoding="latin-1"):
            if l.startswith(" "): continue
            t = l.split(); n = int(t[3], 16)
            for k in range(n):
                lemma = re.sub(r"\(.*\)$", "", t[4 + 2 * k])
                if re.fullmatch(r"[a-z]+", lemma): real.add(lemma); lower.add(lemma)
                elif re.fullmatch(r"[A-Z][a-z]+", lemma): caps.add(lemma.lower())
    real -= (caps - lower)          # the game's list has some names in it too: a word WordNet only ever capitalises goes
    # WordNet lists base forms only; an inflected form counts when its base is there.
    def base_ok(w):
        if w in real: return True
        for suf, add in (("ies", "y"), ("es", ""), ("s", ""), ("ed", ""), ("ed", "e"), ("d", ""), ("ing", ""), ("ing", "e"), ("ly", ""), ("er", ""), ("est", "")):
            if w.endswith(suf) and len(w) - len(suf) >= 3 and (w[:-len(suf)] + add) in real: return True
        return False
    crude = re.compile(r"shit|fuck|cunt|piss|bitch|cock|dick|whore|slut|bastard|wank|twat|nigg|fag|retard|porn|rape|bollock|arse|tits|boob")
    return {w: r for w, r in rank.items() if base_ok(w) and not crude.search(w)}

def share(rank): return 0.0008 if rank < 15000 else 0.0004 if rank < 30000 else 0.00018 if rank < 45000 else 0.0001

def stem_of(w, have):
    for suf, add in (("ies", "y"), ("es", ""), ("s", ""), ("ed", ""), ("ed", "e"), ("d", ""), ("ing", ""), ("ing", "e")):
        if w.endswith(suf) and (w[:-len(suf)] + add) in have: return w[:-len(suf)] + add
    return None

def rule_for(q):
    i = q["id"]
    if i == "e-top-row": return lambda w, W: len(w) >= 4 and set(w) <= set("qwertyuiop")
    if i == "e-five-vowels": return lambda w, W: set("aeiou") <= set(w)
    if i == "e-s-front": return lambda w, W: w.startswith("s") and len(w) >= 4 and w[1:] in W and not w[1:].endswith("ss")
    if i == "e-hidden-animal":
        text = " ".join(q["rules"]["accept"]); m = re.search(r"fixed list: ([a-z, ]+)", text)
        animals = [a.strip() for a in m.group(1).split(",") if len(a.strip()) >= 4]
        return lambda w, W: any(a in w and w not in (a, a + "s", a + "es") for a in animals)
    return None

def run(dry=False):
    W = words()
    for i in ("e-top-row", "e-five-vowels", "e-s-front", "e-hidden-animal"):
        f = os.path.join(Q, i + ".json")
        if not os.path.exists(f): print(i, "not written yet"); continue
        q = json.load(open(f)); ok = rule_for(q)
        norm = lambda s: re.sub(r"[^a-z]", "", s.lower())
        byname = {}
        for a in q["answers"]:
            for n in [a["a"], *a.get("al", [])]: byname[norm(n)] = a
        blocked = {norm(x) for x in q.get("notIn", [])}
        cands = sorted((w for w in W if ok(w, W)), key=lambda w: W[w]) + [w for w in EXTRA.get(i, []) if ok(w, W)]
        added = aliased = 0
        for w in cands:
            if w in byname or w in blocked: continue
            if i == "e-s-front" and w[1:] in blocked: continue
            st = stem_of(w, byname)
            if st:   # an inflection of a listed word: the same answer
                byname[st].setdefault("al", []).append(w); byname[w] = byname[st]; aliased += 1; continue
            p = share(W.get(w, 59999))
            row = {"a": w, "al": [w[1:]] if i == "e-s-front" else [], "p": p, "tier": "obscure" if p < 0.0005 else "uncommon", "src": "wordlist", "pv": 1}
            if i == "e-s-front" and row["al"][0] in byname: row["al"] = []
            q["answers"].append(row); byname[w] = row; added += 1
            for n in row["al"]: byname[norm(n)] = row
        print(f"{i}: {len(q['answers']) - added} listed, +{added} words, +{aliased} inflections as other names")
        if not dry: json.dump(q, open(f, "w"), indent=1, ensure_ascii=False)

if __name__ == "__main__":
    run("--dry" in sys.argv)
