import Image from "next/image";

export default function ProtocolIcon() {
  return (
    <div className="w-6 h-6 relative border border-border bg-card overflow-hidden shrink-0">
      <Image
        src="/icons/assets/weth.svg"
        alt="Protocol"
        width={24}
        height={24}
        className="w-full h-full object-cover"
      />
    </div>
  );
}
