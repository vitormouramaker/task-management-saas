import { useEffect, useState } from "react";
import { buildAssetUrl } from "../../lib/api";
import { cn, getInitials } from "../../lib/utils";
import type { Member } from "../../types/tasks";

interface UserAvatarProps {
  member?: Member;
  className?: string;
  size?: number; // In px
}

export function UserAvatar({ member, className, size = 32 }: UserAvatarProps) {
  // Link de foto expirado ou fora do ar: mostramos as iniciais.
  const [imagemFalhou, setImagemFalhou] = useState(false);

  useEffect(() => {
    setImagemFalhou(false);
  }, [member?.avatarUrl]);

  if (!member) return null;

  const mostrarFoto = Boolean(member.avatarUrl) && !imagemFalhou;

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2",
        "border-(--ui-superficie-suave) ring-1 ring-(--ui-borda-suave)",
        mostrarFoto
          ? "bg-(--ui-fundo-sutil)"
          : member.avatarColor || "bg-slate-400",
        className,
      )}
      style={{ width: size, height: size }}
      title={member.name}
    >
      {mostrarFoto ? (
        <img
          src={buildAssetUrl(member.avatarUrl)}
          alt={member.name}
          onError={() => setImagemFalhou(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="text-[10px] font-black text-white leading-none">
          {getInitials(member.name)}
        </span>
      )}
    </div>
  );
}
