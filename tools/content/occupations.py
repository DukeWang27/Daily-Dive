"""Builds content/kb/occupations.json: every job title Deeple accepts for an occupation question, with the other names
people use for them. Run: python3 tools/content/occupations.py

Sources, in order of trust:
  1. The game's own curated job list (days/*.json, key "jobs"): the common answers, with their estimated shares.
  2. O*NET 30.0 (US Department of Labor, CC BY 4.0, content/sources/onet): ~41,000 alternate and reported job titles
     for ~1,000 occupations. Real titles people hold, so they're accepted as answers. Their rarity is only an estimate.
  3. EXTRA below, written by hand: modern and informal titles O*NET lacks (DevOps engineer, UX researcher, quant).

Other names (aliases) come from:
  - ALIASES below: abbreviations, informal and regional names ("quant", "SWE", "ER doctor", "anaesthetist");
  - FIELDS below: the name of a field, mapped to the person who works in it, when that's unambiguous ("accounting"
    -> accountant). Ambiguous fields offer one suggestion instead of counting silently (see validate.js).
The general rules (accounting -> accountant, dentistry -> dentist) live in validate.js; FIELDS covers what the rules
can't ("law" -> lawyer, "medicine" -> doctor).

Rarity: answers from O*NET that the curated list doesn't have are marked provisional (pv). Their share is a cautious
estimate from how common their words are, kept between 0.04% and 0.4% of players: never Unfathomable, never the
maximum, and labelled as an estimate in the game. Real answers replace it as players give them.
"""
import csv, json, os, re, glob
from wordfreq import zipf_frequency

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
SRC = os.path.join(ROOT, "content", "sources", "onet")
norm = lambda s: re.sub(r"\s+", " ", re.sub(r"[^a-z0-9' ]+", " ", s.lower().replace("&", " and "))).strip()

# Titles O*NET doesn't have, or has only in a form nobody types.
EXTRA = """devops engineer, ux researcher, ui designer, ux designer, product designer, growth hacker, prompt engineer, ai engineer,
machine learning engineer, ml engineer, data engineer, analytics engineer, site reliability engineer, platform engineer, cloud engineer,
cloud architect, solutions architect, blockchain developer, smart contract developer, game designer, level designer, technical artist,
mobile developer, ios developer, android developer, front end developer, back end developer, full stack developer, penetration tester,
ethical hacker, bug bounty hunter, security researcher, threat hunter, quantitative researcher, quantitative developer, quant trader,
quant researcher, quant developer, equity research analyst, investment banker, hedge fund manager, private equity associate,
venture capitalist, crypto trader, day trader, market maker, risk analyst, credit analyst, treasury analyst, compliance officer,
tax consultant, financial planner, wealth manager, asset manager, portfolio manager, content creator, influencer, youtuber, streamer,
podcaster, social media manager, community manager, esports player, esports coach, twitch streamer, tiktoker, vlogger, drone pilot,
genetic counselor, medical physicist, embryologist, perfusionist, doula, sonographer, phlebotomist, radiation oncologist,
interventional radiologist, emergency physician, hospitalist, intensivist, neonatologist, cytotechnologist, epidemiologist,
bioinformatician, data annotator, content moderator, delivery rider, rideshare driver, uber driver, food blogger, travel blogger,
tattooist, barber, sommelier, mixologist, chocolatier, fromager, cheesemonger, fishmonger, greengrocer, ironmonger, chimney sweep,
farrier, thatcher, wheelwright, cooper, cordwainer, luthier, piano tuner, bell ringer, town crier, beefeater, lollipop lady,
dinner lady, lollipop man, tea lady, bin man, milkman, paperboy, newsagent, chartered accountant, solicitor, barrister, quantity surveyor,
estate agent, letting agent, publican, landlord, footballer, cricketer, jockey, caddie, umpire, linesman, groundskeeper, greenkeeper,
astronaut, cosmonaut, aquanaut, oceanographer, volcanologist, seismologist, glaciologist, meteorologist, storm chaser, park ranger,
zookeeper, falconer, beekeeper, apiarist, sheep shearer, shepherd, goatherd, cowboy, rancher, ranch hand, vintner, winemaker, brewer,
distiller, maltster, cartographer, surveyor, archivist, conservator, restorer, sign language interpreter, court stenographer,
foley artist, boom operator, gaffer, best boy, grip, key grip, stunt double, body double, voice actor, puppeteer, mime, clown,
ventriloquist, escape artist, sword swallower, fire eater, ringmaster, lion tamer, trapeze artist, tightrope walker, magician, illusionist,
embedded systems engineer, embedded software engineer, firmware engineer, robotics engineer, kindergarten teacher, preschool teacher,
nursery teacher, chandler, ostler, knocker upper, lamplighter, dowser, town crier, scrivener, cooper, fletcher, bowyer, tanner, cobbler,
rag and bone man, mudlark, costermonger, tosher, link boy, crossing sweeper, night soil man, leech collector, rat catcher, whipping boy,
ice cutter, switchboard operator, lift operator, elevator operator, milkmaid, scullery maid, footman, valet, governess, apothecary,
alchemist, scribe, herald, jester, squire, blacksmith, armourer, armorer, general practitioner, registered nurse, emergency medical technician,
chief executive officer, chief financial officer, chief technology officer, chief operating officer, chief marketing officer,
chief information security officer, site reliability engineer, database administrator, physician, emergency physician, quantitative trader,
quantitative analyst, quantitative researcher, information security analyst, certified public accountant, human resources manager,
crime scene investigator, forensic investigator, loss adjuster, ship's pilot, wine taster, city councillor, city council member, hospice nurse,
session musician, art restorer, antique dealer, oil rig worker, roughneck, offshore driller, hvac technician, hvac engineer, cinematographer,
choreographer, stenographer, taxidermist, glassblower, horticulturist, locksmith, veterinary surgeon, veterinary scientist"""

# Other names: abbreviations, informal, regional (UK/US), slang. alias -> the answer it means.
ALIASES = {
    "quant": "quantitative analyst", "quants": "quantitative analyst", "quant analyst": "quantitative analyst",
    "ib": "investment banker", "ibanker": "investment banker", "i banker": "investment banker", "investment bank analyst": "investment banker",
    "swe": "software engineer", "software dev": "software developer", "dev": "software developer", "coder": "programmer",
    "sre": "site reliability engineer", "mle": "machine learning engineer", "ml engineer": "machine learning engineer",
    "dba": "database administrator", "sysadmin": "system administrator", "sys admin": "system administrator",
    "infosec analyst": "information security analyst", "cybersecurity analyst": "information security analyst",
    "cyber security analyst": "information security analyst", "security analyst": "information security analyst",
    "pentester": "penetration tester", "pen tester": "penetration tester", "white hat hacker": "ethical hacker",
    "er doctor": "emergency physician", "a and e doctor": "emergency physician", "emergency doctor": "emergency physician",
    "emergency medicine physician": "emergency physician", "er physician": "emergency physician",
    "gp": "general practitioner", "family doctor": "general practitioner", "family physician": "general practitioner",
    "anaesthetist": "anesthesiologist", "anesthetist": "anesthesiologist", "gas man": "anesthesiologist",
    "paediatrician": "pediatrician", "orthopaedic surgeon": "orthopedic surgeon", "gynaecologist": "gynecologist",
    "obgyn": "obstetrician", "ob gyn": "obstetrician", "shrink": "psychiatrist", "vet": "veterinarian", "doc": "doctor",
    "cpa": "certified public accountant", "acca": "chartered accountant", "bean counter": "accountant",
    "cfa": "financial analyst", "ifa": "financial adviser", "financial advisor": "financial adviser",
    "cop": "police officer", "policeman": "police officer", "policewoman": "police officer", "copper": "police officer",
    "fireman": "firefighter", "firewoman": "firefighter", "postman": "postal worker", "mailman": "postal worker", "postie": "postal worker",
    "dustman": "refuse collector", "garbage man": "refuse collector", "garbageman": "refuse collector", "binman": "refuse collector", "bin man": "refuse collector",
    "chippy": "carpenter", "sparky": "electrician", "brickie": "bricklayer", "plod": "police officer", "lollipop lady": "crossing guard", "lollipop man": "crossing guard",
    "air hostess": "flight attendant", "stewardess": "flight attendant", "steward": "flight attendant", "cabin crew": "flight attendant",
    "realtor": "real estate agent", "estate agent": "real estate agent", "attorney": "lawyer", "attorney at law": "lawyer",
    "solicitor": "solicitor", "barrister": "barrister", "hr": "human resources manager", "hr manager": "human resources manager",
    "ceo": "chief executive officer", "cfo": "chief financial officer", "cto": "chief technology officer", "coo": "chief operating officer",
    "cmo": "chief marketing officer", "ciso": "chief information security officer",
    "dj": "disc jockey", "mc": "master of ceremonies", "emt": "emergency medical technician", "paramedic": "paramedic",
    "rn": "registered nurse", "lpn": "licensed practical nurse", "np": "nurse practitioner", "crna": "nurse anesthetist",
    "pt": "physical therapist", "physio": "physiotherapist", "ot": "occupational therapist", "slp": "speech language pathologist",
    "speech therapist": "speech language pathologist", "dental nurse": "dental assistant", "chemist": "chemist", "pharmacist": "pharmacist",
    "trucker": "truck driver", "lorry driver": "truck driver", "hgv driver": "truck driver", "cabbie": "taxi driver", "cab driver": "taxi driver",
    "uber driver": "rideshare driver", "lyft driver": "rideshare driver", "barkeep": "bartender", "barman": "bartender", "barmaid": "bartender",
    "waitress": "waiter", "server": "waiter", "dishie": "dishwasher", "kp": "kitchen porter", "cook": "chef", "line cook": "line cook",
    "nanny": "nanny", "childminder": "childcare worker", "au pair": "au pair", "mortician": "funeral director", "undertaker": "funeral director",
    "headmaster": "head teacher", "headmistress": "head teacher", "principal": "school principal", "prof": "professor", "lecturer": "lecturer",
    "teaching assistant": "teaching assistant", "ta": "teaching assistant", "tradie": "tradesperson", "tradesman": "tradesperson",
    "handyman": "handyman", "odd job man": "handyman", "spook": "spy", "secret agent": "spy", "intelligence officer": "intelligence officer",
    "soldier": "soldier", "squaddie": "soldier", "grunt": "soldier", "marine": "marine", "sailor": "sailor", "seaman": "sailor",
    "youtuber": "youtuber", "content creator": "content creator", "influencer": "influencer", "tiktoker": "content creator",
    "ux researcher": "ux researcher", "user researcher": "ux researcher", "ui ux designer": "ux designer",
}
# Short forms that mean several different jobs: the player is asked for the full name (no guess used).
AMBIGUOUS = {"pm": ["product manager", "project manager", "prime minister"], "pa": ["personal assistant", "physician assistant"],
             "md": ["doctor", "managing director"], "rep": ["sales representative", "union representative"], "ae": ["account executive", "emergency physician"],
             "analyst": None, "manager": None}
# The name of a field, for the person who works in it, where that's clear. A list means it isn't: the game offers the
# first as a suggestion ("Did you mean ...?") and counts nothing until the player says yes.
FIELDS = {
    "law": ["lawyer"], "medicine": ["doctor"], "nursing": ["nurse"], "surgery": ["surgeon"], "carpentry": ["carpenter"],
    "masonry": ["stonemason"], "teaching": ["teacher"], "politics": ["politician"], "acting": ["actor"], "journalism": ["journalist"],
    "accounting": ["accountant"], "accountancy": ["accountant"], "bookkeeping": ["bookkeeper"], "auditing": ["auditor"],
    "investment banking": ["investment banker"], "banking": ["banker"], "trading": ["trader"], "quant trading": ["quantitative trader"],
    "quantitative trading": ["quantitative trader"], "quantitative research": ["quantitative researcher"],
    "quantitative analysis": ["quantitative analyst"], "quantitative finance": ["quantitative analyst", "quantitative trader", "quantitative researcher"],
    "quant finance": ["quantitative analyst", "quantitative trader", "quantitative researcher"], "finance": ["financial analyst", "banker"],
    "equity research": ["equity research analyst"], "private equity": ["private equity associate"], "venture capital": ["venture capitalist"],
    "asset management": ["asset manager"], "portfolio management": ["portfolio manager"], "wealth management": ["wealth manager"],
    "financial planning": ["financial planner"], "financial analysis": ["financial analyst"], "risk management": ["risk manager"],
    "insurance": ["insurance agent", "underwriter", "actuary"], "actuarial science": ["actuary"], "underwriting": ["underwriter"],
    "consulting": ["consultant"], "management consulting": ["management consultant"], "marketing": ["marketer"], "sales": ["salesperson"],
    "real estate": ["real estate agent"], "software development": ["software developer"], "software engineering": ["software engineer"],
    "web development": ["web developer"], "game development": ["game developer"], "programming": ["programmer"], "coding": ["programmer"],
    "data science": ["data scientist"], "data analysis": ["data analyst"], "data engineering": ["data engineer"], "machine learning": ["machine learning engineer"],
    "cybersecurity": ["information security analyst"], "cyber security": ["information security analyst"], "information security": ["information security analyst"],
    "devops": ["devops engineer"], "product management": ["product manager"], "project management": ["project manager"], "ux design": ["ux designer"],
    "graphic design": ["graphic designer"], "fashion design": ["fashion designer"], "interior design": ["interior designer"], "architecture": ["architect"],
    "dentistry": ["dentist"], "pharmacy": ["pharmacist"], "physiotherapy": ["physiotherapist"], "physical therapy": ["physical therapist"],
    "psychiatry": ["psychiatrist"], "psychology": ["psychologist"], "radiology": ["radiologist"], "anesthesiology": ["anesthesiologist"],
    "anaesthesia": ["anesthesiologist"], "veterinary medicine": ["veterinarian"], "emergency medicine": ["emergency physician"],
    "plumbing": ["plumber"], "electrical work": ["electrician"], "welding": ["welder"], "roofing": ["roofer"], "farming": ["farmer"],
    "fishing": ["fisherman"], "baking": ["baker"], "cooking": ["chef"], "hairdressing": ["hairdresser"], "photography": ["photographer"],
    "film": ["filmmaker", "actor"], "filmmaking": ["filmmaker"], "music": ["musician"], "art": ["artist"], "writing": ["writer"],
    "translation": ["translator"], "interpreting": ["interpreter"], "aviation": ["pilot"], "piloting": ["pilot"], "the military": ["soldier"],
    "the army": ["soldier"], "the navy": ["sailor"], "policing": ["police officer"], "firefighting": ["firefighter"], "social work": ["social worker"],
    "engineering": ["engineer"], "civil engineering": ["civil engineer"], "mechanical engineering": ["mechanical engineer"],
    "electrical engineering": ["electrical engineer"], "chemical engineering": ["chemical engineer"], "biomedical engineering": ["biomedical engineer"],
    "research": ["researcher", "scientist"], "science": ["scientist"], "academia": ["professor", "lecturer"], "retail": ["shop assistant", "cashier"],
    "hospitality": ["hotel manager", "waiter"], "construction": ["construction worker"], "manufacturing": ["factory worker"],
    "mining": ["miner"], "logging": ["logger"], "forestry": ["forester"], "nutrition": ["nutritionist"], "dietetics": ["dietitian"],
    "optometry": ["optometrist"], "podiatry": ["podiatrist"], "midwifery": ["midwife"], "chiropractic": ["chiropractor"],
    "veterinary science": ["veterinarian"], "economics": ["economist"], "statistics": ["statistician"], "mathematics": ["mathematician"], "physics": ["physicist"],
    "chemistry": ["chemist"], "biology": ["biologist"], "geology": ["geologist"], "astronomy": ["astronomer"],
}

def display(t):
    """Lower case, keeping short acronyms (CEO, UX, IT) as they are."""
    return " ".join(w if (w.isupper() and len(w) <= 4 and len(w) > 1) else w.lower() for w in t.split())

def bare(t):
    """Not a job title on its own: a bare acronym ("PM", "SRE": several jobs share some) or a single word for the work
    rather than the worker ("Farming"). Acronyms people do use come in through ALIASES, pointing at one job."""
    w = t.split()
    return (len(w) == 1 and (t.isupper() or t.lower().endswith("ing")))

# British and American spellings of the same title, both accepted.
UKUS = [("counselor", "counsellor"), ("labor", "labour"), ("color", "colour"), ("center", "centre"), ("theater", "theatre"), ("jeweler", "jeweller"),
        ("traveler", "traveller"), ("pediatric", "paediatric"), ("anesthe", "anaesthe"), ("orthoped", "orthopaed"), ("gynec", "gynaec"),
        ("hematolog", "haematolog"), ("izer", "iser"), ("ization", "isation"), ("modeler", "modeller"), ("program ", "programme "), ("armorer", "armourer"),
        ("harbor", "harbour"), ("tire ", "tyre "), ("aluminum", "aluminium"), ("estheti", "aestheti"), ("defense", "defence"), ("license", "licence")]

def share_of(name):
    z = min((zipf_frequency(w, "en") for w in norm(name).split()), default=0.0)
    return round(min(4e-3, max(4e-4, 3e-4 * 10 ** (0.3 * (z - 2.5)))), 6)

def main():
    rows, seen = [], {}
    # 1. The curated list, as the game already has it.
    cur = None
    for p in sorted(glob.glob(os.path.join(ROOT, "days", "*.json"))):
        for q in json.load(open(p)).get("questions", []):
            if q.get("key") == "jobs": cur = q; break
        if cur: break
    for a in cur["answers"]:
        r = {"a": a["a"], "s": a["s"], "al": list(a.get("al", []))}; rows.append(r); seen[norm(a["a"])] = r
        for x in r["al"]: seen.setdefault(norm(x), r)
    # 2. O*NET titles, and 3. the hand-written extras.
    titles = {}
    for f, col in (("Alternate Titles.txt", "Alternate Title"), ("Sample of Reported Titles.txt", "Reported Job Title")):
        for r in csv.DictReader(open(os.path.join(SRC, f)), delimiter="\t"):
            t = r[col].strip()
            if re.fullmatch(r"[A-Za-z][A-Za-z '\-&.]*", t) and len(t.split()) <= 4 and not bare(t): titles.setdefault(norm(t), display(t))
            st = (r.get("Short Title") or "").strip()
            if st and st != "n/a" and re.fullmatch(r"[A-Za-z][A-Za-z '\-&.]*", st) and len(st.split()) <= 4 and not bare(st): titles.setdefault(norm(st), display(st))
    # The occupations' own names, singular and without their qualifiers: "Kindergarten Teachers, Except Special Education".
    for r in csv.DictReader(open(os.path.join(SRC, "Occupation Data.txt")), delimiter="\t"):
        t = re.split(r",| and | or ", r["Title"])[0].strip()
        if len(t.split()) <= 4 and re.fullmatch(r"[A-Za-z][A-Za-z '\-]*s", t): titles.setdefault(norm(t[:-1]), display(t[:-1]))
    for t in re.split(r",\s*", EXTRA): titles.setdefault(norm(t), t.strip())
    for k in set(v[0] for v in FIELDS.values() if v) | set(v for v in ALIASES.values() if v): titles.setdefault(norm(k), k)
    n_onet = 0
    for k, t in sorted(titles.items()):
        if k in seen: continue
        # "Senior Accountant", "Lead Accountant": the same job.
        base = re.sub(r"^(senior|junior|lead|staff|principal|associate|assistant to the) ", "", k)
        if base != k and base in seen and not k.startswith("associate"): seen[base]["al"].append(t); seen[k] = seen[base]; continue
        r = {"a": t, "s": share_of(t), "al": [], "pv": 1}; rows.append(r); seen[k] = r; n_onet += 1
    # British spellings of American titles, and back.
    for r in rows:
        k = norm(r["a"])
        for us, uk in UKUS:
            for a, b in ((us, uk), (uk, us)):
                if a in k + " ":
                    v = (k + " ").replace(a, b).strip()
                    if v not in seen: r["al"].append(v); seen[v] = r
    # Other names.
    for al, to in ALIASES.items():
        if not to: continue
        tgt = seen.get(norm(to))
        if tgt and norm(al) not in seen: tgt["al"].append(al); seen[norm(al)] = tgt
    fields = {k: v for k, v in FIELDS.items() if all(norm(x) in seen for x in v)}
    missing = sorted(k for k, v in FIELDS.items() if k not in fields)
    out = {"derive": "person", "source": "Deeple curated list + O*NET 30.0 (USDOL/ETA, CC BY 4.0) + hand-written titles", "rows": rows, "fields": fields,
           "ambiguous": {k: v for k, v in AMBIGUOUS.items() if v}}
    os.makedirs(os.path.join(ROOT, "content", "kb"), exist_ok=True)
    json.dump(out, open(os.path.join(ROOT, "content", "kb", "occupations.json"), "w"), separators=(",", ":"))
    print(f"{len(rows)} answers ({len(cur['answers'])} curated, {n_onet} from O*NET and extras), {sum(len(r['al']) for r in rows)} other names, {len(fields)} fields")
    if missing: print("fields whose answers are missing:", missing)

if __name__ == "__main__":
    main()
