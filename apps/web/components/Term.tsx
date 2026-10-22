// Terminal pieces: a window with a title bar, lines that type in once, and the
// prompt cursor. Purely presentational; every line's text comes from real data.

import type { CSSProperties, ReactNode } from "react";

export function Win({
  title,
  status,
  statusClassName = "text-accent",
  className = "",
  children,
  ...rest
}: {
  title: string;
  status?: ReactNode;
  statusClassName?: string;
  className?: string;
  children: ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={`win ${className}`} {...rest}>
      <div className="tbar">
        <span className="flex gap-1.5" aria-hidden="true">
          <i className="h-[9px] w-[9px] rounded-full border border-line-strong" />
          <i className="h-[9px] w-[9px] rounded-full border border-line-strong" />
          <i className="h-[9px] w-[9px] rounded-full border border-line-strong" />
        </span>
        <span className="ml-1.5 truncate">{title}</span>
        {status !== undefined && <span className={`ml-auto shrink-0 ${statusClassName}`}>{status}</span>}
      </div>
      {children}
    </section>
  );
}

/** One output line; `i` staggers its typing (160 ms apart). */
export function Ln({ i = 0, className = "", children }: { i?: number; className?: string; children?: ReactNode }) {
  return (
    <div className={`ln ${className}`} style={{ "--i": i } as CSSProperties}>
      {children}
    </div>
  );
}

/** A prompt line: "$ " in the accent, then the command. */
export function Cmd({ i, children }: { i?: number; children?: ReactNode }) {
  return (
    <Ln i={i}>
      <span className="text-accent">$</span> {children}
    </Ln>
  );
}

export function Cursor() {
  return <span className="cursor" aria-hidden="true" />;
}
