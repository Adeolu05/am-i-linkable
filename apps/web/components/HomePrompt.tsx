"use client";

// The home page prompt. A valid amount is handed to /check in memory (never in
// a URL, so not in the browser history either); the examples are picked on
// /check, which has the data.

import { parseZecToZat } from "@ail/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Prompt } from "@/components/Prompt";
import { exampleHref, handOverAmount } from "@/lib/amountHash";

export function HomePrompt() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Prompt
        label="Amount you plan to withdraw"
        placeholder="2.5"
        unit="ZEC"
        value={value}
        onChange={setValue}
        error={error}
        onSubmit={() => {
          const parsed = parseZecToZat(value);
          if (!parsed.ok) return setError(parsed.error);
          setError(null);
          handOverAmount(value);
          router.push("/check");
        }}
      />
      <div className="mt-3.5 flex flex-wrap gap-2 text-xs">
        <Link href={exampleHref("risky")} prefetch={false} className="rounded border border-line px-2.5 py-1.5 text-ink-muted hover:border-line-strong hover:text-ink">
          try: <b className="font-medium text-ink">risky example</b>
        </Link>
        <Link href={exampleHref("common")} prefetch={false} className="rounded border border-line px-2.5 py-1.5 text-ink-muted hover:border-line-strong hover:text-ink">
          try: <b className="font-medium text-ink">common amount</b>
        </Link>
      </div>
    </div>
  );
}
