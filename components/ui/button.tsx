import type { ComponentProps } from "react";

const variants = {
  primary: "bg-button text-white hover:bg-button-hover",
  // The same geometry without the fill, for the lesser of two choices. An inset
  // ring rather than a border, so it matches the primary's height beside it.
  secondary:
    "bg-transparent text-ink ring-1 ring-edge ring-inset hover:bg-raised",
};

/**
 * Graphite, square, weight 600. The brand fills its buttons from the grey ramp
 * and keeps blue for links, so that the one blue thing on a screen is always
 * the thing you navigate to. There is deliberately no blue variant.
 */
export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof variants }) {
  return (
    <button
      className={`px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
