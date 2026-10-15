// Small hand-written SVG icons. Decorative unless given a title; colour comes from currentColor.

type IconProps = { className?: string; title?: string };

function Svg({ className, title, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

/** Two rings, one gold: "linked or not". */
export function LogoMark({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="12" cy="16" r="7.5" fill="none" stroke="#f4b728" strokeWidth="2.6" />
      <circle cx="20" cy="16" r="7.5" fill="none" stroke="rgb(241 244 253 / 0.85)" strokeWidth="2.6" strokeDasharray="3.2 2.6" />
    </svg>
  );
}

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 19h14" />
  </Svg>
);

export const DeviceIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="3" width="12" height="18" rx="2.5" />
    <path d="M10 7.5h4" />
    <path d="m9.5 14 2 2 3.5-4" />
  </Svg>
);

export const CrowdIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="9" r="2.5" />
    <circle cx="16" cy="9" r="2.5" />
    <circle cx="12" cy="15" r="2.5" />
    <path d="M3.5 20c.8-2 2.5-3 4.5-3M20.5 20c-.8-2-2.5-3-4.5-3" />
  </Svg>
);

export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
);

export const CheckCircleIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.8 2.8L16 10" />
  </Svg>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const SplitIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21v-7" />
    <path d="M12 14 6 8M12 14l6-6" />
    <path d="M4 4h4v4M20 4h-4v4" />
  </Svg>
);

export const SparkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  </Svg>
);

/** Risk shapes differ as well as colours, so the level never relies on colour alone. */
export function RiskIcon({ level, className }: { level: "high" | "medium" | "low"; className?: string }) {
  if (level === "high")
    return (
      <Svg className={className}>
        <path d="M12 3.5 2.8 19.5h18.4L12 3.5Z" />
        <path d="M12 10v4.2M12 17.2v.1" />
      </Svg>
    );
  if (level === "medium")
    return (
      <Svg className={className}>
        <path d="M12 2.8 21.2 12 12 21.2 2.8 12 12 2.8Z" />
        <path d="M8.5 12h7" />
      </Svg>
    );
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.8 2.8L16 10" />
    </Svg>
  );
}
