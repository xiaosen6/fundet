import { useSyncExternalStore, useState } from 'react';
import { Pencil, UserRound } from 'lucide-react';
import { getProfile, setProfile, subscribeProfile } from '../../lib/profile';
import { cn } from '../../lib/cn';

export function UserProfileCard(): React.JSX.Element {
  const profile = useSyncExternalStore(subscribeProfile, getProfile, getProfile);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(profile.name);

  const pickAvatar = async (): Promise<void> => {
    const data = await window.fundet.pickImageDataUrl();
    if (data) setProfile({ avatar: data });
  };

  return (
    <div className="flex w-full items-center gap-[14px] rounded-xl border border-board bg-card-ivory p-5">
      <button
        type="button"
        onClick={() => void pickAvatar()}
        title="更换头像"
        className="group relative h-[52px] w-[52px] shrink-0 cursor-pointer rounded-full"
      >
        {profile.avatar ? (
          <img
            src={profile.avatar}
            alt=""
            className="h-[52px] w-[52px] rounded-full object-cover transition-opacity group-hover:opacity-80"
          />
        ) : (
          <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-board bg-chip text-secondary">
            <UserRound aria-hidden size={22} strokeWidth={1.75} />
          </div>
        )}
      </button>
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              setProfile({ name: nameDraft });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setProfile({ name: nameDraft });
                setEditing(false);
              }
              if (e.key === 'Escape') setEditing(false);
            }}
            className="h-8 w-full max-w-[240px] rounded-lg border border-board bg-card px-2 text-16 font-medium text-primary outline-none"
          />
        ) : (
          <p className="truncate text-18 font-medium leading-[1.2] text-primary">{profile.name}</p>
        )}
        <p className="mt-1 text-12 text-muted">数据只留在本机，不登录云账号</p>
      </div>
      <button
        type="button"
        title="编辑名称"
        onClick={() => {
          setNameDraft(profile.name);
          setEditing(true);
        }}
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted',
          'transition-colors hover:bg-hover hover:text-primary',
        )}
      >
        <Pencil size={14} />
      </button>
    </div>
  );
}
