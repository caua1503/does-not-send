import type { ReactNode } from "react";

interface LinkProps {
  to: string;
  className?: string;
  children: ReactNode;
}

/** Plain anchor; the router listens to `hashchange`, so no click interception. */
export function Link({ to, className = "", children }: LinkProps) {
  return (
    <a href={to} className={className}>
      {children}
    </a>
  );
}
