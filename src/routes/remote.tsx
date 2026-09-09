import type { RealtimeChannel } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import type { Surface } from "@/lib/types";
import type { Pt } from "@/lib/warp";

export const Route = createFileRoute("/remote")({
  component: Remote,
  head: () => ({
    meta: [
      { title: "Prism remote mapping — map surfaces from a tablet" },
      {
        name: "description",
        content:
          "Pair a tablet or phone with the Prism studio and shape your projection surfaces by touch.",
      },
      { property: "og:title", content: "Prism remote mapping" },
      {
        property: "og:description",
        content: "Shape projection surfaces by touch from a tablet or phone.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function Remote() {
  const [code, setCode] = useState("");
  const [joined, setJoined] = useState(false);
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const chRef = useRef<RealtimeChannel | null>(null);
  const padRef = useRef<HTMLDivElement | null>(null);

  useEffect(
    () => () => {
      void chRef.current?.unsubscribe();
    },
    [],
  );

  const join = () => {
    const key = code.trim().toUpperCase();
    if (key.length < 4) return;
    const ch = supabase.channel(`prism-${key}`, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "state" }, ({ payload }) => {
      const next = (payload as { surfaces: Surface[] }).surfaces ?? [];
      setSurfaces(next);
      setSelectedId((cur) => cur ?? next[0]?.id ?? null);
    }).subscribe((status) => {
      if (status === "SUBSCRIBED") {
        ch.send({ type: "broadcast", event: "join", payload: {} });
        setJoined(true);
      }
    });
    chRef.current = ch;
  };

  const selected = surfaces.find((s) => s.id === selectedId) ?? surfaces[0] ?? null;

  const drag = (index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selected) return;
    e.preventDefault();
    const rect = padRef.current?.getBoundingClientRect();
    const target = e.currentTarget;
    if (!rect) return;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const p: Pt = {
        x: Math.min(1.4, Math.max(-0.4, (ev.clientX - rect.left) / rect.width)),
        y: Math.min(1.4, Math.max(-0.4, (ev.clientY - rect.top) / rect.height)),
      };
      setSurfaces((prev) =>
        prev.map((s) => {
          if (s.id !== selected.id) return s;
          const corners = s.corners.map((c, i) => (i === index ? p : c));
          chRef.current?.send({
            type: "broadcast",
            event: "corners",
            payload: { id: s.id, corners },
          });
          return { ...s, corners };
        }),
      );
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  if (!joined) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-xl font-semibold">Prism remote mapping</h1>
          <p className="text-sm text-muted-foreground">
            Type the code shown in the studio to shape your surfaces by touch.
          </p>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Pairing code"
            className="text-center font-mono text-lg tracking-[0.3em]"
            aria-label="Pairing code"
          />
          <Button className="w-full" onClick={join}>
            Connect
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
        {surfaces.map((s, i) => (
          <Button
            key={s.id}
            size="sm"
            variant={selected?.id === s.id ? "default" : "secondary"}
            onClick={() => {
              setSelectedId(s.id);
              chRef.current?.send({ type: "broadcast", event: "select", payload: { id: s.id } });
            }}
          >
            {i + 1}. {s.name}
          </Button>
        ))}
        {surfaces.length === 0 && (
          <p className="text-xs text-muted-foreground">Waiting for the studio…</p>
        )}
      </div>
      <div
        ref={padRef}
        className="relative m-2 flex-1 touch-none rounded-lg border border-border bg-black"
      >
        <svg className="pointer-events-none absolute inset-0 size-full">
          {surfaces.map((s) => (
            <polygon
              key={s.id}
              points={s.corners.map((c) => `${c.x * 100}%,${c.y * 100}%`).join(" ")}
              className={
                s.id === selected?.id
                  ? "fill-primary/15 stroke-primary"
                  : "fill-none stroke-muted-foreground/40"
              }
              strokeDasharray={s.id === selected?.id ? undefined : "4 4"}
            />
          ))}
        </svg>
        {selected?.corners.map((c, i) => (
          <div
            key={i}
            onPointerDown={drag(i)}
            className="absolute grid size-10 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center rounded-full border-2 border-primary bg-primary/30 text-xs font-bold"
            style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
          >
            {i + 1}
          </div>
        ))}
      </div>
    </main>
  );
}
