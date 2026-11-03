/** Brand logo. Served from /public (preloaded in index.html), sized via className. */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <img
      src="/logo.webp"
      alt="Troika Music Lessons"
      width={511}
      height={300}
      decoding="async"
      className={className}
    />
  );
}
