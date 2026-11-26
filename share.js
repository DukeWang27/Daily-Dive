// The shareable dive: one picture of the day's descent, from the iceberg down to where your five answers took you.
// Spoiler-free by design: it shows depths and zones, never the answers or the questions.
// Drawn on a canvas (1200 × 1500) from the same artwork as the game, so it can be saved as a PNG.
(function () {
  "use strict";
  const I = window.Iceberg, { WW, WH, W, CX, SH } = I.WORLD;
  const B = window.Brand; // the name, mark and tagline (brand.js)
  const PAL = window.DeeplePalette, ZONE = Object.fromEntries(["tip", "shallows", "mid", "deep", "abyss", "beyond"].map(k => [k, PAL.hex(k)])), RED = ZONE.beyond;
  const UI = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', PIXEL = '"Pixelify Sans", ui-monospace, monospace';
  let art = null;

  function diamond(g, x, y, r, fill, ring) {
    g.save(); g.translate(x, y); g.rotate(Math.PI / 4);
    if (ring) { g.fillStyle = "#050b20"; g.fillRect(-r - 7, -r - 7, 2 * r + 14, 2 * r + 14); g.fillStyle = ring; g.fillRect(-r - 4, -r - 4, 2 * r + 8, 2 * r + 8); g.fillStyle = "#050b20"; g.fillRect(-r - 1.5, -r - 1.5, 2 * r + 3, 2 * r + 3); }
    g.fillStyle = fill; g.fillRect(-r, -r, 2 * r, 2 * r); g.restore();
  }
  function pill(g, x, y, w, h, fill, stroke) {
    g.beginPath(); g.roundRect(x, y, w, h, h / 2); g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); }
  }

  // data: { day, total, rounds: [{ depth, share, tier } | null], deepest: { depth, tierName } | null, streak, sample }
  // o.only: just the iceberg and its markers (the end screen shows that; the saved image is the full card).
  async function draw(canvas, data, o = {}) {
    try { await Promise.race([Promise.all([document.fonts.load(`800 100px ${UI}`), document.fonts.load(`600 60px ${UI}`), document.fonts.load(`600 80px ${PIXEL}`)]), new Promise(r => setTimeout(r, 1500))]); } catch { /* fall back to system fonts */ }
    const g = canvas.getContext("2d"), CW = canvas.width, CH = canvas.height;
    if (!art) { art = document.createElement("canvas"); art.width = WW; art.height = I.XH; I.paint(art); }
    // Left: the whole dive, from the iceberg's tip down to where the day ended. A long dive is drawn smaller to fit; a
    // short one at the game's own scale. The path you came down runs through it, with a mark where each question left
    // you, coloured by how rare that question's best answer was. Red only for an Unfathomable answer.
    const AW = 540, total = data.total || 0, yEnd = I.yX(total);
    const top = 28, bottom = Math.max(yEnd + 70, I.WORLD.BOTTOM + 40), S = Math.min(2, (CH - 40) / (bottom - top));
    const SX = CX - AW / S / 2, SY = top - (CH - (bottom - top) * S) / S / 2;
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#040917"; g.fillRect(0, 0, CW, CH);
    g.drawImage(art, SX, SY, AW / S, CH / S, 0, 0, AW, CH);
    const Y = wy => (wy - SY) * S, Xc = (CX - SX) * S;
    // The darkness of the deep, lifted a little so the picture reads: a soft pool of light along the path.
    const shade = g.createLinearGradient(0, Y(I.yX(300)), 0, CH); shade.addColorStop(0, "rgba(1,3,10,0)"); shade.addColorStop(1, "rgba(1,3,10,.35)");
    g.fillStyle = shade; g.fillRect(0, 0, AW, CH);
    const pool = g.createLinearGradient(Xc - 160, 0, Xc + 160, 0); pool.addColorStop(0, "rgba(120,170,230,0)"); pool.addColorStop(0.5, "rgba(120,170,230,.07)"); pool.addColorStop(1, "rgba(120,170,230,0)");
    g.fillStyle = pool; g.fillRect(Xc - 160, Y(I.WORLD.W), 320, Math.max(0, Y(yEnd) - Y(I.WORLD.W)));
    // Region names along the left edge, where each begins (only those the dive reached).
    g.textBaseline = "middle"; g.textAlign = "left";
    for (const r of I.REGIONS.slice(1)) {
      if (r.from > total) break;
      const y = Y(I.yX(r.from)); if (y < 30 || y > CH - 30) continue;
      g.fillStyle = "rgba(188,216,242,.35)"; g.fillRect(0, y, 18, 2);
      g.font = `700 17px ${UI}`; g.fillStyle = r.key === "unknown" ? "rgba(224,122,134,.8)" : "rgba(188,216,242,.6)"; g.letterSpacing = "2px"; g.fillText(r.name.toUpperCase(), 26, y + 1); g.letterSpacing = "0px";
      g.font = `600 16px ${UI}`; g.fillStyle = "rgba(188,216,242,.4)"; g.fillText(`${r.from.toLocaleString("en-US")} m`, 26, y + 22);
    }
    // The path: from the waterline down to the end of the dive.
    g.fillStyle = "rgba(200,230,250,.35)"; g.fillRect(Math.round(Xc) - 1, Y(I.WORLD.W), 2, Math.max(0, Y(yEnd) - Y(I.WORLD.W)));
    // Where each question left you.
    let run = 0, lastY = -99;
    data.rounds.forEach((r, i) => {
      if (!r || !r.depth) return;
      run += r.depth;
      const y = Y(I.yX(run)), red = r.tier === "beyond";
      if (red) { const glow = g.createRadialGradient(Xc, y, 0, Xc, y, 110); glow.addColorStop(0, "rgba(224,92,80,.3)"); glow.addColorStop(1, "rgba(224,92,80,0)"); g.fillStyle = glow; g.fillRect(Xc - 110, y - 110, 220, 220); }
      diamond(g, Xc, y, 8, ZONE[r.tier], red ? RED : "#eaf6ff");
      const ly = Math.max(y, lastY + 34); lastY = ly;
      g.font = `700 22px ${UI}`; g.fillStyle = red ? "#e8a39c" : "rgba(220,236,250,.8)"; g.textAlign = "left"; g.fillText(String(i + 1), Xc + 22, ly + 1);
    });
    // You: the end of the dive, with its depth.
    const ey = Y(yEnd), label = `${total.toLocaleString("en-US")} m`;
    g.font = `800 32px ${UI}`; const lw = g.measureText(label).width + 36;
    pill(g, Xc - lw / 2, Math.min(CH - 56, ey + 26), lw, 46, "rgba(5,11,27,.92)", "rgba(190,225,250,.55)");
    g.fillStyle = "#eaf6ff"; g.textAlign = "center"; g.fillText(label, Xc, Math.min(CH - 56, ey + 26) + 24); g.textAlign = "left";
    if (o.only) return;
    // Right: the numbers.
    const X = AW + 60, RW = CW - X - 60;
    const panel = g.createLinearGradient(0, 0, 0, CH); panel.addColorStop(0, "#0a1a3a"); panel.addColorStop(0.5, "#06102a"); panel.addColorStop(1, "#030713");
    g.fillStyle = panel; g.fillRect(AW, 0, CW - AW, CH);
    g.fillStyle = "rgba(143,208,245,.14)"; g.fillRect(AW, 0, 2, CH);
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    B.drawMark(g, X, 72, 40);
    g.font = `600 52px ${PIXEL}`; g.fillStyle = "#eaf3ff"; g.fillText(B.name, X + 54, 112);
    g.font = `600 30px ${UI}`; g.fillStyle = "#93a9cc"; g.textAlign = "right"; g.fillText(`#${data.day}`, X + RW, 110); g.textAlign = "left";
    g.font = `700 24px ${UI}`; g.fillStyle = "#93a9cc"; g.letterSpacing = "4px"; g.fillText("DIVE DEPTH", X, 250); g.letterSpacing = "0px";
    const totalText = total.toLocaleString("en-US");
    g.font = `800 ${totalText.length > 4 ? 160 : 190}px ${UI}`; g.fillStyle = "#eaf6ff"; g.fillText(totalText, X - 8, 420);
    const tw = g.measureText(totalText).width; g.font = `800 64px ${UI}`; g.fillText("m", X + tw + 2, 420);
    g.font = `700 30px ${UI}`; g.fillStyle = total >= 1500 ? "#e07a86" : "#8fd0f5"; g.fillText(I.regionOf(total).name, X, 476);
    // One row per question: number, how rare its best answer was, how far it took you. No answers, no questions.
    let y = 580;
    data.rounds.forEach((r, i) => {
      g.fillStyle = "rgba(143,208,245,.14)"; g.fillRect(X, y - 62, RW, 2);
      diamond(g, X + 18, y - 12, 15, r && !r.none ? ZONE[r.tier] : "rgba(98,121,158,.5)");
      g.font = `800 22px ${UI}`; g.fillStyle = "#06112a"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(i + 1), X + 18, y - 11);
      const named = r && !r.none, kn = kindName(r);
      g.textBaseline = "alphabetic"; g.textAlign = "left"; g.font = `600 34px ${UI}`; g.fillStyle = named ? (ZONE[r.tier] || "#eaf3ff") : "#62799e"; g.fillText(named ? (kn ? `${kn}${r.risk === "won" ? " ✓" : r.risk === "lost" ? " ✗" : ""}` : r.tierName) : (kn || "No depth"), X + 62, y);
      g.textAlign = "right"; g.font = `800 44px ${UI}`; g.fillStyle = r && !r.none ? "#eaf3ff" : "#62799e"; g.fillText(r && !r.none ? `+${r.depth} m` : "–", X + RW, y + 2);
      g.textAlign = "left"; y += 96;
    });
    g.fillStyle = "rgba(143,208,245,.14)"; g.fillRect(X, y - 62, RW, 2);
    y += 10;
    if (data.deepest) {
      const v = `+${data.deepest.depth} m · ${data.deepest.tierName}`;
      g.font = `600 30px ${UI}`; g.fillStyle = "#93a9cc"; g.fillText("Rarest answer", X, y); const lw = g.measureText("Rarest answer").width;
      g.font = `800 34px ${UI}`; const vw = g.measureText(v).width; if (lw + vw + 24 > RW) y += 44;   // no room on one line: the value goes beneath
      g.textAlign = "right"; g.fillStyle = I.isBeyond(data.deepest.depth) ? RED : "#7df0df"; g.fillText(v, X + RW, y); g.textAlign = "left"; y += 56;
    }
    if (data.streak > 1) { g.font = `600 30px ${UI}`; g.fillStyle = "#93a9cc"; g.fillText("Streak", X, y); g.textAlign = "right"; g.fillStyle = "#eaf3ff"; g.font = `800 34px ${UI}`; g.fillText(`${data.streak} days`, X + RW, y); g.textAlign = "left"; }
    g.font = `800 38px ${UI}`; g.fillStyle = "#eaf3ff"; g.fillText(B.tagline[0], X, CH - 124);
    g.fillStyle = "#8fd0f5"; g.fillText(B.tagline[1], X, CH - 74);
    if (data.sample) { g.font = `600 20px ${UI}`; g.fillStyle = "#62799e"; g.fillText("Depths from sample data (test version)", X, CH - 34); }
  }
  const blob = canvas => new Promise(resolve => canvas.toBlob(resolve, "image/png"));

  // Plain text for chats: one bar per question, drawn with block characters so it looks the same everywhere.
  // Round types (experimental days): a mark for each, and how a risk went. Rarity rounds keep the plain diamond.
  const KIND = { target: "◎", forbidden: "⊘", risk: "▲", wildcard: "✦", mines: "✺" };
  const riskWord = r => r && r.risk ? ({ won: " · risk paid off", lost: " · risk lost", secure: " · secured", continue: "" })[r.risk] || "" : "";
  const kindName = r => r && r.kind && r.kind !== "standard" ? ({ target: "Target", forbidden: "Forbidden", risk: "Risk", wildcard: "Wildcard" })[r.kind] : "";
  function text(data) {
    // Beneath the iceberg the bar runs off the end, past the ice: a full bar and a mark beyond it.
    const bar = d => { const n = Math.max(0, Math.min(10, Math.round(d / 30))); return "▓".repeat(n) + "░".repeat(10 - n) + (I.isBeyond(d) ? " ◆" : ""); };
    const lines = data.rounds.map((r, i) => `${i + 1}${r && KIND[r.kind] ? KIND[r.kind] : ""} ${bar(r ? r.depth : 0)} ${r && !r.none ? "+" + r.depth + " m" + (r.tier === "beyond" ? " · Unfathomable" : "") : "–"}${riskWord(r)}`);
    const last = [data.deepest ? `Rarest: +${data.deepest.depth} m (${data.deepest.tierName})` : "", data.streak > 1 ? `streak ${data.streak}` : ""].filter(Boolean).join(" · ");
    return [`${B.name} #${data.day} · ${data.total.toLocaleString("en-US")} m down · ${I.regionOf(data.total).name}`, ...lines, last, B.tagline.join(" "), data.link || ""].filter(Boolean).join("\n");
  }
  window.IcebergShare = { draw, blob, text };
})();
