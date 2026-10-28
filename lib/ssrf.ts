import { DocumentError } from "./operations";

// サーバー側 outward fetch の hostname ベース SSRF ガード。
// DNS 解決は行わず、リテラルな localhost / private / link-local / multicast /
// unspecified アドレスの直接指定だけを拒否する（DNS rebinding 対策は対象外）。
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV4_MAPPED = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;

function restrictedIpv4(a: number, b: number, _c: number, _d: number): boolean {
  return (
    a === 0 || // unspecified (0.0.0.0/8)
    a === 10 || // private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    a >= 224 // multicast / reserved
  );
}

export function isRestrictedHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const v4 = IPV4.exec(host);
  if (v4) return restrictedIpv4(Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4]));
  const mapped = IPV4_MAPPED.exec(host);
  if (mapped) {
    const parts = mapped[1].split(".").map(Number);
    return restrictedIpv4(parts[0], parts[1], parts[2], parts[3]);
  }
  if (host.includes(":")) {
    if (host === "::1" || host === "::") return true;
    const head = host.split(":")[0] ?? "";
    const first = head === "" ? 0 : parseInt(head, 16);
    if (Number.isNaN(first)) return true;
    if (first >= 0xff00) return true; // multicast ff00::/12
    if (first >= 0xfc00 && first <= 0xfdff) return true; // unique local fc00::/7
    if (first >= 0xfe80 && first <= 0xfebf) return true; // link-local fe80::/10
  }
  return false;
}

export function assertPublicUrl(url: URL): void {
  if (isRestrictedHost(url.hostname)) {
    throw new DocumentError("ローカル・プライベート・リンクローカル・マルチキャスト・未指定アドレスへの直接接続は許可されていません。LAN 接続は保存済み設定を経由してください。", 400);
  }
}
