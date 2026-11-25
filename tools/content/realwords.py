"""Builds realwords.txt: real English words (WordNet lemmas, 4+ letters, lower case) that are not already in the common
word list in words.json. The answer checker uses it only to avoid "correcting" a correctly spelt real word into a
different answer. WordNet 3.0 licence: free for any use with attribution (Princeton University). Usage: python3 tools/content/realwords.py"""
import json, os
from nltk.corpus import wordnet as wn
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
common = set(json.load(open(os.path.join(ROOT, "words.json")))["commonWords"].split(" "))
lem = {l for s in wn.all_synsets() for l in s.lemma_names() if l.islower() and l.isalpha() and len(l) >= 4}
open(os.path.join(ROOT, "realwords.txt"), "w").write(" ".join(sorted(lem - common)))
print(len(lem - common), "words")
