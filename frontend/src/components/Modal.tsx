'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

const sizeMap = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-50 backdrop-blur-sm" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50
            w-[calc(100vw-2rem)] ${sizeMap[size]}
            bg-[#111113] border border-[#27272a] rounded-2xl
            max-h-[90vh] overflow-y-auto shadow-2xl`}
        >
          <div className="flex items-center justify-between p-5 border-b border-[#27272a]">
            <Dialog.Title className="text-base font-semibold text-white">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-[#27272a] transition-colors text-[#71717a] hover:text-white"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          <div className="p-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
