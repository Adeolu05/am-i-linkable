"use client";

// "> [ input ] UNIT [run →]". Typing is local; the parent decides what "run" does
// (home hands an amount to /check in the URL fragment, /check and /linked run in
// place). Anything passed as children sits inside the form, under the prompt.

import { useId, type ReactNode } from "react";

export function Prompt({
  label,
  value,
  onChange,
  onSubmit,
  error,
  placeholder,
  unit,
  mode = "amount",
  disabled = false,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  error: string | null;
  placeholder: string;
  /** Shown after the input, e.g. "ZEC". */
  unit?: string;
  /** "amount" opens a decimal keyboard; "address" a plain one, no autocapitalisation. */
  mode?: "amount" | "address";
  disabled?: boolean;
  children?: ReactNode;
}) {
  const inputId = useId();
  const errorId = useId();
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor={inputId} className="up mb-2.5 block">
        {label}
      </label>
      <div className="flex max-w-[600px] flex-wrap items-center gap-x-2.5 gap-y-3 rounded-md border border-line-strong bg-panel px-4 py-3 focus-within:border-accent">
        <span className="text-accent" aria-hidden="true">
          &gt;
        </span>
        <input
          id={inputId}
          inputMode={mode === "amount" ? "decimal" : "text"}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`min-w-0 flex-1 bg-transparent font-medium text-ink outline-none placeholder:text-ink-muted ${mode === "amount" ? "basis-40 text-lg" : "basis-56 text-[15px]"}`}
        />
        {unit && <span className="text-xs tracking-[0.12em] text-ink-muted">{unit}</span>}
        <button type="submit" disabled={disabled} className="btn btn-fill btn-sm max-[480px]:w-full">
          run <span className="ar">→</span>
        </button>
      </div>
      {error && (
        <p id={errorId} className="mt-2 text-sm text-risk-high">
          {error}
        </p>
      )}
      {children}
    </form>
  );
}
