"use client";

import { useState } from "react";

interface JsonEditorProps {
  value: unknown;
  onChange: (value: unknown) => void;
  height?: string;
  placeholder?: string;
}

export function JsonEditor({ value, onChange, height = "200px", placeholder }: JsonEditorProps) {
  const [text, setText] = useState(() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  });
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    try {
      if (newText.trim() === "") {
        onChange(undefined);
        setError(null);
        return;
      }
      const parsed = JSON.parse(newText);
      onChange(parsed);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const format = () => {
    try {
      const parsed = JSON.parse(text);
      setText(JSON.stringify(parsed, null, 2));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="relative">
      <textarea
        value={text}
        onChange={handleChange}
        placeholder={placeholder}
        spellCheck={false}
        className="code-block w-full resize-none rounded-lg border border-dex-border bg-dex-surface p-3 text-dex-text focus:border-dex-accent focus:outline-none"
        style={{ height, fontFamily: "ui-monospace, monospace" }}
      />
      <div className="flex items-center justify-between mt-1 px-1">
        {error ? (
          <span className="text-xs text-dex-danger">{error}</span>
        ) : (
          <span className="text-xs text-dex-muted">valid JSON</span>
        )}
        <button
          onClick={format}
          className="text-xs text-dex-muted hover:text-dex-accent transition-colors"
        >
          Format
        </button>
      </div>
    </div>
  );
}
