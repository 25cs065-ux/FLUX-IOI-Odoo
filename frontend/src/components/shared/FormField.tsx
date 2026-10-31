import { Field } from "@base-ui/react/field";
import { cn } from "cn";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FormFieldProps {
  /** Field label text. */
  label: string;
  /** HTML id of the associated input. Auto-linked when using `Field.Control`. */
  htmlFor?: string;
  /** Shows a red asterisk after the label. Does NOT add required to the input. */
  required?: boolean;
  /**
   * Validation error message. Passing a non-empty string marks the field
   * as invalid and shows the message below the input.
   *
   * Works directly with React Hook Form:
   * ```tsx
   * error={errors.email?.message}
   * ```
   */
  error?: string;
  /** Optional helper text shown below the input when there is no error. */
  description?: string;
  /** The input / select / textarea to render inside the field. */
  children: React.ReactNode;
  /** Additional class on the outer wrapper. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
//
// Uses @base-ui/react Field primitives so that Label, Description and Error
// are wired to the control via ARIA automatically. The Field.Root `invalid`
// prop drives `aria-invalid` on the control which React Hook Form reads.
// ---------------------------------------------------------------------------

export function FormField({
  label,
  htmlFor,
  required = false,
  error,
  description,
  children,
  className,
}: FormFieldProps) {
  const hasError = Boolean(error);

  return (
    <Field.Root
      invalid={hasError}
      className={cn("flex flex-col gap-1.5", className)}
    >
      {/* Label */}
      <Field.Label
        className="text-sm font-medium text-foreground leading-none"
        {...(htmlFor ? { htmlFor } : {})}
      >
        {label}
        {required && (
          <span
            aria-hidden="true"
            className="ml-0.5 text-destructive"
          >
            *
          </span>
        )}
      </Field.Label>

      {/* Input slot */}
      {children}

      {/* Error — shown when there is an error */}
      {hasError && (
        <Field.Error
          className="text-xs text-destructive leading-tight"
          match={true}
        >
          {error}
        </Field.Error>
      )}

      {/* Description — shown when there is no error */}
      {!hasError && description && (
        <Field.Description className="text-xs text-muted-foreground leading-tight">
          {description}
        </Field.Description>
      )}
    </Field.Root>
  );
}
