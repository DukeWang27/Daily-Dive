// The rarity palette: one place for the six tier colours, used by the page (as CSS variables), the share card and
// anything drawn on canvas. Change a colour here and it changes everywhere.
(function () {
  const TIERS = {
    tip:      { name: "Common",          hex: "#F1F8FF" },
    shallows: { name: "Uncommon",        hex: "#B5E5FF" },
    mid:      { name: "Rare",            hex: "#65C5F5" },
    deep:     { name: "Very rare",       hex: "#528FFF", glow: 0.28 },
    abyss:    { name: "Exceptional",     hex: "#49E8CC", glow: 0.38 },
    beyond:   { name: "Unfathomable",    hex: "#FF6259", glow: 0.45 },
  };
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(", ");
  const mix = (hex, w, k) => "#" + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - k) + w * k).toString(16).padStart(2, "0")).join("");
  const root = document.documentElement.style;
  for (const [k, t] of Object.entries(TIERS)) { root.setProperty(`--t-${k}`, t.hex); root.setProperty(`--t-${k}-rgb`, rgb(t.hex)); }
  // A lighter red for smaller text beside the main Challenger Deep colour, and the glow behind the deepest tiers.
  root.setProperty("--beyond-soft", mix(TIERS.beyond.hex, 255, 0.3));
  root.setProperty("--beyond-glow", rgb(TIERS.beyond.hex));
  window.DeeplePalette = { TIERS, hex: k => (TIERS[k] || TIERS.tip).hex, rgb: k => rgb((TIERS[k] || TIERS.tip).hex) };
})();
