import { useEffect, useState } from "react";
import { useTaskStore } from "../../../store/use-task-store";
import { InviteMemberModal } from "./invite-member-modal";
import { PendingInvitations } from "./pending-invitations";
import { Plus, Search, Mail, Briefcase, Star, SearchX, ShieldCheck } from "lucide-react";
import { buildAssetUrl } from "../../../lib/api";
import { cn, getInitials } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { useThemeStore } from "../../../store/use-theme-store";
import { UserEditModal } from "./user-edit-modal";
import { ConfirmationModal } from "../../../components/ui/confirmation-modal";
import { Skeleton } from "../../../components/ui/skeleton";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "../../../store/use-toast-store";

export function UsersPage() {
  const graph = useTaskStore((state) => state.graph);
  const currentUser = useAuthStore((state) => state.user);
  const isAdmin =
    currentUser?.organization?.role === "owner" ||
    currentUser?.organization?.role === "admin";
  const [inviteRefreshKey, setInviteRefreshKey] = useState(0);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const members = Object.values(graph.members);

  const [isInitializing, setIsInitializing] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setIsInitializing(false), 160);
    return () => clearTimeout(t);
  }, []);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editMemberData, setEditMemberData] = useState<{
    id: string;
    name: string;
    role: string;
    tagIds: string[];
    accessRole: "owner" | "admin" | "member";
  } | null>(null);
  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);

  const handleEditClick = (member: any) => {
    setEditMemberData({
      id: member.id,
      name: member.name,
      role: member.role || "",
      accessRole: member.accessRole || "member",
      tagIds: member.tagIds || member.tags?.map((tag: any) => tag.id) || [],
    });
    setIsEditModalOpen(true);
  };

  const handleRemoveClick = (memberId: string) => {
    setRemoveMemberId(memberId);
    setIsRemoveModalOpen(true);
  };

  const confirmRemove = async () => {
    if (!removeMemberId) return;
    try {
      await axios.delete(`/api/users/${removeMemberId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      queryClient.invalidateQueries({ queryKey: ["workspace-seed"] });
      toast.success("Usuário removido.", {
        message: "O acesso ao espaço de trabalho foi revogado.",
      });
    } catch (err: any) {
      toast.error("Não foi possível remover o usuário.", {
        message:
          err.response?.data?.message || "O usuário continua no espaço de trabalho.",
      });
    }
  };

  const filteredMembers = members.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.email?.toLowerCase().includes(search.toLowerCase()) ||
      m.role?.toLowerCase().includes(search.toLowerCase()) ||
      m.tags?.some((tag: any) =>
        tag.name.toLowerCase().includes(search.toLowerCase()),
      ),
  );

  if (isInitializing) {
    return (
      <div className="flex h-full w-full flex-col animate-in fade-in duration-200">
        <div className="flex-1 overflow-auto pauta-scroll-safe min-w-0 px-4 py-4 sm:px-8 sm:py-8">
          <div className="mb-8 flex items-start justify-between">
            <div className="space-y-2">
              <Skeleton className="h-8 w-52 rounded-full" />
              <Skeleton className="h-4 w-96 rounded-full" />
            </div>
            <Skeleton className="h-10 w-40 rounded-xl" />
          </div>

          <div
            className={cn(
              "mb-6 flex items-center justify-between rounded-2xl border p-3",
              "border-(--ui-borda-suave) bg-(--ui-superficie)",
            )}
          >
            <Skeleton className="h-9 w-80 rounded-xl" />
            <Skeleton className="h-7 w-36 rounded-full" />
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className={cn(
                  "flex flex-col rounded-2xl border p-5",
                  "border-(--ui-borda) bg-(--ui-superficie)",
                )}
              >
                <div className="flex items-start gap-4">
                  <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32 rounded-full" />
                    <Skeleton className="h-3 w-24 rounded-full" />
                    <Skeleton className="h-3 w-40 rounded-full" />
                  </div>
                </div>
                <div
                  className={cn(
                    "mt-5 grid grid-cols-2 gap-3 border-t pt-4",
                    "border-(--ui-borda-suave)",
                  )}
                >
                  <Skeleton className="h-8 w-full rounded-lg" />
                  <Skeleton className="h-8 w-full rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col animate-in fade-in duration-300">
      <div className="flex-1 overflow-auto pauta-scroll-safe min-w-0 px-4 py-4 sm:px-8 sm:py-8">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div>
            <h1
              className={cn(
                "text-2xl font-black tracking-tight",
                "text-(--ui-texto-principal)",
              )}
            >
              Membros da Equipe
            </h1>
            <p
              className={cn(
                "mt-1 text-sm font-medium",
                "text-(--ui-texto-secundario)",
              )}
            >
              Gerencie os colaboradores, adicione novos membros e os atribua aos
              espaços de trabalho da sua organização.
            </p>
          </div>

          {isAdmin && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-500/20 hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-blue-500/30 transition-all cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Convidar membro
            </button>
          )}
        </div>

        {/* Toolbar */}
        <div
          className={cn(
            "mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3 shadow-sm",
            isDarkMode
              ? "border-(--border-subtle) bg-(--bg-elevated) shadow-black/20"
              : "border-slate-100 bg-white",
          )}
        >
          <div className="relative min-w-0 flex-1 max-w-sm">
            <Search
              className={cn(
                "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
                "text-(--ui-texto-secundario)",
              )}
            />
            <input aria-label="Pesquisar por nome, email ou cargo..."
              type="text"
              placeholder="Pesquisar por nome, email ou cargo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn(
                "w-full appearance-none rounded-xl border py-2 pl-9 pr-4 text-sm font-medium outline-none transition-all",
                "border-(--ui-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-principal) placeholder:text-(--ui-texto-secundario) focus:border-blue-400 focus:ring-4 focus:ring-(--ui-azul-foco)",
              )}
            />
          </div>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold",
                "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
              )}
            >
              {members.length}{" "}
              {members.length === 1
                ? "Membro Cadastrado"
                : "Membros Cadastrados"}
            </div>
          </div>
        </div>

        {isAdmin && <PendingInvitations refreshKey={inviteRefreshKey} />}

        {/* Results */}
        {filteredMembers.length === 0 ? (
          <div className="py-24 flex flex-col items-center justify-center text-center">
            <div
              className={cn(
                "mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed",
                "border-(--ui-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-apagado)",
              )}
            >
              <SearchX className="h-6 w-6" />
            </div>
            <h3
              className={cn(
                "text-lg font-black",
                "text-(--ui-texto-principal)",
              )}
            >
              Nenhum membro encontrado
            </h3>
            <p
              className={cn(
                "mt-1 max-w-xs text-sm font-medium",
                "text-(--ui-texto-secundario)",
              )}
            >
              Tente ajustar a sua pesquisa para algo mais genérico ou adicione
              um novo.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {filteredMembers.map((member) => (
              <div
                key={member.id}
                className={cn(
                  "group relative flex flex-col rounded-2xl border p-5 shadow-sm transition-all hover:-translate-y-1",
                  isDarkMode
                    ? "border-(--border-subtle) bg-(--bg-elevated) hover:shadow-(--shadow-soft)"
                    : "border-slate-200 bg-white hover:shadow-xl hover:shadow-slate-200/50",
                )}
              >
                {member.accessRole === "owner" && (
                  <div className="absolute top-4 right-4 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-600">
                    <Star className="h-3 w-3 fill-amber-500/20" />
                    Titular
                  </div>
                )}
                {member.accessRole === "admin" && (
                  <div className="absolute top-4 right-4 inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-blue-600">
                    <ShieldCheck className="h-3 w-3" />
                    Admin
                  </div>
                )}
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      "h-12 w-12 shrink-0 overflow-hidden rounded-full border ring-4 shadow-sm",
                      "border-(--ui-borda-suave) ring-(--ui-borda-suave) bg-(--ui-fundo-neutro)",
                    )}
                  >
                    {member.avatarUrl ? (
                      <img
                        src={buildAssetUrl(member.avatarUrl)}
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                        alt={member.name}
                        className="h-full w-full object-cover"
                      />
                    ) : member.avatarColor ? (
                      <div
                        className={cn(
                          "flex h-full w-full items-center justify-center text-[13px] font-black text-white",
                          member.avatarColor,
                        )}
                      >
                        {getInitials(member.name)}
                      </div>
                    ) : (
                      <img
                        src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=facearea&facepad=2&w=256&h=256&q=80"
                        alt="Avatar"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="flex-1 overflow-hidden min-w-0">
                    <h3
                      className={cn(
                        "truncate text-[15px] font-black tracking-tight",
                        "text-(--ui-texto-principal)",
                      )}
                    >
                      {member.name}{" "}
                      {member.id === currentUser?.id && (
                        <span
                          className={cn(
                            "ml-1 rounded px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-widest",
                            "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
                          )}
                        >
                          Você
                        </span>
                      )}
                    </h3>
                    <div
                      className={cn(
                        "mt-1.5 flex items-center gap-2 truncate text-[12px] font-medium",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      <Briefcase className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {member.role || "Sem cargo definido"}
                      </span>
                    </div>
                    {member.email && (
                      <div
                        className={cn(
                          "mt-1 flex items-center gap-2 truncate text-[12px] font-medium",
                          "text-(--ui-texto-secundario)",
                        )}
                      >
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">{member.email}</span>
                      </div>
                    )}
                    {Boolean(member.tags?.length) && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(member.tags || []).map((tag: any) => (
                          <span
                            key={tag.id}
                            className="rounded-full px-2.5 py-1 text-[10px] font-black"
                            style={{
                              backgroundColor: tag.color,
                              color: "white",
                            }}
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {isAdmin && member.accessRole !== "owner" && (
                <div
                  className={cn(
                    "mt-5 grid grid-cols-2 gap-3 border-t pt-4 transition-opacity",
                    "border-(--ui-borda-suave)",
                  )}
                >
                  <button
                    onClick={() => handleEditClick(member)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer",
                      "bg-(--ui-fundo-sutil) text-(--ui-texto-secundario) hover:bg-(--ui-azul-fundo) hover:text-(--ui-azul-texto)",
                    )}
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleRemoveClick(member.id)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer",
                      "bg-(--ui-fundo-sutil) text-(--ui-texto-secundario) hover:bg-(--ui-rose-fundo) hover:text-(--ui-rose-texto)",
                    )}
                  >
                    Remover
                  </button>
                </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <InviteMemberModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onInvited={() => setInviteRefreshKey((key) => key + 1)}
      />

      {editMemberData && (
        <UserEditModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          memberId={editMemberData.id}
          initialName={editMemberData.name}
          initialRole={editMemberData.role}
          initialTagIds={editMemberData.tagIds}
          initialAccessRole={editMemberData.accessRole}
        />
      )}

      <ConfirmationModal
        isOpen={isRemoveModalOpen}
        onClose={() => setIsRemoveModalOpen(false)}
        onConfirm={confirmRemove}
        title="Remover Membro"
        message="Tem certeza que deseja remover este membro da equipe? O membro perderá o acesso à plataforma e será desvinculado dos projetos correspondentes."
        confirmLabel="Remover Membro"
        cancelLabel="Cancelar"
        variant="danger"
      />
    </div>
  );
}
