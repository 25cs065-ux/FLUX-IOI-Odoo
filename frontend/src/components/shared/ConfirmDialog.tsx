"use client";

import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfirmDialogProps {
  /**
   * Controlled open state. Manage externally so the parent can reset state
   * after the dialog closes.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;

  /** Dialog heading. */
  title: string;
  /** Explanatory body text. */
  description: string;

  /** Label for the destructive / confirm action button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;

  /**
   * Called only after the user explicitly clicks the confirm button.
   * The dialog does NOT close automatically — the parent should set
   * `open={false}` inside this callback once the action completes.
   */
  onConfirm: () => void;

  /** Show a loading spinner on the confirm button and disable both actions. */
  loading?: boolean;
  /** Disable the confirm button without showing a spinner. */
  disabled?: boolean;

  /** Use "destructive" styling on the confirm button (e.g. delete actions). */
  destructive?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  loading = false,
  disabled = false,
  destructive = false,
}: ConfirmDialogProps) {
  const isBlocked = loading || disabled;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal>
      <Dialog.Portal>
        {/* Backdrop */}
        <Dialog.Backdrop
          className={cn(
            "fixed inset-0 z-40 bg-black/50",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            "transition-opacity duration-150"
          )}
        />

        {/* Popup */}
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2",
            "rounded-xl border border-border bg-card p-6 shadow-lg",
            "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            "transition-[opacity,transform] duration-150"
          )}
        >
          {/* Title */}
          <Dialog.Title className="text-base font-semibold text-foreground">
            {title}
          </Dialog.Title>

          {/* Description */}
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            {description}
          </Dialog.Description>

          {/* Actions */}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {/* Cancel — closes dialog */}
            <Dialog.Close
              render={
                <Button variant="outline" disabled={isBlocked}>
                  {cancelLabel}
                </Button>
              }
            />

            {/* Confirm */}
            <Button
              variant={destructive ? "destructive" : "default"}
              disabled={isBlocked}
              onClick={onConfirm}
              aria-busy={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Spinner />
                  {confirmLabel}
                </span>
              ) : (
                confirmLabel
              )}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Internal spinner — no extra dependency needed
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <svg
      className="size-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}
