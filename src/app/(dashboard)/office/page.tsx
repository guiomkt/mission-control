import { redirect } from "next/navigation";

/**
 * The 3D Office feature was removed in V1 hardening. Any leftover cached
 * link in a browser (RSC prefetch, etc.) used to hit a 404 here; now we
 * just bounce back to the dashboard so navigating to a stale URL stays
 * graceful.
 */
export default function OfficeRedirect(): never {
  redirect("/");
}
