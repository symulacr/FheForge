import Image from "next/image";
import { assetIcons, iconMap } from "@/lib/iconMap";

interface Props {
  protocolName?: string;
}

export default function ProtocolIcon({ protocolName }: Props) {
  const iconSrc =
    (protocolName ? assetIcons[protocolName] : undefined) ??
    iconMap[protocolName ?? ""] ??
    "/icons/assets/weth.svg";

  return (
    <div className="w-6 h-6 relative border border-border bg-card overflow-hidden shrink-0">
      <Image
        src={iconSrc}
        alt={protocolName ?? "Protocol"}
        width={24}
        height={24}
        className="w-full h-full object-cover"
      />
    </div>
  );
}
