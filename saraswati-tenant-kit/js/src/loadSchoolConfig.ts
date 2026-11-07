import type { SchoolConfig } from "./types";

export async function loadSchoolConfig(host: string): Promise<SchoolConfig> {
  const trimmed = host.trim();
  if (!trimmed || trimmed.includes("/")) {
    throw new Error("School host is missing.");
  }
  const proto = process.env.SARASWATI_PUBLIC_PROTO ?? "https";
  const response = await fetch(`${proto}://${trimmed}/public/tenant-config`, {
    cache: "no-store",
  });
  if (response.status === 404) {
    throw new Error(`Unknown school for host ${trimmed}`);
  }
  if (!response.ok) {
    throw new Error(`School config failed with status ${response.status}`);
  }
  const body = (await response.json()) as SchoolConfig;
  if (!body.tenantId || !body.schoolName) {
    throw new Error("School config is missing tenantId or schoolName.");
  }
  return body;
}
