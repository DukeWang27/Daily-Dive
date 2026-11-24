// The shareable iceberg: one picture of how deep you went on each of today's five questions.
// Spoiler-free by design: it shows depths and zones, never the answers or the questions.
// Drawn on a canvas (1200 × 1500) from the same artwork as the game, so it can be saved as a PNG.
(function () {
  "use strict";
  const I = window.Iceberg, { WW, WH, W, CX } = I.WORLD;
  const ZONE = { tip: "#eaf6ff", shallows: "#8fd0f5", mid: "#57abe6", deep: "#9091f7", abyss: "#c9a6ff" };
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
  async function draw(canvas, data) {
    try { await Promise.race([Promise.all([document.fonts.load(`800 100px ${UI}`), document.fonts.load(`600 60px ${UI}`), document.fonts.load(`600 80px ${PIXEL}`)]), new Promise(r => setTimeout(r, 1500))]); } catch { /* fall back to system fonts */ }
    const g = canvas.getContext("2d"), CW = canvas.width, CH = canvas.height;
    if (!art) { art = document.createElement("canvas"); art.width = WW; art.height = WH; I.paint(art); }
    // Left: the iceberg, top to bottom, at exactly 2× so pixels stay square.
    const S = 2, SX = 65, SY = 15, AW = 540;
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#040917"; g.fillRect(0, 0, CW, CH);
    g.drawImage(art, SX, SY, AW / S, CH / S, 0, 0, AW, CH);
    // Deep water fades to black, as in the game.
    const shade = g.createLinearGradient(0, CH * 0.45, 0, CH); shade.addColorStop(0, "rgba(1,3,10,0)"); shade.addColorStop(1, "rgba(1,3,10,.55)");
    g.fillStyle = shade; g.fillRect(0, 0, AW, CH);
    // Depth marks every 100 m along the left edge.
    g.font = `600 20px ${UI}`; g.textBaseline = "middle"; g.textAlign = "left";
    for (const m of [0, 100, 200, 300]) { const y = (I.yOfDepth(m) - SY) * S; g.fillStyle = "rgba(188,216,242,.5)"; g.fillRect(0, y, 14, 2); g.fillText(m + " m", 22, y + 1); }
    // Your five markers. Labels alternate sides and never overlap.
    const marks = data.rounds.map((r, i) => r ? { i, r, y: (I.depthY(r.share) - SY) * S, x: (CX - SX + [16, -16, 0, 22, -22][i]) * S } : null).filter(Boolean).sort((a, b) => a.y - b.y);
    // Each label goes beside its marker: sides alternate, switch if there's no room, and stack rather than overlap.
    let lastRight = -99, lastLeft = -99;
    g.font = `800 30px ${UI}`;
    marks.forEach((m, k) => {
      m.label = `${m.r.depth} m`; m.w = g.measureText(m.label).width + 64;
      m.side = k % 2 === 0 ? 1 : -1;
      if (m.side < 0 && m.x - 40 - m.w < 74) m.side = 1;            // would run into the depth scale on the left
      if (m.side > 0 && m.x + 40 + m.w > AW - 10) m.side = -1;      // would run off the picture on the right
      const prev = m.side > 0 ? lastRight : lastLeft; m.ly = Math.max(m.y, prev + 56);
      if (m.side > 0) lastRight = m.ly; else lastLeft = m.ly;
    });
    for (const m of marks) {
      const w = m.w, h = 46, lx = m.side > 0 ? m.x + 40 : m.x - 40 - w, ly = m.ly - h / 2;
      g.strokeStyle = "rgba(255,207,90,.55)"; g.lineWidth = 2; g.beginPath(); g.moveTo(m.x, m.y); g.lineTo(m.side > 0 ? lx : lx + w, m.ly); g.stroke();
      diamond(g, m.x, m.y, 9, ZONE[m.r.tier], "#ffcf5a");
      pill(g, lx, ly, w, h, "rgba(5,11,27,.9)", "rgba(255,207,90,.55)");
      g.fillStyle = "#93a9cc"; g.font = `700 22px ${UI}`; g.textAlign = "left"; g.fillText(String(m.i + 1), lx + 18, m.ly + 1);
      g.fillStyle = "#eaf3ff"; g.font = `800 30px ${UI}`; g.fillText(m.label, lx + 44, m.ly + 1);
    }
    // Right: the numbers.
    const X = AW + 60, RW = CW - X - 60;
    const panel = g.createLinearGradient(0, 0, 0, CH); panel.addColorStop(0, "#0a1a3a"); panel.addColorStop(0.5, "#06102a"); panel.addColorStop(1, "#030713");
    g.fillStyle = panel; g.fillRect(AW, 0, CW - AW, CH);
    g.fillStyle = "rgba(143,208,245,.14)"; g.fillRect(AW, 0, 2, CH);
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.fillStyle = "#eaf6ff"; g.fillRect(X, 96, 0, 0);
    g.beginPath(); g.moveTo(X + 18, 78); g.lineTo(X + 36, 110); g.lineTo(X, 110); g.closePath(); g.fillStyle = "#eaf6ff"; g.fill();
    g.fillStyle = "#8fd0f5"; g.fillRect(X + 5, 102, 26, 8);
    g.font = `600 52px ${PIXEL}`; g.fillStyle = "#eaf3ff"; g.fillText("Iceberg", X + 52, 112);
    g.font = `600 30px ${UI}`; g.fillStyle = "#93a9cc"; g.textAlign = "right"; g.fillText(`#${data.day}`, X + RW, 110); g.textAlign = "left";
    g.font = `700 24px ${UI}`; g.fillStyle = "#93a9cc"; g.letterSpacing = "4px"; g.fillText("TOTAL DEPTH", X, 250); g.letterSpacing = "0px";
    const total = data.total.toLocaleString("en-US");
    g.font = `800 ${total.length > 4 ? 160 : 190}px ${UI}`; g.fillStyle = "#ffcf5a"; g.fillText(total, X - 8, 420);
    const tw = g.measureText(total).width; g.font = `800 64px ${UI}`; g.fillText("m", X + tw + 2, 420);
    // One row per question: number, zone, depth. No answers, no questions.
    let y = 540;
    data.rounds.forEach((r, i) => {
      g.fillStyle = "rgba(143,208,245,.14)"; g.fillRect(X, y - 62, RW, 2);
      diamond(g, X + 18, y - 12, 15, r ? ZONE[r.tier] : "rgba(98,121,158,.5)");
      g.font = `800 22px ${UI}`; g.fillStyle = "#06112a"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(i + 1), X + 18, y - 11);
      g.textBaseline = "alphabetic"; g.textAlign = "left"; g.font = `600 34px ${UI}`; g.fillStyle = r ? "#eaf3ff" : "#62799e"; g.fillText(r ? r.tierName : "No depth", X + 62, y);
      g.textAlign = "right"; g.font = `800 44px ${UI}`; g.fillStyle = r ? "#eaf3ff" : "#62799e"; g.fillText(r ? `${r.depth} m` : "–", X + RW, y + 2);
      g.textAlign = "left"; y += 96;
    });
    g.fillStyle = "rgba(143,208,245,.14)"; g.fillRect(X, y - 62, RW, 2);
    y += 10;
    if (data.deepest) { g.font = `600 30px ${UI}`; g.fillStyle = "#93a9cc"; g.fillText("Deepest find", X, y); g.textAlign = "right"; g.fillStyle = "#ffcf5a"; g.font = `800 34px ${UI}`; g.fillText(`${data.deepest.depth} m · ${data.deepest.tierName}`, X + RW, y); g.textAlign = "left"; y += 56; }
    if (data.streak > 1) { g.font = `600 30px ${UI}`; g.fillStyle = "#93a9cc"; g.fillText("Streak", X, y); g.textAlign = "right"; g.fillStyle = "#eaf3ff"; g.font = `800 34px ${UI}`; g.fillText(`${data.streak} days`, X + RW, y); g.textAlign = "left"; }
    g.font = `800 38px ${UI}`; g.fillStyle = "#eaf3ff"; g.fillText("Three guesses.", X, CH - 124);
    g.fillStyle = "#8fd0f5"; g.fillText("How deep can you go?", X, CH - 74);
    if (data.sample) { g.font = `600 20px ${UI}`; g.fillStyle = "#62799e"; g.fillText("Depths from sample data (test version)", X, CH - 34); }
  }
  const blob = canvas => new Promise(resolve => canvas.toBlob(resolve, "image/png"));

  // Plain text for chats: one bar per question, drawn with block characters so it looks the same everywhere.
  function text(data) {
    const bar = d => { const n = Math.max(0, Math.min(10, Math.round(d / 30))); return "▓".repeat(n) + "░".repeat(10 - n); };
    const lines = data.rounds.map((r, i) => `${i + 1} ${bar(r ? r.depth : 0)} ${r ? r.depth + " m" : "–"}`);
    const last = [data.deepest ? `Deepest: ${data.deepest.depth} m (${data.deepest.tierName})` : "", data.streak > 1 ? `streak ${data.streak}` : ""].filter(Boolean).join(" · ");
    return [`Iceberg #${data.day} · ${data.total.toLocaleString("en-US")} m`, ...lines, last, "Three guesses. How deep can you go?", data.link || ""].filter(Boolean).join("\n");
  }
  window.IcebergShare = { draw, blob, text };
})();
