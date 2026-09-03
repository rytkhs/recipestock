import { type ReactNode } from "react";

export const ScreenTopBarFrame = ({ children }: { children: ReactNode }) => (
  <div className="sticky top-0 z-30 bg-brand-cream/95 px-3 py-2.5 backdrop-blur-md sm:-mx-6 sm:top-16 sm:px-6 sm:py-4 lg:-mx-10 lg:px-10">
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto] sm:gap-3">
      {children}
    </div>
  </div>
);

export const ScreenTopBarIconButton = ({
  "aria-label": ariaLabel,
  children,
  onPress,
}: {
  "aria-label": string;
  children: ReactNode;
  onPress: () => void;
}) => (
  <button
    aria-label={ariaLabel}
    className="grid h-10 w-10 place-items-center rounded-full border border-brand-line bg-brand-paper-raised text-brand-walnut transition-colors hover:bg-brand-paper-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange sm:h-11 sm:w-11"
    type="button"
    onClick={onPress}
  >
    {children}
  </button>
);

export const ScreenTopBar = ({
  leading,
  title,
  trailing,
}: {
  leading: ReactNode;
  title: ReactNode;
  trailing?: ReactNode;
}) => (
  <ScreenTopBarFrame>
    {leading}
    <h1 className="min-w-0 truncate text-center font-bold text-brand-ink text-md leading-tight sm:text-left sm:text-xl">
      {title}
    </h1>
    {trailing ?? <span aria-hidden="true" className="block h-10 w-10 sm:h-11 sm:w-11" />}
  </ScreenTopBarFrame>
);
