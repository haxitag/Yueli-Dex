"use client";

import { useEffect, useState } from "react";
import type { ProviderKind } from "@/lib/types";

interface EnvKeyInfo {
  configured: boolean;
  count: number;
  masked: string[];
  source: string;
}

export function EnvKeyStatus({ kind }: { kind: ProviderKind }) {
  const [info, setInfo] = useState<EnvKeyInfo | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/env-config")
      .then((r) => r.json() as Promise<Record<string, EnvKeyInfo | null>>)
      .then((data) => {
        if (active) setInfo(data[kind] ?? null);
      })
      .catch(() => {
        if (active) setInfo(null);
      });
    return () => {
      active = false;
    };
  }, [kind]);

  if (!info) {
    return (
      <div className="text-xs text-dex-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-dex-muted inline-block mr-1.5" />
        env status unavailable
      </div>
    );
  }

  if (!info.configured) {
    return (
      <div className="text-xs text-dex-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-dex-muted inline-block mr-1.5" />
        no env key configured
      </div>
    );
  }

  return (
    <div className="text-xs">
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-dex-success inline-block" />
        <span className="text-dex-text">{info.count} key(s)</span>
        <span className="text-dex-muted">·</span>
        <span className="text-dex-accent">{info.source}</span>
      </div>
      <div className="mt-1 font-mono text-dex-muted space-y-0.5">
        {info.masked.map((m, i) => (
          <div key={i}>#{i}: {m}</div>
        ))}
      </div>
    </div>
  );
}
