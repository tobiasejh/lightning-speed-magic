import QRCode from "qrcode";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type Props = {
  code: string;
  connected: boolean;
  error?: string | null;
  onStop: () => void;
};

export function PairBanner({ code, connected, error, onStop }: Props) {
  const [qr, setQr] = useState<string | null>(null);
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/remote?code=${code}`;

  useEffect(() => {
    if (!url) return;
    let alive = true;
    QRCode.toDataURL(url, { margin: 1, width: 220 })
      .then((d) => {
        if (alive) setQr(d);
      })
      .catch(() => setQr(null));
    return () => {
      alive = false;
    };
  }, [url]);

  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-border bg-primary/10 px-3 py-3">
      {qr && (
        <img
          src={qr}
          alt={`QR code linking to the Prism remote mapping page with code ${code}`}
          className="size-24 rounded bg-black/40 p-1"
        />
      )}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          Scan the code with your iPad or phone camera, or open{" "}
          <span className="font-mono text-foreground">{url.replace(/\?.*/, "")}</span> and type:
        </p>
        <p className="font-mono text-4xl font-bold leading-none tracking-[0.35em] text-primary sm:text-5xl">
          {code}
        </p>
        <p className="text-xs text-muted-foreground">
          {connected ? "Device connected — drag corners there." : "Waiting for device…"}
        </p>
      </div>
      <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={onStop}>
        Stop pairing
      </Button>
    </div>
  );
}
