"""Answer sets for word questions, built from a dictionary and a rule instead of by hand (EDITORIAL-V2 step 7-8;
RARITY-V2: English vocabulary uses corpus frequency).

A word counts if it is a real English word (realwords.txt, from WordNet, plus wordfreq's common English word list
for everyday words WordNet lacks, filtered to dictionary-shaped tokens) and passes the question's rule. Its familiarity
comes from wordfreq's Zipf frequency (how often the word appears in what people read and write; wordfreq is Apache-2.0,
its data CC BY-SA 4.0), mapped to the game's bands. Proper nouns, abbreviations and anything offensive are left out.

  python3 tools/content/wordset.py <rule> [args]       prints JSON: {"answers": [[word, zipf], ...], "count": n}
Rules:
  no-letter <letters>            contains none of these letters (e.g. no-letter e)
  palindrome                     reads the same backwards (3+ letters)
  semordnilap                    another real word when reversed (not a palindrome)
  same-ends <length>             given length, starts and ends with the same letter
  regex <pattern>                matches a Python regex (fullmatch)
Use from Python: wordset.words(), wordset.zipf(w), wordset.band(z).
"""
import json, os, re, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
_WORDS = None
BAD = re.compile(r"(fuck|shit|cunt|nigg|fag|slut|whore|rape|bitch|dick|cock|pussy|twat|wank|spic|kike|chink|retard)")

def words():
    """Real English words: WordNet's list, plus everyday words from wordfreq that are plain lower-case letters."""
    global _WORDS
    if _WORDS is None:
        from wordfreq import top_n_list
        # The game's two word lists: everyday words (words.json commonWords, ~11k) and rarer dictionary words
        # (realwords.txt, from WordNet, which leaves the everyday ones out). Inflected forms (plurals, -ed, -ing) of
        # either are added when wordfreq has seen them, so "desserts" and "stressed" are both there.
        base = set(open(os.path.join(ROOT, "realwords.txt")).read().split()) | set(json.load(open(os.path.join(ROOT, "words.json")))["commonWords"].split())
        base = {w for w in base if re.fullmatch(r"[a-z]{2,}", w)}
        seen = {w for w in top_n_list("en", 80000) if re.fullmatch(r"[a-z]{2,}", w)}
        _WORDS = base | {w for w in seen if _inflected(w, base)}
        _WORDS = {w for w in _WORDS if not BAD.search(w)}
    return _WORDS

def _inflected(w, wn):
    for suf, rep in (("s", ""), ("es", ""), ("ies", "y"), ("ed", ""), ("ed", "e"), ("ing", ""), ("ing", "e"), ("er", ""), ("est", ""), ("ly", "")):
        if w.endswith(suf) and (w[: -len(suf)] + rep) in wn: return True
    return False

def zipf(w):
    from wordfreq import zipf_frequency
    return zipf_frequency(w, "en")

# Zipf bands -> estimated share of players (a word's corpus frequency is a familiarity signal, not a probability of
# being said: so bands, wide, and replaced by real answers as soon as players arrive).
BANDS = [(5.0, "surface", 0.04), (4.2, "shallows", 0.012), (3.4, "midwater", 0.004), (2.6, "deep", 0.0012), (0, "abyss", 0.0003)]
def band(z):
    for lo, name, share in BANDS:
        if z >= lo: return name, share
    return BANDS[-1][1], BANDS[-1][2]

def build(rule, *args):
    W = words(); out = []
    if rule == "no-letter":
        bad = set(args[0].lower()); out = [w for w in W if not (set(w) & bad) and len(w) >= 3]
    elif rule == "palindrome":
        out = [w for w in W if len(w) >= 3 and w == w[::-1]]
    elif rule == "semordnilap":
        out = [w for w in W if len(w) >= 3 and w != w[::-1] and w[::-1] in W]
    elif rule == "same-ends":
        n = int(args[0]); out = [w for w in W if len(w) == n and w[0] == w[-1]]
    elif rule == "regex":
        rx = re.compile(args[0]); out = [w for w in W if rx.fullmatch(w)]
    else: raise SystemExit("unknown rule " + rule)
    rows = sorted(((w, round(zipf(w), 2)) for w in out), key=lambda x: -x[1])
    return rows

if __name__ == "__main__":
    rows = build(sys.argv[1], *sys.argv[2:])
    print(json.dumps({"count": len(rows), "answers": rows[:20] + [["...", 0]] + rows[-5:]}))
