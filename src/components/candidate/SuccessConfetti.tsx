import { useEffect, useState } from "react";

/**
 * Confete leve via CSS puro — emojis flutuando ao montar.
 * Sem dependência externa (canvas-confetti). Disparo único.
 */
export function SuccessConfetti() {
  const [show, setShow] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setShow(false), 3500);
    return () => clearTimeout(t);
  }, []);

  if (!show) return null;

  const emojis = ["💛", "✨", "🎉", "💛", "✨", "🎉", "💛", "✨"];

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      {emojis.map((e, i) => (
        <span
          key={i}
          className="absolute text-2xl animate-confetti-fall"
          style={{
            left: `${(i * 13 + 8) % 95}%`,
            top: "-10%",
            animationDelay: `${i * 0.15}s`,
            animationDuration: `${2.4 + (i % 3) * 0.4}s`,
          }}
        >
          {e}
        </span>
      ))}
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translateY(110vh) rotate(360deg); opacity: 0; }
        }
        .animate-confetti-fall {
          animation-name: confetti-fall;
          animation-timing-function: ease-in;
          animation-fill-mode: forwards;
        }
      `}</style>
    </div>
  );
}
