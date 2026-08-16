import type { LucideIcon } from 'lucide-react';

/** A single shimmering placeholder block. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-black/[0.06] ${className}`} />;
}

/** A card-shaped skeleton row grid — a calm stand-in while data loads. */
export function SkeletonCards({ count = 3, className = '' }: { count?: number; className?: string }) {
  return (
    <div className={`grid gap-4 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white border border-black/5 rounded-2xl p-5 shadow-sm">
          <Skeleton className="h-3 w-24 mb-3" />
          <Skeleton className="h-7 w-32 mb-2" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/** A skeleton list — rows of avatar + two lines. */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-white border border-black/5 rounded-2xl divide-y divide-black/5 overflow-hidden shadow-sm">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3.5">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-3.5 w-40 mb-2" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** A polished empty state: icon, one line, and an optional primary action. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="w-14 h-14 rounded-2xl bg-gray-100 border border-black/5 grid place-items-center mb-4">
        <Icon size={24} className="text-gray-400" strokeWidth={1.8} />
      </div>
      <p className="text-navy font-semibold text-[15px]">{title}</p>
      {hint && <p className="text-gray-500 text-sm mt-1 max-w-xs">{hint}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 bg-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-teal/90 active:scale-[0.98] transition-transform"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
