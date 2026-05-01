"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Target, Sparkles, X } from "lucide-react";

interface Props {
  open: boolean;
  loading: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}

export default function CreateStrategyModal({
  open,
  loading,
  onClose,
  onCreate,
}: Props) {
  const [name, setName] = useState("");

  if (!open) return null;

  const handleSubmit = () => {
    if (!name.trim()) return;
    onCreate(name);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-background/80 animate-in fade-in duration-300"
        onClick={onClose}
      />

      <div className="relative w-full max-w-[440px] bg-card border border-border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute right-6 top-6 p-1 text-muted hover:text-foreground hover:bg-secondary transition-colors z-20"
        >
          <X size={18} />
        </button>

        <div className="p-8">
          {/* Header Section */}
          <div className="flex flex-col items-center text-center space-y-3 mb-8">
            <div className="w-14 h-14 bg-accent/10 border border-accent/30 flex items-center justify-center">
              <Target className="w-7 h-7 text-accent" />
            </div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight">
              New Strategy
            </h2>
            <p className="text-sm text-muted font-medium leading-relaxed">
              Define a name for your automated execution workflow.
            </p>
          </div>

          {/* Input Section */}
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-accent uppercase tracking-[0.2em] ml-1">
                Strategy Identifier
              </label>
              <div className="relative group">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  placeholder="e.g. Yield Farming V1"
                  className="w-full bg-input border border-border focus:border-accent
                             p-4 text-foreground font-bold text-lg placeholder:text-muted transition-colors outline-none"
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-focus-within:opacity-40 transition-opacity pointer-events-none">
                  <Sparkles size={18} className="text-accent" />
                </div>
              </div>
            </div>

            <Button
              onClick={handleSubmit}
              disabled={loading || !name.trim()}
              className="w-full h-14 bg-accent hover:bg-accent/90 text-white font-bold transition-colors"
            >
              {loading ? (
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white animate-spin" />
                  <span className="tracking-widest uppercase text-sm font-bold">
                    Creating...
                  </span>
                </div>
              ) : (
                <span className="tracking-widest uppercase text-sm font-bold">
                  Create Strategy
                </span>
              )}
            </Button>
          </div>
        </div>

        <div className="h-px w-full bg-accent/20" />
      </div>
    </div>
  );
}
