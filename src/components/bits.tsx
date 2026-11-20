const COLOR_NAME: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
};

export function Pips({ colors }: { colors: string[] }) {
  const list = colors.length > 0 ? colors : ['C'];
  const label = list.map((color) => COLOR_NAME[color] ?? color).join(', ');
  return (
    <span className="pips" aria-label={label}>
      {list.map((color) => (
        <span key={color} className={`pip pip-${color}`} aria-hidden="true">
          {color}
        </span>
      ))}
    </span>
  );
}

export function rarityClass(rarity: string): string {
  return `rarity rarity-${rarity.toLowerCase().replace(/[^a-z]/g, '')}`;
}

export function CardImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  if (!src) {
    return <span className={className ? `fallback ${className}` : 'fallback'}>{alt}</span>;
  }
  return <img className={className} src={src} alt={alt} decoding="async" />;
}
