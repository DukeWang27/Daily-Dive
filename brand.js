// The game's name and identity, in one place. Everything a player reads that names the game comes from here:
// the header, the home page, the browser tab, the search-engine text, the share card and the share message.
//
// To rename the game: change DEFAULT below to another entry (or add one). Nothing else needs editing.
// To try a name without changing anything: open the game with ?brand=<key>, for example ?brand=oddfish.
// Saved progress is stored under a fixed internal key, so renaming never loses anyone's streak.
(function () {
  "use strict";
  const DEFAULT = "iceberg";

  // Colours every mark is drawn in.
  const INK = { ice: "#eaf6ff", accent: "#8fd0f5", lumen: "#7df0df", deep: "#06112a" };

  // Each mark is drawn on a 16 x 16 grid from a few flat shapes, so it stays crisp at tab size and scales up cleanly.
  const BRANDS = {
    // The recommendation (third round, November 2026): see BRAND.md for the research behind it.
    nerodeep: {
      name: "Nero Deep", parts: ["Nero", " Deep"], noun: "dive",
      tagline: ["Three guesses.", "How deep can you go?"],
      title: "Nero Deep: the daily dive where rare answers sink deepest",
      description: "Five questions a day, three guesses each. The fewer players who give your answer, the deeper it sinks. Race other players in live submarine races. Free, in your browser.",
      mark: [{ d: "M1 1h14v2H1z", fill: "accent" }, { d: "M7.3 3h1.4v8.4H7.3z", fill: "ice" }, { d: "M9.6 5h2v1.2h-2zM9.6 8h2v1.2h-2z", fill: "accent" }, { d: "M8 10.2l2.4 2.4L8 15l-2.4-2.4z", fill: "lumen" }],
      concept: "A sounding line with its depth marks and its lead weight: how the Nero Deep was found in 1899.",
    },
    // The other finalists, kept so each can be tried in the real game with ?brand=<key>.
    meteordeep: {
      name: "Meteor Deep", parts: ["Meteor", " Deep"], noun: "dive",
      tagline: ["Three guesses.", "How deep can you go?"],
      title: "Meteor Deep: the daily dive where rare answers sink deepest",
      description: "Five questions a day, three guesses each. The fewer players who give your answer, the deeper it sinks. Free, in your browser.",
      mark: [{ d: "M2 1h2.4l6 6H8z", fill: "accent" }, { d: "M8 7l3.6 3.6L8 14.2l-3.6-3.6z", fill: "ice" }, { d: "M1 15h14v-1H1z", fill: "lumen" }],
      concept: "Something bright falling into the trench.",
    },
    fathomfive: {
      name: "Fathom Five", parts: ["Fathom", " Five"], noun: "dive",
      tagline: ["Three guesses.", "How deep can you go?"],
      title: "Fathom Five: five questions, three guesses, one deep answer",
      description: "Five questions a day, three guesses each. The fewer players who give your answer, the deeper it sinks. Free, in your browser.",
      mark: [{ d: "M1 2h14v1.6H1z", fill: "ice" }, { d: "M1 5.4h11v1.4H1zM1 8.4h8v1.4H1zM1 11.4h5v1.4H1z", fill: "accent" }, { d: "M11.6 11l2 2-2 2-2-2z", fill: "lumen" }],
      concept: "Five fathom marks, each shorter, and an answer below them.",
    },
    trieste: {
      name: "Trieste", parts: ["Tri", "este"], noun: "dive",
      tagline: ["Three guesses.", "How deep can you go?"],
      title: "Trieste: the daily dive where rare answers sink deepest",
      description: "Five questions a day, three guesses each. The fewer players who give your answer, the deeper it sinks. Free, in your browser.",
      mark: [{ d: "M3 3h10v6.4H3z", fill: "accent" }, { d: "M6.6 1h2.8v2H6.6z", fill: "ice" }, { d: "M8 9.4l2.6 2.6L8 14.6 5.4 12z", fill: "ice" }],
      concept: "The bathyscaphe's float and the crew sphere beneath it.",
    },
    mariana: {
      name: "Mariana", parts: ["Mari", "ana"], noun: "iceberg",
      tagline: ["Three guesses.", "The rarer, the deeper."],
      title: "Mariana: the daily game where rare answers go deeper",
      description: "Five questions a day, three guesses each. The fewer players who share your answer, the deeper it sinks. A free daily game in your browser.",
      mark: [{ d: "M1 2h3v3.4c0 3.4 1.8 5.6 4 5.6s4-2.2 4-5.6V2h3v3.6C15 10.6 12 14 8 14S1 10.6 1 5.6z", fill: "accent" }, { d: "M8 3.6l1.8 1.8L8 7.2 6.2 5.4z", fill: "ice" }],
      concept: "The trench's crescent, and an answer on its way down.",
    },
    marianadeep: {
      name: "Mariana Deep", parts: ["Mariana", " Deep"], noun: "iceberg",
      tagline: ["Three guesses.", "The rarer, the deeper."],
      title: "Mariana Deep: the daily game where rare answers go deeper",
      description: "Five questions a day, three guesses each. The fewer players who share your answer, the deeper it sinks. A free daily game in your browser.",
      mark: [{ d: "M1 2h3v3.4c0 3.4 1.8 5.6 4 5.6s4-2.2 4-5.6V2h3v3.6C15 10.6 12 14 8 14S1 10.6 1 5.6z", fill: "accent" }, { d: "M8 6.4l1.8 1.8L8 10 6.2 8.2z", fill: "lumen" }],
      concept: "The trench's crescent, with something glowing at the bottom.",
    },
    sirenadeep: {
      name: "Sirena Deep", parts: ["Sirena", " Deep"], noun: "iceberg",
      tagline: ["Three guesses.", "The rarer, the deeper."],
      title: "Sirena Deep: the daily game where rare answers go deeper",
      description: "Five questions a day, three guesses each. The fewer players who share your answer, the deeper it sinks. A free daily game in your browser.",
      mark: [{ d: "M8 1l3 3-3 3-3-3z", fill: "ice" }, { d: "M7.2 7h1.6v3H7.2z", fill: "accent" }, { d: "M8 10l5 4.6h-3.4L8 12.8l-1.6 1.8H3z", fill: "accent" }],
      concept: "A siren's tail, diving.",
    },
    isobath: {
      name: "Isobath", parts: ["Iso", "bath"], noun: "iceberg",
      tagline: ["Three guesses.", "The rarer, the deeper."],
      title: "Isobath: the daily game where rare answers go deeper",
      description: "Five questions a day, three guesses each. The fewer players who share your answer, the deeper it sinks. A free daily game in your browser.",
      mark: [{ d: "M1 2h5v1.6H1zM6 3.6h4v1.6H6zM10 2h5v1.6h-5z", fill: "ice" }, { d: "M1 7h4v1.6H1zM5 8.6h6v1.6H5zM11 7h4v1.6h-4z", fill: "accent" }, { d: "M3 12h3v1.6H3zM6 13.6h4v1.6H6zM10 12h3v1.6h-3z", fill: "lumen" }],
      concept: "Lines of equal depth on a sea chart, each one lower.",
    },
    // The first round.
    iceberg: {
      name: "Iceberg", parts: ["Ice", "berg"], noun: "iceberg",
      tagline: ["Three guesses.", "How deep can you go?"],
      title: "Iceberg: the daily game where rare answers go deeper",
      description: "Five questions a day, three guesses each. The fewer players who share your answer, the deeper it sits. How deep can you go?",
      mark: [{ d: "M8 1 13 9H3z", fill: "ice" }, { d: "M3 10h10l-2.5 5h-5z", fill: "accent" }],
      concept: "The tip above the water, the mass below.",
    },
    oddfish: {
      name: "Oddfish", parts: ["Odd", "fish"], noun: "iceberg",
      tagline: ["Three guesses.", "The rarer, the deeper."],
      title: "Oddfish: the daily game where rare answers sink deepest",
      description: "Five questions a day, three guesses each. Say what nobody else says and sink to the bottom of the iceberg. A free daily game in your browser.",
      mark: [{ d: "M5.6 8 1 4v8z", fill: "accent" }, { d: "M9.5 2.5 15 8l-5.5 5.5L4 8z", fill: "ice" }, { d: "M10.5 6h1.5v1.5h-1.5z", fill: "deep" }],
      concept: "The game's own depth marker, the small diamond, given a tail: the one fish that is not like the others.",
    },
    brinicle: {
      name: "Brinicle", parts: ["Brin", "icle"], noun: "iceberg",
      tagline: ["Three guesses.", "How deep can you go?"],
      title: "Brinicle: the daily game where rare answers go deeper",
      description: "Five questions a day, three guesses each. The fewer players who share your answer, the deeper it reaches. A free daily game in your browser.",
      mark: [{ d: "M1 1h14v2H1z", fill: "accent" }, { d: "M5.5 3h5L9 9.5 8 15 7 9.5z", fill: "ice" }],
      concept: "A finger of ice growing down from the surface toward the sea floor.",
    },
    dropstone: {
      name: "Dropstone", parts: ["Drop", "stone"], noun: "iceberg",
      tagline: ["Three guesses.", "How deep can you go?"],
      title: "Dropstone: the daily game where rare answers go deeper",
      description: "Five questions a day, three guesses each. The fewer players who share your answer, the further it falls. A free daily game in your browser.",
      mark: [{ d: "M1 1h14v2H1z", fill: "accent" }, { d: "M7.2 4.6h1.6v1.6H7.2zM7.2 7.2h1.6v1.2H7.2z", fill: "accent" }, { d: "M8 9l3.2 3.2L8 15.4l-3.2-3.2z", fill: "ice" }],
      concept: "A stone let go by the ice, falling through open water.",
    },
    thirddive: {
      name: "Third Dive", parts: ["Third ", "Dive"], noun: "iceberg",
      tagline: ["Three guesses.", "Make the third one count."],
      title: "Third Dive: the daily game where rare answers go deeper",
      description: "Five questions a day, three guesses each. The fewer players who share your answer, the deeper it sits. A free daily game in your browser.",
      mark: [{ d: "M3.4 1 5.8 3.4 3.4 5.8 1 3.4z", fill: "ice" }, { d: "M8 5.6l2.4 2.4L8 10.4 5.6 8z", fill: "accent" }, { d: "M12.6 10.2l2.4 2.4-2.4 2.4-2.4-2.4z", fill: "lumen" }],
      concept: "Three markers, each lower than the last.",
    },
    hadal: {
      name: "Hadal", parts: ["Had", "al"], noun: "iceberg",
      tagline: ["Three guesses.", "How deep can you go?"],
      title: "Hadal: the daily game where rare answers go deeper",
      description: "Five questions a day, three guesses each. The fewer players who share your answer, the deeper it sits. A free daily game in your browser.",
      mark: [{ d: "M1 2h3.4L8 11.4 11.6 2H15l-5.6 13H6.6z", fill: "accent" }, { d: "M8 4.4l1.6 1.6L8 7.6 6.4 6z", fill: "ice" }],
      concept: "A trench, and something small on its way down.",
    },
  };

  const asked = new URLSearchParams(location.search).get("brand") || window.BRAND_PREVIEW;
  const key = asked && BRANDS[asked] ? asked : DEFAULT;
  const B = { key, ...BRANDS[key], INK };

  const markSvg = (b, size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"${size ? ` width="${size}" height="${size}"` : ""} shape-rendering="crispEdges" aria-hidden="true">${b.mark.map(p => `<path d="${p.d}" fill="${INK[p.fill]}"/>`).join("")}</svg>`;
  // A square icon on the night-sea background: the browser tab, a phone's home screen.
  const iconSvg = (b, size = 64) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}"><rect width="24" height="24" rx="5" fill="#071433"/><g transform="translate(4 4)" shape-rendering="crispEdges">${b.mark.map(p => `<path d="${p.d}" fill="${INK[p.fill]}"/>`).join("")}</g></svg>`;
  // The same mark on a canvas (the share card).
  function drawMark(g, b, x, y, size) {
    g.save(); g.translate(x, y); g.scale(size / 16, size / 16);
    for (const p of b.mark) { g.fillStyle = INK[p.fill]; g.fill(new Path2D(p.d)); }
    g.restore();
  }

  // Put the name wherever the page asks for it: data-brand="name", "mark", "wordmark", "tagline".
  function apply(root = document) {
    document.title = B.name;
    const set = (sel, attr, val) => { const n = document.head.querySelector(sel); if (n) n.setAttribute(attr, val); };
    set('meta[name="description"]', "content", B.description);
    set('meta[property="og:title"]', "content", B.title); set('meta[property="og:description"]', "content", B.description);
    set('meta[property="og:image"]', "content", new URL(`og/${key}.png`, location.href).href); set('meta[name="twitter:image"]', "content", new URL(`og/${key}.png`, location.href).href);
    let icon = document.head.querySelector('link[rel="icon"]');
    if (!icon) { icon = document.createElement("link"); icon.rel = "icon"; document.head.append(icon); }
    icon.type = "image/svg+xml"; icon.href = "data:image/svg+xml," + encodeURIComponent(iconSvg(B));
    root.querySelectorAll('[data-brand="name"]').forEach(n => { n.textContent = B.name; });
    root.querySelectorAll('[data-brand="mark"]').forEach(n => { n.innerHTML = markSvg(B); });
    root.querySelectorAll('[data-brand="wordmark"]').forEach(n => { n.textContent = ""; n.append(B.parts[0]); const s = document.createElement("span"); s.textContent = B.parts[1]; n.append(s); });
    root.querySelectorAll('[data-brand="tagline"]').forEach(n => { n.textContent = ""; n.append(B.tagline[0] + " "); const s = document.createElement("span"); s.textContent = B.tagline[1]; n.append(s); });
    root.querySelectorAll("[data-brand-label]").forEach(n => { n.setAttribute("aria-label", n.dataset.brandLabel.replace("{name}", B.name)); });
  }

  window.Brand = { ...B, all: BRANDS, apply, markSvg: (b = B, size) => markSvg(b, size), iconSvg: (b = B, size) => iconSvg(b, size), drawMark: (g, x, y, size, b = B) => drawMark(g, b, x, y, size), slug: B.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") };
})();
