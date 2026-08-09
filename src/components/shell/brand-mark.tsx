export function BrandMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className ?? "brand-mark"}
      src="/prism-mark.png?v=asymmetric"
      width={52}
      height={52}
      alt=""
      aria-hidden
      draggable={false}
    />
  );
}
