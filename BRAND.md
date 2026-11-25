# The name: Deeple

**Status:** chosen by the owner on 25 November 2026. `brand.js` now defaults to `deeple`; the earlier candidates
(Iceberg, Nero Deep and the rest) stay available as previews with `?brand=<key>`. Nothing has been bought or
registered: check the name and a web address are free before launch.

- **Why:** Deep, plus the "-le" ending of daily puzzle games, so people read "daily guessing game" at a glance. One
  word, easy to say and spell. The game is still a dive down an iceberg, so the scene, the iceberg artwork and the
  word "iceberg" inside the game are unchanged.
- **The deepest level** is called Challenger Deep (the owner's choice, also 25 November 2026).
- **Mark and icons:** the game's own faceted iceberg in miniature, in the artwork's colours (`iceberg.js`), lit from the
  moon side, with a waterline and the larger mass below tapering to a point. Smooth edges at every size. The tab and
  home-screen icon put it on night sky over the sea, as in the game. `tools/icons.cjs` writes `favicon.svg` and
  `apple-touch-icon.png` from `brand.js`; `tools/og.cjs deeple` writes the link preview `og/deeple.png`.
- **Saved progress** is stored under a fixed internal key, so the rename keeps everyone's streaks.

---

Earlier research, kept for the record:

## Earlier recommendation: Nero Deep

**Status:** recommended on 24 November 2026, waiting for the owner's approval. The live game is still called Iceberg.
Nothing has been bought or registered.

## The decision

Call the game **Nero Deep**. In 1899 a sounding line from the USS Nero, near Guam, touched bottom at about 9,660 m,
the deepest water then measured. Deeper spots have been found since, and the name has slipped out of common knowledge.
A forgotten deepest point is what this game rewards.

It keeps the qualities of Mariana (the trench, depth, two calm words) without Mariana's search problem, since it is not a
person's name or a place people book trips to. "Have you played Nero Deep today?" sounds natural. It covers both modes,
Daily Dive and Submarine Race, where Iceberg only described the picture.

## The five finalists

Domains were checked on 24 November 2026 through the registries' own lookups (RDAP):
- `.com`, `play___.com` and `___game.com` through Verisign;
- `.io` through Identity Digital.

"Free" means not registered at that moment, not that it is for sale at the normal price.

| Name | .com | play___.com | ___game.com | .io | Main finding |
|---|---|---|---|---|---|
| **Nero Deep** (pick) | Free | Free | Free | Free | No same-name game. A small Italian trip-hop band uses the name; Nero AG holds many NERO software marks |
| Meteor Deep | Free | Free | Free | Free | Cleanest search results, but "meteor" reads as space; a games company holds a METEOR mark |
| Fathom Five | Taken (1998) | Free | Free | Free | Best double meaning, but crowded (a park, a board game, a 2023 jam game) and tied to the number five |
| Trieste | Taken (1996) | Free | Taken | Taken | Elegant, but the Italian city fills every search |
| Sirena Deep | Free | Free | Free | Free | An itch.io submarine game already has this exact name |

**Could not be verified here:**
- `.game` (the registry refuses lookups from this environment), `.gg` (no public lookup) and `.app` (blocked);
- social handles;
- trademark registers;
- domain prices.

Nothing in this file is trademark clearance.

About 40 names were screened. The cuts and their reasons are on the review page, including:
- Mariana, Mariana Deep, Sirena, Hadal, Abyssal, Nadir, Depthline and Deepmark;
- Point Nemo, Obscura, 11000, Third Dive, Sedna, Aphotic and Olokun.

## The identity

All of this lives in `brand.js`, under the key `nerodeep`.

- **Mark:** a sounding line made of the surface bar, the line with its depth marks, and a glowing lead weight. It is drawn on a 16-pixel grid.
- **Wordmark:** Pixelify Sans, with "Deep" in pale blue. Inter is used for everything else. Both fonts are under the SIL Open Font Licence.
- **Colours:**

  | Colour | Hex | Use |
  |---|---|---|
  | Night sea | `#040917` | background |
  | Deep navy | `#071433` | icon, panels |
  | Ice white | `#eaf6ff` | name, buttons |
  | Pale blue | `#8fd0f5` | accent |
  | Living light | `#7df0df` | earned moments |
  | Challenger Deep red | `#e0645b` | beneath the iceberg only |

- **Tagline:** "Three guesses. How deep can you go?" This is the owner's line, kept. Krillion's share card says "How far down can you go?". If that closeness ever matters, use "Three guesses. The rarer, the deeper." instead.
- **Search title:** "Nero Deep: the daily dive where rare answers sink deepest".
- **Link preview:** `og/nerodeep.png`, 1200 × 630. To redraw every name's image, run `node tools/og.cjs`.

## Trying it, and switching

- **To try a name:** any copy of the game takes `?brand=nerodeep`, as do `meteordeep`, `fathomfive`, `trieste` and `sirenadeep`. This changes nothing for other players.
- **To switch for real:** set `DEFAULT = "nerodeep"` in `brand.js`, then change the `og:image` and `twitter:image` addresses in `index.html` to `og/nerodeep.png`.
  - Saved progress is stored under a fixed internal key, so nobody's streak or account is affected.
- **Before launching under the name:**
  - register nerodeep.com, playnerodeep.com and nerodeep.io;
  - claim the social handles;
  - have a trademark lawyer run a knockout search, paying particular attention to Nero AG's marks.
