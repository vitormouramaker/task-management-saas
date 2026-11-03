import { createPortal } from 'react-dom';
import { X, User, Mail, Briefcase, Building2, Camera, Save, ArrowRight, Loader2, ChevronDown } from 'lucide-react';
import { useRef, useState, useEffect } from 'react';
import axios from 'axios';

import { Input } from '../../../components/ui/input';
import { buildAssetUrl } from '../../../lib/api';
import { cn, getInitials } from '../../../lib/utils';
import { useAuthStore } from '../../../store/use-auth-store';
import { useTaskStore } from '../../../store/use-task-store';
import { useThemeStore } from '../../../store/use-theme-store';
import { toast } from '../../../store/use-toast-store';
import { getUploadErrorMessage } from '../../../lib/file-upload';
import { useFecharComEsc } from "../../../lib/use-fechar-com-esc";

const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SecurityFeedback =
  | { type: 'success'; message: string }
  | { type: 'error'; message: string }
  | null;

export function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
  const user = useAuthStore((state) => state.user);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const setAvatarUser = useAuthStore((state) => state.setAvatarUser);
  const forgotPassword = useAuthStore((state) => state.forgotPassword);
  const isLoading = useAuthStore((state) => state.isLoading);
  const isDarkMode = useThemeStore((state) => state.mode === 'dark');
  const availableTags = Object.values(useTaskStore((state) => state.graph.tags));

  const isAdm =
    user?.organization?.role === 'owner' ||
    user?.organization?.role === 'admin';

  const fileInputRef = useRef<HTMLInputElement>(null);
  const roleSelectRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<'profile' | 'security'>('profile');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [availableRoles, setAvailableRoles] = useState<string[]>([]);
  const [isRoleSelectOpen, setIsRoleSelectOpen] = useState(false);
  const [pendingAvatarBase64, setPendingAvatarBase64] = useState<string | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  const [securityFeedback, setSecurityFeedback] = useState<SecurityFeedback>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (roleSelectRef.current && !roleSelectRef.current.contains(e.target as Node)) {
        setIsRoleSelectOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen) {
      axios
        .get('/api/users/roles', {
          headers: { Authorization: `Bearer ${useAuthStore.getState().token}` },
        })
        .then((res) => setAvailableRoles(res.data.roles))
        .catch((err) => console.error('Erro ao carregar cargos', err));
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && user) {
      setName(user.name);
      setRole(user.role || '');
      setActiveTab('profile');
      setPendingAvatarBase64(null);
      setAvatarPreviewUrl(user.avatarUrl || null);
      setSelectedTagIds(user.tagIds || user.tags?.map((tag) => tag.id) || []);
      setIsRoleSelectOpen(false);
      setSecurityFeedback(null);
    }
  }, [isOpen, user]);

  const hasProfileChanges = !!user && (
    name.trim() !== user.name ||
    (isAdm && role !== (user.role || '')) ||
    (isAdm && JSON.stringify([...(selectedTagIds || [])].sort()) !== JSON.stringify([...(user.tagIds || user.tags?.map((tag) => tag.id) || [])].sort()))
  );
  const hasPendingAvatar = !!pendingAvatarBase64;
  const isSaving = isLoading || isSavingAvatar;
  const displayedAvatarUrl = avatarPreviewUrl
    ? avatarPreviewUrl.startsWith('data:')
      ? avatarPreviewUrl
      : buildAssetUrl(avatarPreviewUrl)
    : null;

  const handleSave = async () => {
    if (!user || !name.trim() || (!hasProfileChanges && !hasPendingAvatar)) {
      return;
    }

    const trimmedName = name.trim();

    if (hasProfileChanges) {
      const success = await updateProfile(trimmedName, role, selectedTagIds);
      if (!success) {
        return;
      }
    }

    if (pendingAvatarBase64) {
      setIsSavingAvatar(true);
      try {
        const response = await axios.post(
          '/api/users/profile/avatar/upload',
          { imageBase64: pendingAvatarBase64 },
          { headers: { Authorization: `Bearer ${useAuthStore.getState().token}` } }
        );
        setAvatarUser(response.data.user);
        setAvatarPreviewUrl(response.data.user.avatarUrl || null);
        setPendingAvatarBase64(null);
      } catch (error) {
        console.error('Erro ao fazer upload da imagem', error);
        toast.error('Não foi possível atualizar a foto.', {
          message: getUploadErrorMessage(error, 'Tente novamente em instantes.'),
        });
      } finally {
        setIsSavingAvatar(false);
      }
    }
  };

  const handleImageSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!AVATAR_TYPES.includes(file.type)) {
      toast.error('Formato de imagem não suportado.', { message: 'Use PNG, JPG ou WebP.' });
      e.target.value = '';
      return;
    }

    if (file.size > MAX_AVATAR_BYTES) {
      toast.error('Imagem muito grande.', { message: 'A foto de perfil deve ter no máximo 2 MB.' });
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setPendingAvatarBase64(base64);
      setAvatarPreviewUrl(base64);
    };
    reader.readAsDataURL(file);
  };

  const handlePasswordResetRequest = async () => {
    if (!user?.email) {
      setSecurityFeedback({ type: 'error', message: 'Nenhum e-mail corporativo foi encontrado para esta conta.' });
      return;
    }

    const result = await forgotPassword(user.email);
    setSecurityFeedback({
      type: result.success ? 'success' : 'error',
      message: result.message,
    });
  };

  if (!isOpen || !user) return null;

  const toggleTag = (tagId: string) => {
    if (!isAdm) return;
    setSelectedTagIds((current) =>
      current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId]
    );
  };

  // Esc fecha a janela, como em qualquer aplicativo.

  useFecharComEsc(true, onClose);

  return createPortal(
    <div className="fixed inset-0 z-9999 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Seu perfil">
      <div
        className="pauta-theme-overlay absolute inset-0 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className={cn("relative z-10 w-full max-w-2xl rounded-3xl animate-in fade-in zoom-in-95 duration-200", isDarkMode ? "pauta-theme-surface" : "bg-white shadow-2xl shadow-slate-900/10")}>
        <div className="relative h-32 rounded-t-3xl bg-linear-to-r from-blue-600 to-indigo-600">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative px-8 pb-8">
          <div className="absolute -top-16 left-8">
            <input
              type="file"
              accept="image/png, image/jpeg, image/jpg"
              className="hidden"
              ref={fileInputRef}
              onChange={handleImageSelection}
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className={cn("group relative h-32 w-32 cursor-pointer overflow-hidden rounded-full border-4 shadow-xl", "border-(--ui-superficie) bg-(--ui-fundo-neutro)")}
            >
              {displayedAvatarUrl ? (
                <img src={displayedAvatarUrl} onError={(event) => { event.currentTarget.style.display = "none"; }} alt="Avatar" className="h-full w-full object-cover" />
              ) : user.avatarColor ? (
                <div className={cn('flex h-full w-full items-center justify-center text-4xl font-black text-white', user.avatarColor)}>
                  {getInitials(name || user.name)}
                </div>
              ) : null}

              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                <Camera className="h-8 w-8 text-white" />
              </div>
            </div>
          </div>

          <div className="ml-40 flex items-start justify-between pt-4">
            <div>
              <h2 className={cn("text-2xl font-black", "text-(--ui-texto-principal)")}>{name || user.name}</h2>
              <p className={cn("text-sm font-medium", "text-(--ui-texto-secundario)")}>{role || 'Membro'}</p>
            </div>

            <button
              onClick={handleSave}
              disabled={isSaving || !name.trim() || (!hasProfileChanges && !hasPendingAvatar)}
              className={cn("flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-bold text-white transition-all active:scale-95 cursor-pointer disabled:pointer-events-none disabled:opacity-50", isDarkMode ? "bg-blue-600 shadow-lg shadow-blue-950/30 hover:bg-blue-500" : "bg-slate-900 shadow-lg shadow-slate-900/20 hover:bg-slate-800")}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar Alterações
            </button>
          </div>

          <div className={cn("mt-8 flex gap-6 border-b", "border-(--ui-borda-suave)")}>
            <button
              onClick={() => setActiveTab('profile')}
              className={cn(
                'relative pb-3 text-sm font-bold transition-all cursor-pointer',
                activeTab === 'profile' ? 'text-blue-600' : "text-(--ui-texto-secundario) hover:text-(--ui-texto-secundario)"
              )}
            >
              Informações Pessoais
              {activeTab === 'profile' && (
                <div className="absolute bottom-0 left-0 h-0.5 w-full rounded-t-full bg-blue-600" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('security')}
              className={cn(
                'relative pb-3 text-sm font-bold transition-all cursor-pointer',
                activeTab === 'security' ? 'text-blue-600' : "text-(--ui-texto-secundario) hover:text-(--ui-texto-secundario)"
              )}
            >
              Segurança
              {activeTab === 'security' && (
                <div className="absolute bottom-0 left-0 h-0.5 w-full rounded-t-full bg-blue-600" />
              )}
            </button>
          </div>

          <div className="mt-8">
            {activeTab === 'profile' && (
              <div className="grid grid-cols-2 gap-6 animate-in fade-in slide-in-from-left-4 duration-300">
                <div className="space-y-2">
                  <label className={cn("text-[12px] font-bold uppercase tracking-wider", "text-(--ui-texto-secundario)")}>
                    Nome Completo
                  </label>
                  <div className="relative">
                    <User className={cn("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", "text-(--ui-texto-secundario)")} />
                    <Input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={cn("h-11 pl-10", "bg-(--ui-fundo-sutil)")}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className={cn("text-[12px] font-bold uppercase tracking-wider", "text-(--ui-texto-secundario)")}>
                    E-mail Corporativo
                  </label>
                  <div className="relative">
                    <Mail className={cn("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", "text-(--ui-texto-secundario)")} />
                    <Input
                      type="email"
                      defaultValue={user.email}
                      disabled
                      className={cn("h-11 cursor-not-allowed pl-10 opacity-70", "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)")}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className={cn("text-[12px] font-bold uppercase tracking-wider", "text-(--ui-texto-secundario)")}>
                    Cargo / Função
                  </label>
                  <div className="relative" ref={roleSelectRef}>
                    <Briefcase className={cn("absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2", "text-(--ui-texto-secundario)")} />

                    <button
                      type="button"
                      disabled={!isAdm}
                      onClick={() => setIsRoleSelectOpen(!isRoleSelectOpen)}
                      className={cn(
                        "flex h-11 w-full items-center justify-between rounded-xl border border-(--ui-borda) bg-(--ui-fundo-sutil) pl-10 pr-3 text-[13px] outline-none transition-all placeholder:text-(--ui-texto-secundario)",
                        isRoleSelectOpen ? ("border-(--ui-azul-borda) ring-4 ring-(--ui-azul-borda)") : "hover:bg-(--ui-hover-forte)",
                        !role && ("text-(--ui-texto-secundario)"),
                        !isAdm ? 'cursor-not-allowed opacity-70' : "cursor-pointer text-(--ui-texto-principal)"
                      )}
                    >
                      <span className="truncate">{role || 'Selecione seu cargo'}</span>
                      <ChevronDown className={cn('h-4 w-4 transition-transform', "text-(--ui-texto-secundario)", isRoleSelectOpen && 'rotate-180')} />
                    </button>

                    {isRoleSelectOpen && isAdm && (
                      <div className={cn("absolute left-0 top-[calc(100%+8px)] z-50 max-h-56 w-full overflow-y-auto rounded-2xl border p-2 animate-in fade-in zoom-in-95 duration-200 scrollbar-thin", "pauta-theme-menu")}>
                        {availableRoles.map((availableRole) => (
                          <button
                            key={availableRole}
                            onClick={() => {
                              setRole(availableRole);
                              setIsRoleSelectOpen(false);
                            }}
                            className={cn(
                              'flex w-full cursor-pointer items-center rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors',
                              role === availableRole ? ("bg-(--ui-azul-fundo) font-bold text-(--ui-azul-texto)") : "text-(--ui-texto-forte) hover:bg-(--ui-hover)"
                            )}
                          >
                            <span className="truncate">{availableRole}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className={cn("text-[12px] font-bold uppercase tracking-wider", "text-(--ui-texto-secundario)")}>
                    Empresa
                  </label>
                  <div className="relative">
                    <Building2 className={cn("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", "text-(--ui-texto-secundario)")} />
                    <Input
                      type="text"
                      defaultValue={user.organization?.name || '—'}
                      disabled
                      className={cn("h-11 cursor-not-allowed pl-10 opacity-70", "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)")}
                    />
                  </div>
                </div>

                <div className="col-span-2 space-y-2">
                  <label className={cn("text-[12px] font-bold uppercase tracking-wider", "text-(--ui-texto-secundario)")}>
                    Etiquetas do Membro
                  </label>
                  {!isAdm && (
                    <p className={cn("text-[13px] font-medium", "text-(--ui-texto-secundario)")}>
                      Apenas administradores podem alterar etiquetas no perfil.
                    </p>
                  )}
                  <div className={cn("flex min-h-11 flex-wrap gap-2 rounded-2xl border p-3", "border-(--ui-borda) bg-(--ui-fundo-sutil)")}>
                    {availableTags.map((tag) => {
                      const isSelected = selectedTagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleTag(tag.id)}
                          disabled={!isAdm}
                          className={cn(
                            "rounded-full px-3 py-1 text-[11px] font-black transition-all",
                            isAdm ? "cursor-pointer" : "cursor-not-allowed",
                            isSelected ? "ring-2 ring-blue-500 ring-offset-2" : "opacity-65",
                            isAdm && "hover:opacity-100",
                            !isAdm && "opacity-80",
                            isDarkMode && isSelected && "ring-offset-(--bg-surface)"
                          )}
                          style={{ backgroundColor: tag.color, color: 'white' }}
                        >
                          {tag.name}
                        </button>
                      );
                    })}
                    {availableTags.length === 0 && (
                      <span className={cn("text-[13px] font-medium", "text-(--ui-texto-secundario)")}>
                        Nenhuma etiqueta cadastrada.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'security' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className={cn("rounded-2xl border p-6", "border-(--ui-rose-borda) bg-(--ui-rose-fundo)")}>
                  <h3 className={cn("text-sm font-black", "text-(--ui-rose-texto)")}>Alterar Senha</h3>
                  <p className={cn("mt-1 text-[13px] font-medium", "text-(--ui-rose-texto)")}>
                    Você pode solicitar um link de redefinição de senha para o seu e-mail corporativo.
                  </p>
                  <div className={cn("mt-4 rounded-xl border px-4 py-3 text-[13px] font-semibold", "border-(--ui-rose-borda) bg-(--ui-superficie-suave) text-(--ui-texto-secundario)")}>
                    {user.email}
                  </div>
                  {securityFeedback && (
                    <div
                      className={cn(
                        'mt-4 rounded-xl border px-4 py-3 text-[13px] font-semibold',
                        securityFeedback.type === 'success'
                          ? "border-(--ui-verde-borda) bg-(--ui-verde-fundo) text-(--ui-verde-texto)"
                          : "border-(--ui-rose-borda) bg-(--ui-rose-fundo) text-(--ui-rose-texto)"
                      )}
                    >
                      {securityFeedback.message}
                    </div>
                  )}
                  <button
                    onClick={handlePasswordResetRequest}
                    disabled={isLoading}
                    className={cn("mt-5 flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-[13px] font-bold shadow-sm transition-colors cursor-pointer disabled:pointer-events-none disabled:opacity-50", "border-(--ui-rose-borda) bg-(--ui-superficie-suave) text-(--ui-rose-texto) hover:bg-(--ui-rose-fundo)")}
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Solicitar redefinição de senha
                    {!isLoading && <ArrowRight className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

