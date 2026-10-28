import React from "react";
import { icons } from "lucide-react";

export type LucideIconComponent = React.ComponentType<{
  color?: string;
  size?: number | string;
  strokeWidth?: number;
  className?: string;
}>;

const iconMap = new Map<string, LucideIconComponent>();
const allNames: string[] = [];

for (const [key, comp] of Object.entries(icons)) {
  const component = comp as unknown as LucideIconComponent;
  iconMap.set(key.toLowerCase(), component);
  const kebab = key.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();
  iconMap.set(kebab, component);
  allNames.push(key);
}

// Convenient aliases for common requests
if (icons.CircleCheck) iconMap.set("checkcircle", icons.CircleCheck as unknown as LucideIconComponent);
if (icons.CircleAlert) iconMap.set("alertcircle", icons.CircleAlert as unknown as LucideIconComponent);
if (icons.CircleHelp) iconMap.set("helpcircle", icons.CircleHelp as unknown as LucideIconComponent);

export function getAllIconNames(): string[] {
  return allNames;
}

export function resolveIconComponent(name: string): LucideIconComponent {
  if (!name) return (icons.Sparkles || icons.Circle) as unknown as LucideIconComponent;
  const normalized = name.trim().toLowerCase();
  const found = iconMap.get(normalized) || iconMap.get(normalized.replace(/[^a-z0-9]/g, ""));
  if (found) return found;
  return (icons.Sparkles || icons.Circle) as unknown as LucideIconComponent;
}
