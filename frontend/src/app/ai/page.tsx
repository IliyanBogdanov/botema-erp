'use client';
import { useState, useRef, useEffect } from 'react';
import { api } from '@/lib/api';
import { Send, User } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const WELCOME: Message = {
  role: 'assistant',
  content: 'Здравей! Аз съм AI асистентът на Studio Botema. Мога да те помогна с финансови справки, анализи на клиенти и проекти, и въпроси за бизнеса.',
};

function AIAvatar({ size = 32 }: { size?: number }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: size * 0.34,
        background: 'rgba(191,90,242,0.15)',
        border: '1px solid rgba(191,90,242,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        fontSize: size * 0.5, color: '#bf5af2',
      }}
    >✦</div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3 justify-start">
      <AIAvatar />
      <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1.5">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const parts = msg.content.split(/(```[\s\S]*?```)/g);
  return (
    <div className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      {msg.role === 'assistant' && <AIAvatar />}
      <div className={`max-w-[75%] text-sm leading-relaxed ${
        msg.role === 'user'
          ? 'bg-primary text-on-primary rounded-2xl rounded-br-md px-4 py-3'
          : 'bg-surface-container-low text-on-surface border border-outline-variant/20 rounded-2xl rounded-bl-md'
      }`}>
        {msg.role === 'assistant' ? (
          <div className="px-4 py-3 space-y-2">
            {parts.map((part, i) =>
              part.startsWith('```') ? (
                <pre key={i} className="bg-surface-container-lowest border border-outline-variant/20 rounded-lg p-3 text-xs text-emerald-400 overflow-x-auto font-mono whitespace-pre-wrap">
                  {part.replace(/^```\w*\n?/, '').replace(/```$/, '')}
                </pre>
              ) : (
                <span key={i} className="whitespace-pre-wrap">{part}</span>
              )
            )}
          </div>
        ) : (
          <span className="whitespace-pre-wrap">{msg.content}</span>
        )}
      </div>
      {msg.role === 'user' && (
        <div className="w-8 h-8 rounded-xl bg-surface-container-high border border-outline-variant/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <User size={15} className="text-on-surface-variant" />
        </div>
      )}
    </div>
  );
}

export default function AIPage() {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: 'user', content: text };
    const history = messages.slice(1);
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const { data } = await api.post('/ai/chat', {
        message: text,
        history: history.map(m => ({ role: m.role, content: m.content })),
      });
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.reply || data.message || data.content || 'Нямам отговор в момента.',
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ Грешка при свързване с AI. Моля, опитайте отново.',
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-outline-variant/15 flex items-center gap-3">
        <AIAvatar size={36} />
        <div>
          <h1 className="font-label-caps text-label-caps text-on-surface">BOTEMA AI</h1>
          <p className="font-body-sm text-[10px] text-on-surface-variant/50">Studio Botema ERP · Gemini 2.5 Flash</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-label-caps text-[9px] text-on-surface-variant/50">ОНЛАЙН</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
        {loading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-4 py-4 border-t border-outline-variant/15">
        <div className="flex gap-3 items-end bg-surface-container-low border border-outline-variant/20 rounded-2xl px-4 py-3 focus-within:border-primary/30 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Задай въпрос..."
            rows={1}
            className="flex-1 bg-transparent text-on-surface text-sm outline-none resize-none placeholder:text-on-surface-variant/40 max-h-32"
            style={{ lineHeight: '1.5' }}
            disabled={loading}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'rgba(191,90,242,0.2)', color: '#bf5af2' }}
            title="⌘+↵"
          >
            <Send size={13} />
          </button>
        </div>
        <p className="text-center font-label-caps text-[9px] text-on-surface-variant/30 mt-2">
          ↵ за изпращане · Shift+↵ за нов ред · AI може да прави грешки
        </p>
      </div>
    </div>
  );
}
