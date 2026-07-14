import { MessageCircle, RotateCcw } from "lucide-react";

export function RecallLensLogo({ size = 21 }: { size?: number }) {
  const recallSize = Math.max(9, Math.round(size * 0.48));

  return (
    <span className="recall-lens-logo" style={{ width: size, height: size }} aria-hidden="true">
      <MessageCircle className="recall-lens-bubble" size={size} strokeWidth={1.9} />
      <RotateCcw className="recall-lens-arrow" size={recallSize} strokeWidth={2.4} />
    </span>
  );
}
