"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { AuthCard } from "@/components/ui/auth-card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { authClient } from "@/lib/auth-client";

type Decision = "approve" | "deny";

/** Better Auth's device-flow error codes, in the interface's voice. */
function describe(error: { error?: string; message?: string }): string {
  switch (error.error) {
    case "invalid_request":
      return "That code doesn't match a waiting login. Check it against the one in your terminal.";
    case "expired_token":
      return "That code has expired. Run ai-tutor login again for a new one.";
    case "access_denied":
      return "Another account has already claimed that code.";
    default:
      return error.message ?? "The code could not be checked. Try again.";
  }
}

export function DeviceApproval({
  userCode,
  email,
}: {
  userCode: string;
  email: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Decision | null>(null);
  const [outcome, setOutcome] = useState<Decision | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { submitter } = event.nativeEvent as SubmitEvent;
    const form = new FormData(event.currentTarget, submitter);
    const code = String(form.get("code")).trim();
    const decision: Decision =
      form.get("decision") === "deny" ? "deny" : "approve";
    setError(null);
    setPending(decision);

    // Looking the code up while signed in is what binds it to this account;
    // approve and deny both refuse a code that is not bound to the caller.
    const verified = await authClient.device({ query: { user_code: code } });
    const settled =
      verified.data && verified.data.status !== "pending"
        ? "That code has already been used. Run ai-tutor login again for a new one."
        : null;
    if (verified.error || settled) {
      setError(settled ?? describe(verified.error ?? {}));
      setPending(null);
      return;
    }

    const result =
      decision === "approve"
        ? await authClient.device.approve({ userCode: code })
        : await authClient.device.deny({ userCode: code });
    if (result.error) {
      setError(describe(result.error));
      setPending(null);
      return;
    }
    setOutcome(decision);
  }

  const footer = (
    <>
      Signed in as {email}.{" "}
      <Link href="/" className="font-semibold text-accent hover:underline">
        Back to Bartholomew
      </Link>
    </>
  );

  if (outcome) {
    return (
      <AuthCard
        title={outcome === "approve" ? "Device approved" : "Request denied"}
        footer={footer}
      >
        <p className="text-base text-ink">
          {outcome === "approve"
            ? "The CLI signs in on its next check. You can close this tab and return to your terminal."
            : "The CLI was refused and holds no access. If you did start it, run ai-tutor login again."}
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Approve a device" onSubmit={onSubmit} footer={footer}>
      <p className="text-base text-ink">
        The ai-tutor CLI is asking to use your list. Approve only a code you
        started yourself, and check that it matches the one in your terminal.
      </p>
      <Field
        id="code"
        label="Code"
        defaultValue={userCode}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        required
      />
      <FormError message={error} />
      <div className="flex gap-3">
        <Button
          type="submit"
          name="decision"
          value="approve"
          disabled={pending !== null}
          className="flex-1"
        >
          {pending === "approve" ? "Approving…" : "Approve"}
        </Button>
        <Button
          type="submit"
          name="decision"
          value="deny"
          variant="secondary"
          disabled={pending !== null}
          className="flex-1"
        >
          {pending === "deny" ? "Denying…" : "Deny"}
        </Button>
      </div>
    </AuthCard>
  );
}
