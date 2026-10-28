import { icons, type LucideIcon } from "lucide-react";

type ElementNode = {
  type: string | ((props: Record<string, unknown>) => unknown) | { render: (props: Record<string, unknown>, ref: null) => unknown };
  props: Record<string, unknown>;
};

const iconMap = new Map<string, LucideIcon>();

for (const [name, component] of Object.entries(icons)) {
  iconMap.set(name.toLowerCase(), component);
  iconMap.set(name.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase(), component);
}

function resolveIcon(name: string): LucideIcon {
  const normalized = name.trim().toLowerCase();
  return iconMap.get(normalized) ?? iconMap.get(normalized.replace(/[^a-z0-9]/g, "")) ?? icons.Sparkles;
}

function escapeXml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}

function attributeName(name: string): string {
  return name === "viewBox" ? name : name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

function isElementNode(value: unknown): value is ElementNode {
  return typeof value === "object" && value !== null && "type" in value && "props" in value;
}

function serializeNode(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return escapeXml(node);
  if (Array.isArray(node)) return node.map(serializeNode).join("");
  if (!isElementNode(node)) return "";

  if (typeof node.type === "function") return serializeNode(node.type(node.props));
  if (typeof node.type === "object" && "render" in node.type) return serializeNode(node.type.render(node.props, null));

  const attributes = Object.entries(node.props)
    .filter(([name, value]) => !["children", "className", "iconNode", "ref"].includes(name) && value !== undefined && value !== null && value !== false)
    .map(([name, value]) => value === true ? attributeName(name) : `${attributeName(name)}="${escapeXml(value)}"`)
    .join(" ");
  const children = serializeNode(node.props.children);
  return `<${node.type}${attributes ? ` ${attributes}` : ""}>${children}</${node.type}>`;
}

export function getIconSvgDataUri(name: string, color: string, size = 64): string {
  const component = resolveIcon(name) as unknown as { render: (props: Record<string, unknown>, ref: null) => unknown };
  const tree = component.render({ color, size, strokeWidth: 2 }, null);
  const svg = serializeNode(tree);
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
