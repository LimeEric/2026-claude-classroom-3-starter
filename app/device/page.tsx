import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DeviceApproval } from "@/components/device-approval";
import { auth } from "@/lib/auth";
import { withRedirect } from "@/lib/redirect";

export const metadata: Metadata = { title: "Approve a device · Bartholomew" };

/**
 * The verification page `ai-tutor login` points at, with `?user_code=` when the
 * user followed the full link. Signing in first comes back here with the code.
 */
export default async function DevicePage({
  searchParams,
}: PageProps<"/device">) {
  const { user_code } = await searchParams;
  const userCode = typeof user_code === "string" ? user_code : "";

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    const here = userCode
      ? `/device?${new URLSearchParams({ user_code: userCode })}`
      : "/device";
    redirect(withRedirect("/login", here));
  }

  return <DeviceApproval userCode={userCode} email={session.user.email} />;
}
