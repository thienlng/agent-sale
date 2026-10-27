import { Smile } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** Emojis Vietnamese shops use most in sales chats; inserted into the draft, never sent alone. */
export const COMPOSER_EMOJIS: readonly string[] = [
  '😀 😁 😂 🤣 😊 😍 🥰 😘 😉 😎',
  '🤗 🤔 😅 😢 😭 😡 😮 🙄 😴 🥳',
  '👍 👎 👏 🙏 👌 ✌️ 💪 🤝 👋 👉',
  '❤️ 🧡 💛 💚 💙 💜 💯 🔥 ✨ 🎉',
  '🎁 🛍️ 📦 🚚 💰 💵 📞 📍 ⏰ ✅',
]
  .join(' ')
  .split(' ');

export function EmojiPicker({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (emoji: string) => void;
}) {
  const { t } = useTranslation();
  const label = t('channelInbox.meta.composer.emoji');
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={label} title={label}>
          <Smile />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-72 p-2"
        // The draft keeps focus handling: the composer puts the caret back after inserting.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div role="group" aria-label={label} className="grid grid-cols-10 gap-0.5">
          {COMPOSER_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={emoji}
              className="grid size-6 place-items-center rounded text-lg hover:bg-muted"
              onClick={() => {
                onPick(emoji);
                setOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
