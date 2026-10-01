"use client";

import { useActionState, useState } from "react";
import type { ReactNode } from "react";
import { Alert } from "@/ui/alert";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { SubmitButton } from "@/ui/submit-button";
import { completeBackgroundCheckAction } from "./actions";

export function CompleteBackgroundCheck({
  caregiverId,
}: {
  readonly caregiverId: string;
}): ReactNode {
  const [state, formAction] = useActionState(completeBackgroundCheckAction, {});
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="primary" size="md" onClick={() => setOpen(true)}>
        Background check completed
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Background check completed?"
      >
        <form action={formAction} className="flex flex-col gap-4">
          {state.error ? (
            <Alert tone="danger" live>
              {state.error}
            </Alert>
          ) : null}
          <p>
            This records the background check as clear and marks the caregiver
            ready for AlayaCare.
          </p>
          <input type="hidden" name="caregiverId" value={caregiverId} />
          <div className="flex justify-end">
            <SubmitButton variant="primary" pendingLabel="Saving…">
              Confirm
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
