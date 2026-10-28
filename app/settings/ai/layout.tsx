import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI 設定 | Slide Harness",
  description: "AI モデルの接続設定を管理します",
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
