"use client";

// The crowd plot as text, sized to its window: the column count comes from the
// real character width, so the newest match is never scrolled out of view.

import type { Crowd, Risk } from "@ail/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { asciiCrowd, fitCols, type CellKind } from "./asciiCrowd";

const RISK_TEXT: Record<Risk, string> = { high: "text-risk-high", medium: "text-risk-medium", low: "text-risk-low" };
const BOXED = new Set<CellKind>(["match", "you", "edge", "near"]);

export function AsciiCrowdView({ crowd, amountZat, risk }: { crowd: Crowd; amountZat: number; risk: Risk }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const [cols, setCols] = useState(40);

  useEffect(() => {
    const box = boxRef.current;
    const probe = probeRef.current;
    if (!box || !probe) return;
    let live = true;
    const update = () => {
      if (!live) return;
      const cw = probe.getBoundingClientRect().width / 10 || 7.2;
      setCols(fitCols(box.getBoundingClientRect().width / cw));
    };
    update();
    // The web font can arrive after the first measure, with a different character width.
    void document.fonts?.ready.then(update);
    const ro = new ResizeObserver(update);
    ro.observe(box);
    return () => {
      live = false;
      ro.disconnect();
    };
  }, []);

  // Safety net: if the plot still overflows its box, drop columns until it fits,
  // so the right edge, where the newest matches are, is never cut off.
  useLayoutEffect(() => {
    const pre = preRef.current;
    if (!pre || pre.scrollWidth <= pre.clientWidth + 1) return;
    const cw = (probeRef.current?.getBoundingClientRect().width ?? 72) / 10 || 7.2;
    const over = Math.ceil((pre.scrollWidth - pre.clientWidth) / cw);
    setCols((c) => (c > 18 ? Math.max(18, c - over) : c));
  }, [cols]);

  const plot = asciiCrowd(crowd, amountZat, cols);
  const tone: Record<CellKind, string> = {
    blank: "",
    near: "text-dim",
    match: RISK_TEXT[risk],
    you: "text-accent",
    edge: RISK_TEXT[risk],
    label: "text-ink-muted",
    tag: RISK_TEXT[risk],
    axis: "text-ink-muted",
  };

  return (
    <div ref={boxRef} className="relative">
      {/* measures one character of this font at this size */}
      <span ref={probeRef} className="pointer-events-none invisible absolute whitespace-pre text-[12px]" aria-hidden="true">
        0000000000
      </span>
      <pre ref={preRef} className="ascii" aria-hidden="true">
        {plot.rows.map((row, r) => (
          <span key={r} className="block">
            {row.map((seg, i) =>
              BOXED.has(seg.kind) ? (
                // Box-drawing and shape glyphs are not in the self-hosted Latin subset; the
                // fallback font draws them wider. A 1ch cell per glyph keeps the grid exact.
                <span key={i} className={tone[seg.kind]}>
                  {[...seg.text].map((ch, j) => (
                    <span key={j} className="inline-block w-[1ch] text-center">
                      {ch}
                    </span>
                  ))}
                </span>
              ) : (
                <span key={i} className={tone[seg.kind]}>
                  {seg.text}
                </span>
              ),
            )}
          </span>
        ))}
      </pre>
    </div>
  );
}
