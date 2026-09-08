import type { TestPattern } from "./types";

export function drawPattern(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pattern: TestPattern,
  label: string,
) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 2;
  switch (pattern) {
    case "grid": {
      ctx.strokeStyle = "#ffffff";
      const cols = 8;
      const rows = 6;
      for (let i = 0; i <= cols; i++) {
        const x = Math.round((w / cols) * i) + (i === cols ? -1 : 0);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let j = 0; j <= rows; j++) {
        const y = Math.round((h / rows) * j) + (j === rows ? -1 : 0);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.strokeStyle = "#ff3355";
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "crosshair": {
      ctx.strokeStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.moveTo(0, 0);
      ctx.lineTo(w, h);
      ctx.moveTo(w, 0);
      ctx.lineTo(0, h);
      ctx.stroke();
      ctx.strokeStyle = "#4dd8ff";
      for (const r of [0.15, 0.3, 0.45]) {
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, Math.min(w, h) * r, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case "bars": {
      const colors = ["#ffffff", "#ffff00", "#00ffff", "#00ff00", "#ff00ff", "#ff0000", "#0000ff", "#000000"];
      const bw = w / colors.length;
      colors.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(Math.floor(i * bw), 0, Math.ceil(bw) + 1, h * 0.75);
      });
      for (let i = 0; i < 16; i++) {
        const v = Math.round((i / 15) * 255);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(Math.floor((w / 16) * i), h * 0.75, Math.ceil(w / 16) + 1, h * 0.25);
      }
      break;
    }
    case "frame": {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, w - 6, h - 6);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffb347";
      ctx.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
      ctx.fillStyle = "#ffffff";
      const s = Math.min(w, h) * 0.12;
      for (const [x, y] of [
        [0, 0],
        [w - s, 0],
        [0, h - s],
        [w - s, h - s],
      ] as const) {
        ctx.fillRect(x, y, s, s);
      }
      break;
    }
    case "numbered": {
      ctx.strokeStyle = "#ffffff";
      ctx.strokeRect(1, 1, w - 2, h - 2);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, h);
      ctx.moveTo(w, 0);
      ctx.lineTo(0, h);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.round(h * 0.28)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, w / 2, h / 2);
      ctx.font = `${Math.round(h * 0.09)}px system-ui, sans-serif`;
      ctx.fillStyle = "#4dd8ff";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText("1", 12, 8);
      ctx.textAlign = "right";
      ctx.fillText("2", w - 12, 8);
      ctx.textBaseline = "bottom";
      ctx.fillText("3", w - 12, h - 8);
      ctx.textAlign = "left";
      ctx.fillText("4", 12, h - 8);
      break;
    }
    default:
      break;
  }
}
