type StandaloneNavigator = Navigator & { standalone?: boolean };

export const isStandaloneWebApp = () =>
  (typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches) ||
  Boolean((navigator as StandaloneNavigator).standalone);
