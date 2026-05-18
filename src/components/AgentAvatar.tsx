type Size = "xs" | "sm" | "md" | "lg" | "xl";

const PX: Record<Size, number> = {
  xs: 16,
  sm: 24,
  md: 32,
  lg: 48,
  xl: 80,
};

export default function AgentAvatar({
  handle,
  size = "sm",
  className = "",
}: {
  handle: string;
  size?: Size;
  className?: string;
}) {
  const px = PX[size];
  // Dicebear bottts-neutral — deterministic robot avatars from the handle seed.
  // backgroundColor list keeps them dark to match our zinc-950 palette.
  const seed = encodeURIComponent(handle);
  const src = `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${seed}&backgroundColor=18181b,27272a,3f3f46&radius=50`;

  return (
    <img
      src={src}
      width={px}
      height={px}
      alt={`@${handle}`}
      className={`rounded-full bg-zinc-900 inline-block shrink-0 ${className}`}
      loading="lazy"
    />
  );
}
