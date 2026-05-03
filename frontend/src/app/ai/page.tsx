'use client';
import { useState, useRef, useEffect } from 'react';
import { api } from '@/lib/api';
import { Send, Bot, User, Loader2 } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const WELCOME: Message = {
  role: 'assistant',
  content: 'Здравей! Аз съм AI асистентът на Studio Botema. Мога да те помогна с финансови справки, анализи и въпроси за бизнеса.',
};

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
    const history = messages.slice(1); // skip welcome for history
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const { data } = await api.post('/ai/chat', {
        message: text,
        history: history.map(m => ({ role: m.role, content: m.content })),
      });
      const assistantMsg: Message = {
        role: 'assistant',
        content: data.reply || data.message || data.content || 'Нямам отговор в момента.',
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      const errMsg: Message = {
        role: 'assistant',
        content: '⚠️ Грешка при свързване с AI. Моля, опитайте отново.',
      };
      setMessages(prev => [...prev, errMsg]);
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
      <div className="flex-shrink-0 px-6 py-4 border-b border-[#27272a] flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-[rgba(10,132,255,0.15)] border border-[rgba(10,132,255,0.2)] flex items-center justify-center">
          <Bot size={18} className="text-[#0a84ff]" />
        </div>
        <div>
          <h1 className="text-base font-bold text-white">AI Асистент</h1>
          <p className="text-xs text-[#52525b]">Studio Botema ERP · GPT-4</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-[rgba(10,132,255,0.15)] border border-[rgba(10,132,255,0.2)] flex items-center justify-center mt-0.5">
                <Bot size={15} className="text-[#0a84ff]" />
              </div>
            )}
            <div
              className={`max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-[#0a84ff] text-white rounded-br-md'
                  : 'bg-[#1d1d1f] text-[#e4e4e7] border border-[#27272a] rounded-bl-md'
              }`}
            >
              {msg.content}
            </div>
            {msg.role === 'user' && (
              <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-[#27272a] flex items-center justify-center mt-0.5">
                <User size={15} className="text-[#a1a1aa]" />
              </div>
            )}
          </div>
        ))}

        {/* Loading */}
        {loading && (
          <div className="flex gap-3 justify-start">
            <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-[rgba(10,132,255,0.15)] border border-[rgba(10,132,255,0.2)] flex items-center justify-center">
              <Bot size={15} className="text-[#0a84ff]" />
            </div>
            <div className="bg-[#1d1d1f] border border-[#27272a] rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
              <Loader2 size={14} className="text-[#0a84ff] animate-spin" />
              <span className="text-sm text-[#71717a]">Мисля...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-4 py-4 border-t border-[#27272a]">
        <div className="flex gap-3 items-end bg-[#1d1d1f] border border-[#27272a] rounded-2xl px-4 py-3 focus-within:border-[#0a84ff] transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Задай въпрос... (Enter за изпращане, Shift+Enter за нов ред)"
            rows={1}
            className="flex-1 bg-transparent text-[#e4e4e7] text-sm outline-none resize-none placeholder:text-[#52525b] max-h-32"
            style={{ lineHeight: '1.5' }}
            disabled={loading}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="flex-shrink-0 w-8 h-8 rounded-xl bg-[#0a84ff] flex items-center justify-center
              hover:bg-blue-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send size={14} className="text-white" />
          </button>
        </div>
        <p className="text-center text-xs text-[#3f3f46] mt-2">
          AI може да прави грешки. Проверявай важна финансова информация.
        </p>
      </div>
    </div>
  );
}
