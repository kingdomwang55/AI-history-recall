import Image from "next/image";
import { Bot } from "lucide-react";
import { platformLabel } from "@/lib/format";

function platformLogo(platform: string) {
  const value = platform.toLowerCase();
  if (value === "chatgpt" || value === "openai") return "/platforms/openai.svg";
  if (value === "gemini" || value === "google") return "/platforms/gemini.svg";
  if (value === "deepseek") return "/platforms/deepseek.svg";
  if (["qwen", "qianwen", "tongyi", "通义千问"].includes(value)) return "/platforms/qwen.svg";
  return null;
}

export function PlatformBadge({ platform }: { platform: string }) {
  const logo = platformLogo(platform);

  return (
    <span className="platform-badge">
      {logo ? <Image src={logo} alt="" aria-hidden width={14} height={14} unoptimized /> : <Bot size={14} strokeWidth={1.8} aria-hidden />}
      <span>{platformLabel(platform)}</span>
    </span>
  );
}
