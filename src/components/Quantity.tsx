import { useEffect, useState } from 'react';

interface QuantityProps {
  value: number;
  onChange: (quantity: number) => void;
  label?: string;
}

export function Quantity({ value, onChange, label = 'Quantity' }: QuantityProps) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  function commit(nextText: string) {
    const quantity = Number(nextText);
    if (!nextText || !Number.isFinite(quantity)) {
      setText(String(value));
      return;
    }
    onChange(Math.min(9999, Math.max(1, Math.floor(quantity))));
  }

  return (
    <div className="qty">
      <button type="button" aria-label={`Decrease ${label.toLowerCase()}`} onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1}>
        −
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        value={text}
        onChange={(event) => setText(event.target.value.replace(/[^\d]/g, '').slice(0, 4))}
        onBlur={() => commit(text)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(text);
          }
        }}
      />
      <button type="button" aria-label={`Increase ${label.toLowerCase()}`} onClick={() => onChange(Math.min(9999, value + 1))}>
        +
      </button>
    </div>
  );
}
