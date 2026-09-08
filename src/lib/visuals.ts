import type { AudioLevels } from "./audio";

export type DrawArgs = {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** Seconds, already scaled by speed. */
  t: number;
  /** 0..1 */
  intensity: number;
  /** 0..360 */
  hue: number;
  audio: AudioLevels;
};

export type Visual = {
  id: string;
  name: string;
  group: "Beams" | "Geometry" | "Organic" | "Pulse";
  draw: (a: DrawArgs) => void;
};

const clear = (ctx: CanvasRenderingContext2D, w: number, h: number, alpha = 1) => {
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fillRect(0, 0, w, h);
};

const col = (hue: number, l = 55, a = 1) => `hsla(${((hue % 360) + 360) % 360},95%,${l}%,${a})`;

export const visuals: Visual[] = [
  {
    id: "plasma",
    name: "Plasma",
    group: "Organic",
    draw: ({ ctx, w, h, t, hue, intensity, audio }) => {
      clear(ctx, w, h);
      const step = 14;
      const amp = 1 + audio.level * 2;
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const v =
            Math.sin(x * 0.02 + t) +
            Math.sin(y * 0.025 - t * 1.3) +
            Math.sin((x + y) * 0.015 + t * 0.7);
          const l = 20 + ((v + 3) / 6) * 60 * (0.4 + intensity * 0.6) * amp;
          ctx.fillStyle = col(hue + v * 40, Math.min(85, l));
          ctx.fillRect(x, y, step + 1, step + 1);
        }
      }
    },
  },
  {
    id: "tunnel",
    name: "Tunnel",
    group: "Geometry",
    draw: ({ ctx, w, h, t, hue, intensity, audio }) => {
      clear(ctx, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const max = Math.hypot(w, h) / 2;
      const rings = 18;
      ctx.lineWidth = 2 + intensity * 10 + audio.bass * 14;
      for (let i = rings; i > 0; i--) {
        const p = ((i / rings + t * 0.25) % 1) * (1 + audio.level * 0.4);
        ctx.strokeStyle = col(hue + i * 12, 40 + p * 40, 0.9);
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0.5, p * max), 0, Math.PI * 2);
        ctx.stroke();
      }
    },
  },
  {
    id: "beams",
    name: "Sweep beams",
    group: "Beams",
    draw: ({ ctx, w, h, t, hue, intensity, audio }) => {
      clear(ctx, w, h);
      ctx.globalCompositeOperation = "lighter";
      const n = 6;
      for (let i = 0; i < n; i++) {
        const a = t * 0.6 + (i / n) * Math.PI * 2;
        const x = w / 2 + Math.cos(a) * w * 0.6;
        const spread = w * (0.03 + intensity * 0.08 + audio.bass * 0.09);
        const g = ctx.createLinearGradient(x - spread, 0, x + spread, 0);
        g.addColorStop(0, col(hue + i * 30, 50, 0));
        g.addColorStop(0.5, col(hue + i * 30, 60, 0.9));
        g.addColorStop(1, col(hue + i * 30, 50, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - spread, 0, spread * 2, h);
      }
      ctx.globalCompositeOperation = "source-over";
    },
  },
  {
    id: "bars",
    name: "Spectrum bars",
    group: "Pulse",
    draw: ({ ctx, w, h, t, hue, intensity, audio }) => {
      clear(ctx, w, h);
      const n = 24;
      const bw = w / n;
      for (let i = 0; i < n; i++) {
        const band = i / n;
        const src = band < 0.33 ? audio.bass : band < 0.66 ? audio.mid : audio.high;
        const wob = (Math.sin(t * 2 + i * 0.6) + 1) / 2;
        const v = Math.min(1, src * 1.4 + wob * (0.15 + intensity * 0.5));
        const bh = v * h;
        ctx.fillStyle = col(hue + i * 8, 45 + v * 30);
        ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
      }
    },
  },
  {
    id: "strobe",
    name: "Strobe",
    group: "Pulse",
    draw: ({ ctx, w, h, t, hue, intensity, audio }) => {
      const rate = 2 + intensity * 10;
      const on = Math.floor(t * rate) % 2 === 0 || audio.bass > 0.6;
      ctx.fillStyle = on ? col(hue, 70 + audio.level * 25) : "#000";
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: "grid",
    name: "Neon grid",
    group: "Geometry",
    draw: ({ ctx, w, h, t, hue, intensity, audio }) => {
      clear(ctx, w, h);
      const cells = 10;
      const off = (t * 40) % (h / cells);
      ctx.lineWidth = 1 + intensity * 4 + audio.bass * 6;
      ctx.strokeStyle = col(hue, 55, 0.9);
      ctx.beginPath();
      for (let i = -1; i <= cells; i++) {
        const y = i * (h / cells) + off;
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      for (let i = 0; i <= cells; i++) {
        const x = i * (w / cells);
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      ctx.stroke();
    },
  },
  {
    id: "waves",
    name: "Waves",
    group: "Organic",
    draw: ({ ctx, w, h, t, hue, intensity, audio }) => {
      clear(ctx, w, h, 0.25);
      const lines = 7;
      ctx.lineWidth = 2 + intensity * 5;
      for (let l = 0; l < lines; l++) {
        ctx.strokeStyle = col(hue + l * 24, 60, 0.85);
        ctx.beginPath();
        for (let x = 0; x <= w; x += 6) {
          const y =
            h / 2 +
            Math.sin(x * 0.012 + t * 1.4 + l * 0.5) *
              h *
              (0.06 + intensity * 0.12 + audio.mid * 0.2) +
            (l - lines / 2) * (h / (lines * 2));
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    },
  },
  {
    id: "kaleido",
    name: "Kaleidoscope",
    group: "Geometry",
    draw: ({ ctx, w, h, t, hue, intensity, audio }) => {
      clear(ctx, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const slices = 10;
      const r = Math.min(w, h) * (0.5 + audio.level * 0.25);
      for (let i = 0; i < slices; i++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((i / slices) * Math.PI * 2 + t * 0.4);
        ctx.fillStyle = col(hue + i * 30, 40 + intensity * 35, 0.85);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(r, -r * 0.22);
        ctx.lineTo(r * (0.6 + Math.sin(t + i) * 0.3), r * 0.22);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    },
  },
  {
    id: "blobs",
    name: "Lava blobs",
    group: "Organic",
    draw: ({ ctx, w, h, t, hue, intensity, audio }) => {
      clear(ctx, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 7; i++) {
        const x = w / 2 + Math.sin(t * 0.5 + i * 1.7) * w * 0.35;
        const y = h / 2 + Math.cos(t * 0.42 + i * 2.1) * h * 0.35;
        const r = Math.min(w, h) * (0.1 + intensity * 0.18 + audio.bass * 0.15);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, col(hue + i * 25, 60, 0.95));
        g.addColorStop(1, col(hue + i * 25, 40, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    },
  },
  {
    id: "rain",
    name: "Light rain",
    group: "Beams",
    draw: ({ ctx, w, h, t, hue, intensity, audio }) => {
      clear(ctx, w, h, 0.3);
      const n = 40;
      for (let i = 0; i < n; i++) {
        const seed = (i * 9301 + 49297) % 233280;
        const x = (seed / 233280) * w;
        const speed = 0.4 + ((seed % 100) / 100) * 1.2;
        const len = h * (0.08 + intensity * 0.2);
        const y = ((t * speed * 300 + i * 90) % (h + len)) - len;
        ctx.strokeStyle = col(hue + i * 4, 55 + audio.high * 30, 0.9);
        ctx.lineWidth = 1 + intensity * 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + len);
        ctx.stroke();
      }
    },
  },
  {
    id: "static",
    name: "Static",
    group: "Pulse",
    draw: ({ ctx, w, h, hue, intensity, audio }) => {
      clear(ctx, w, h);
      const step = 8;
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          if (Math.random() > 0.35 + intensity * 0.4 + audio.level * 0.2) continue;
          ctx.fillStyle = col(hue + Math.random() * 40, 30 + Math.random() * 60);
          ctx.fillRect(x, y, step, step);
        }
      }
    },
  },
  {
    id: "pulse",
    name: "Pulse dots",
    group: "Pulse",
    draw: ({ ctx, w, h, t, hue, intensity, audio }) => {
      clear(ctx, w, h);
      const cols = 8;
      const rows = 5;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const phase = Math.sin(t * 2.5 - (c + r) * 0.5);
          const v = Math.max(0, phase) * (0.4 + intensity * 0.6) + audio.bass * 0.6;
          const rad = (Math.min(w / cols, h / rows) / 2) * Math.min(1, v);
          ctx.fillStyle = col(hue + (c + r) * 12, 60);
          ctx.beginPath();
          ctx.arc((c + 0.5) * (w / cols), (r + 0.5) * (h / rows), Math.max(0, rad), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  },
];

export const visualById = (id: string) => visuals.find((v) => v.id === id) ?? visuals[0];
