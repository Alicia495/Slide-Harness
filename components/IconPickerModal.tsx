"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Search, Sparkles, X } from "lucide-react";
import { getAllIconNames, resolveIconComponent } from "@/lib/icons";
import { Modal } from "./Modal";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (iconName: string) => void;
};

const POPULAR_ICONS = [
  "Sparkles", "Rocket", "Target", "Shield", "Zap", "Check", "CircleCheck", "Award",
  "TrendingUp", "BarChart", "LineChart", "PieChart", "Activity", "Layers", "Boxes",
  "Users", "User", "Building", "Briefcase", "Folder", "FileText", "Mail", "Phone",
  "Calendar", "Clock", "Compass", "Globe", "Cpu", "Database", "Server", "Cloud",
  "Key", "Lock", "ShieldCheck", "DollarSign", "CreditCard", "ShoppingCart", "Tag",
  "ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "ChevronRight", "Repeat",
  "ThumbsUp", "Heart", "Star", "Flame", "Lightbulb", "Flag", "Bookmark", "MessageSquare",
];
const ALL_ICON_NAMES = getAllIconNames();
const POPULAR_ICON_SET = new Set(POPULAR_ICONS);
const ORDERED_ICON_NAMES = [...POPULAR_ICONS, ...ALL_ICON_NAMES.filter((name) => !POPULAR_ICON_SET.has(name))];
const SEARCH_ALIASES: Record<string, string> = {
  "trend-up": "TrendingUp",
  "trend-down": "TrendingDown",
};

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function IconPickerModal({ isOpen, onClose, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const filteredNames = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) {
      return ORDERED_ICON_NAMES;
    }
    const normalizedQuery = normalizeSearch(SEARCH_ALIASES[q] ?? q);
    return ALL_ICON_NAMES.filter((name) => normalizeSearch(name).includes(normalizedQuery));
  }, [deferredSearch]);

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} labelledBy="icon-picker-title" className="icon-modal">
        <header>
          <div>
            <Sparkles size={20} />
            <span id="icon-picker-title">アイコンを選択</span>
          </div>
          <button className="icon-button" onClick={onClose} title="閉じる" aria-label="アイコン選択を閉じる">
            <X size={18} />
          </button>
        </header>

        <div className="icon-search-bar">
          <Search size={18} color="#64748b" />
          <input
            type="text"
            aria-label="アイコン検索"
            placeholder="アイコンを英語で検索 (例: rocket, target, user, chart)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="icon-button compact" onClick={() => setSearch("")} title="クリア" aria-label="検索をクリア">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="icon-grid-scroll">
          {filteredNames.map((name) => {
            const Comp = resolveIconComponent(name);
            return (
              <button
                key={name}
                type="button"
                className="icon-card"
                onClick={() => {
                  onSelect(name);
                  onClose();
                }}
                title={name}
                aria-label={`アイコン ${name} を追加`}
              >
                <Comp size={24} />
                <span>{name}</span>
              </button>
            );
          })}
          {!filteredNames.length && (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "30px 10px", color: "#64748b", fontSize: "13px" }}>
              一致するアイコンが見つかりませんでした。
            </div>
          )}
        </div>
    </Modal>
  );
}
