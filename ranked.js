// Ranked 1v1: divisions, their insignia and rating helpers. One place to change the thresholds or the names.
// The divisions follow the water down: from the reef to the deepest trenches. Thresholds are a starting point, to be
// adjusted once real players' ratings are known. Everyone starts at 1,000, in the middle of Current, so a first loss
// isn't a demotion.
(function () {
  const DIVISIONS = [
    { key: "reef", name: "Reef", from: 0, colour: "#ff9d8a", dark: "#7a2f2a" },
    { key: "kelp", name: "Kelp", from: 800, colour: "#7fd67a", dark: "#1f5a2a" },
    { key: "current", name: "Current", from: 950, colour: "#65c5f5", dark: "#14466e" },
    { key: "twilight", name: "Twilight", from: 1100, colour: "#a99cff", dark: "#2f2a6e" },
    { key: "trench", name: "Trench", from: 1250, colour: "#528fff", dark: "#0f2a66" },
    { key: "hadal", name: "Hadal", from: 1400, colour: "#49e8cc", dark: "#0a3d3a" },
    { key: "leviathan", name: "Leviathan", from: 1550, colour: "#ff6259", dark: "#4a0d14" },
  ];
  const divisionOf = elo => DIVISIONS.reduce((d, x) => (elo >= x.from ? x : d), DIVISIONS[0]);
  const nextOf = elo => DIVISIONS.find(x => x.from > elo) || null;

  // Insignia: a 15x15 pixel badge, a rimmed shield with an emblem for each division. Drawn, not an image or an emoji.
  const EMBLEMS = {
    reef:      ["...............", "...............", "......#.#......", "...#..#.#..#...", "...#.##.##.#...", "....###.###....", "...#.#####.#...", "....#######....", ".....#####.....", "......###......", ".......#.......", "...............", "...............", "...............", "..............."],
    kelp:      ["...............", ".......#.......", "......##.......", "......#..#....", ".....##.##.....", ".....#..#......", "....##.##......", "....#..#.......", "...##.##.......", "...#..#........", "......#........", "......#........", "...............", "...............", "..............."],
    current:   ["...............", "...............", "...............", "...##....##....", "..#..#..#..#...", ".#....##....#..", "...............", "...##....##....", "..#..#..#..#...", ".#....##....#..", "...............", "...............", "...............", "...............", "..............."],
    twilight:  ["...............", "...............", ".....####......", "....##..##.....", "...##.....#....", "...#...........", "...#...........", "...##.....#....", "....##..##.....", ".....####......", "...........#...", "..........###..", "...........#...", "...............", "..............."],
    trench:    ["...............", "...............", "...#.......#...", "....#.....#....", ".....#...#.....", "......#.#......", ".......#.......", "...#.......#...", "....#.....#....", ".....#...#.....", "......#.#......", ".......#.......", "...............", "...............", "..............."],
    hadal:     ["...............", "......##.......", ".....#..#......", "......##.......", ".......#.......", "....#######....", "...#.......#...", "..#...#.....#..", "..#.........#..", "...#..###..#...", "....#######....", "...............", "...............", "...............", "..............."],
    leviathan: ["...............", "...............", "....#######....", "...#.......#...", "...#.#...#.#...", "...#.......#...", "....#######....", "....#.#.#.#....", "...#..#.#..#...", "..#..#...#..#..", ".#..#.....#..#.", "...#.......#...", "...............", "...............", "..............."],
  };
  function insignia(canvas, key, px = 3) {
    const d = DIVISIONS.find(x => x.key === key) || DIVISIONS[0], N = 19, g = canvas.getContext("2d");
    canvas.width = canvas.height = N; canvas.style.width = canvas.style.height = N * px + "px"; canvas.style.imageRendering = "pixelated";
    g.clearRect(0, 0, N, N);
    // The shield: flat top, pointed base, a one-pixel rim lit from the top left.
    const inShield = (x, y) => { if (y < 1 || y > 17) return false; const half = y < 11 ? 8 : 8 - (y - 10); return Math.abs(x - 9) <= half; };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!inShield(x, y)) continue;
      const edge = !inShield(x - 1, y) || !inShield(x + 1, y) || !inShield(x, y - 1) || !inShield(x, y + 1);
      g.fillStyle = edge ? (x < 9 || y < 4 ? d.colour : d.dark) : y < 9 ? d.dark : "#06112a"; g.fillRect(x, y, 1, 1);
    }
    g.fillStyle = "rgba(255,255,255,.18)"; for (let x = 3; x < 9; x++) g.fillRect(x, 2, 1, 1);
    const e = EMBLEMS[d.key]; g.fillStyle = d.colour;
    e.forEach((row, y) => [...row].forEach((c, x) => { if (c === "#") g.fillRect(x + 2, y + 2, 1, 1); }));
    return canvas;
  }
  const badge = (elo, px) => { const c = document.createElement("canvas"); c.className = "rk-badge"; insignia(c, divisionOf(elo).key, px); c.setAttribute("aria-hidden", "true"); return c; };
  window.Ranked = { DIVISIONS, divisionOf, nextOf, insignia, badge };
})();
