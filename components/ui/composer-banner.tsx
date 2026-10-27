"use client"

import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.

/* -------------------------------------------------------------------------------------------------
 * Dock
 * -----------------------------------------------------------------------------------------------*/

/**
 * The column banners stack in, directly above a composer. Each one is a little
 * narrower than the composer and tucks its bottom edge a rem *under* it — so a
 * permission request, a question or a notice reads as a drawer pulled out of
 * the composer rather than a card floating above it, and a stack of them reads
 * as one drawer with sections.
 *
 * The tuck needs the composer to paint over it: give the surface below
 * `relative z-10` and an opaque background (`ChatInput`'s `banners` slot does
 * all of this for you). Renders nothing while it holds nothing.
 */
export function ComposerDock({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-dock"
      className={cn(
        "mx-auto flex w-[calc(100%-2.5rem)] flex-col empty:hidden [&>*]:-mb-4",
        className
      )}
      {...props}
    />
  )
}

/* -------------------------------------------------------------------------------------------------
 * Banner
 * -----------------------------------------------------------------------------------------------*/

/**
 * A variant moves two variables and nothing else: the outline, and a tint laid
 * over the opaque surface. Amber is the one raw hue, for the same reason the
 * sidebar's pending dot uses it — no theme token says "needs you".
 */
const composerBannerVariants = cva(
  [
    "group/banner relative flex flex-col rounded-t-xl border border-(--banner-outline) bg-background",
    "bg-linear-to-b from-(--banner-tint) to-(--banner-tint)",
    // The bottom rem is the part the composer covers.
    "px-1 pt-1 pb-5 text-[12px] leading-4 text-foreground",
    "animate-in fade-in slide-in-from-bottom-1 duration-150",
    // Stacked, the lower banner continues the one above it.
    "[[data-slot=composer-banner]+&]:rounded-t-none [[data-slot=composer-banner]+&]:border-t-0",
  ],
  {
    variants: {
      variant: {
        default: "[--banner-outline:var(--border)] [--banner-tint:transparent]",
        info: "[--banner-outline:color-mix(in_oklab,var(--primary)_30%,var(--border))] [--banner-tint:color-mix(in_oklab,var(--primary)_6%,transparent)]",
        warning:
          "[--banner-outline:color-mix(in_oklab,var(--color-amber-500)_35%,transparent)] [--banner-tint:color-mix(in_oklab,var(--color-amber-500)_8%,transparent)]",
        error:
          "[--banner-outline:color-mix(in_oklab,var(--destructive)_35%,transparent)] [--banner-tint:color-mix(in_oklab,var(--destructive)_8%,transparent)]",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

export type ComposerBannerVariant = NonNullable<
  VariantProps<typeof composerBannerVariants>["variant"]
>

export type ComposerBannerProps = React.ComponentProps<"div"> &
  VariantProps<typeof composerBannerVariants>

/**
 * One drawer section: rows of `icon · content · actions`, and optionally a
 * body under them. Set `role` and an accessible name yourself when the banner
 * asks something — a `section` with `aria-label`, or `role="alert"` for an
 * error the user did not ask for.
 */
export function ComposerBanner({
  variant,
  className,
  ...props
}: ComposerBannerProps) {
  return (
    <div
      data-slot="composer-banner"
      data-variant={variant ?? "default"}
      className={cn(composerBannerVariants({ variant }), className)}
      {...props}
    />
  )
}

/** `icon · content · actions` on one line; a row without an icon starts flush. */
export function ComposerBannerRow({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-banner-row"
      className={cn(
        "flex min-h-7 w-full min-w-0 items-center gap-1 [&>[data-slot=composer-banner-content]:first-child]:ps-2",
        className
      )}
      {...props}
    />
  )
}

export function ComposerBannerIcon({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      data-slot="composer-banner-icon"
      className={cn(
        "flex w-7 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-3.5",
        "group-data-[variant=warning]/banner:text-amber-600 dark:group-data-[variant=warning]/banner:text-amber-400",
        "group-data-[variant=error]/banner:text-destructive group-data-[variant=info]/banner:text-primary",
        className
      )}
      {...props}
    />
  )
}

export function ComposerBannerContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-banner-content"
      className={cn("flex min-w-0 flex-1 items-center gap-1.5", className)}
      {...props}
    />
  )
}

export function ComposerBannerTitle({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="composer-banner-title"
      className={cn("shrink-0 font-medium", className)}
      {...props}
    />
  )
}

export function ComposerBannerDescription({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="composer-banner-description"
      className={cn("min-w-0 truncate text-muted-foreground", className)}
      {...props}
    />
  )
}

/** "1/3" — which of several waiting requests this is. */
export function ComposerBannerCount({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="composer-banner-count"
      className={cn(
        "shrink-0 px-1 font-medium text-muted-foreground tabular-nums",
        className
      )}
      {...props}
    />
  )
}

export function ComposerBannerActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-banner-actions"
      className={cn("flex shrink-0 items-center gap-1", className)}
      {...props}
    />
  )
}

export const composerBannerActionVariants = cva(
  "inline-flex h-6 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md px-2 text-[12px] font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        ghost: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        outline:
          "border bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
      },
    },
    defaultVariants: { variant: "ghost" },
  }
)

export function ComposerBannerAction({
  variant,
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof composerBannerActionVariants>) {
  return (
    <button
      type={type}
      data-slot="composer-banner-action"
      data-variant={variant ?? "ghost"}
      className={cn(composerBannerActionVariants({ variant }), className)}
      {...props}
    />
  )
}

export function ComposerBannerDismiss({
  className,
  children,
  "aria-label": ariaLabel = "Dismiss",
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="composer-banner-dismiss"
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn(
        composerBannerActionVariants({ variant: "ghost" }),
        "w-6 px-0",
        className
      )}
      {...props}
    >
      {children ?? <X />}
    </button>
  )
}

/**
 * Whatever does not fit on a row — a command to approve, a form. Indented to
 * the content column when the rows above it carry icons (`inset`), and capped
 * so a long body scrolls inside the drawer instead of pushing the transcript
 * off the screen.
 */
export function ComposerBannerBody({
  inset = false,
  className,
  ...props
}: React.ComponentProps<"div"> & { inset?: boolean }) {
  return (
    <div
      data-slot="composer-banner-body"
      data-inset={inset || undefined}
      className={cn(
        "max-h-[min(24rem,40dvh)] min-w-0 overflow-y-auto overscroll-contain px-2 pt-1 pb-1.5 data-[inset=true]:ps-8",
        className
      )}
      {...props}
    />
  )
}
