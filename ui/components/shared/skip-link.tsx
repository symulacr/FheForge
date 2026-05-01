export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[60] focus:bg-background focus:text-foreground focus:px-4 focus:py-2 focus:border focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
    >
      Skip to main content
    </a>
  );
}
