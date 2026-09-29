import { cn } from './cn'

export function Skeleton({ className, lines = 1 }: { className?: string; lines?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className={cn('h-4 animate-pulse rounded-control bg-surface-sunken', className)}
        />
      ))}
    </div>
  )
}
