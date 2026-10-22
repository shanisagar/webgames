import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const PlayIcon = (p: P) => <svg {...base} {...p}><path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" /></svg>;
export const MenuIcon = (p: P) => <svg {...base} {...p}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
export const GearIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5" />
  </svg>
);
export const BulbIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" />
  </svg>
);
export const RestartIcon = (p: P) => <svg {...base} {...p}><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" /></svg>;
export const FitIcon = (p: P) => <svg {...base} {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>;
export const BackIcon = (p: P) => <svg {...base} {...p}><path d="M15 5l-7 7 7 7" /></svg>;
export const ForwardIcon = (p: P) => <svg {...base} {...p}><path d="M9 5l7 7-7 7" /></svg>;
export const HeartIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...p}><path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C1 8.6 3 5 6.6 5c2.1 0 3.6 1.2 4.4 2.6h2C13.8 6.2 15.3 5 17.4 5 21 5 23 8.6 21.6 11.8 19.5 16.4 12 21 12 21z" /></svg>
);
export const StarIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...p}><path fill="currentColor" d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" /></svg>
);
export const LockIcon = (p: P) => <svg {...base} {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
export const ArrowIcon = (p: P) => <svg {...base} {...p}><path d="M4 12h13M12 6l6 6-6 6" /></svg>;
