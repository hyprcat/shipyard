import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  useId,
} from "react";

const joinClasses = (...classNames: Array<string | false | null | undefined>) =>
  classNames.filter(Boolean).join(" ");

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly tone?: "primary" | "secondary";
};

export const Button = ({
  className,
  tone = "primary",
  type = "button",
  ...props
}: ButtonProps) => (
  <button
    className={joinClasses("ui-button", `ui-button--${tone}`, className)}
    type={type}
    {...props}
  />
);

export const Card = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div className={joinClasses("ui-card", className)} {...props} />
);

export const Input = ({
  className,
  type = "text",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) => (
  <input
    className={joinClasses("ui-input", className)}
    type={type}
    {...props}
  />
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  readonly tone?: "danger" | "info" | "success" | "warning";
};

export const Badge = ({ className, tone = "info", ...props }: BadgeProps) => (
  <span
    className={joinClasses("ui-badge", `ui-badge--${tone}`, className)}
    {...props}
  />
);

export type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  readonly action?: ReactNode;
  readonly description: ReactNode;
  readonly title: ReactNode;
};

export const EmptyState = ({
  action,
  className,
  description,
  title,
  ...props
}: EmptyStateProps) => (
  <div className={joinClasses("ui-empty-state", className)} {...props}>
    <h3 className="ui-empty-state__title">{title}</h3>
    <p className="ui-empty-state__description">{description}</p>
    {action ? <div className="ui-empty-state__action">{action}</div> : null}
  </div>
);

export type TableProps = HTMLAttributes<HTMLDivElement> & {
  readonly caption?: ReactNode;
  readonly columns: readonly ReactNode[];
  readonly emptyState?: ReactNode;
  readonly rows: readonly (readonly ReactNode[])[];
};

export const Table = ({
  caption,
  className,
  columns,
  emptyState = "No rows available.",
  rows,
  ...props
}: TableProps) => (
  <div className={joinClasses("ui-table-wrap", className)} {...props}>
    <table className="ui-table">
      {caption ? <caption>{caption}</caption> : null}
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th key={`column-${index}`} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length > 0 ? (
          rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`cell-${rowIndex}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={columns.length}>{emptyState}</td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);

export type DialogProps = HTMLAttributes<HTMLDivElement> & {
  readonly actions?: ReactNode;
  readonly description?: ReactNode;
  readonly onClose?: () => void;
  readonly open: boolean;
  readonly title: ReactNode;
};

export const Dialog = ({
  actions,
  children,
  className,
  description,
  onClose,
  open,
  title,
  ...props
}: DialogProps) => {
  const titleId = useId();

  if (!open) {
    return null;
  }

  return (
    <div className="ui-dialog-backdrop" role="presentation">
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className={joinClasses("ui-dialog", className)}
        role="dialog"
        {...props}
      >
        <div className="ui-dialog__header">
          <div>
            <h3 className="ui-dialog__title" id={titleId}>
              {title}
            </h3>
            {description ? (
              <p className="ui-dialog__description">{description}</p>
            ) : null}
          </div>
          {onClose ? (
            <Button
              aria-label="Close dialog"
              onClick={onClose}
              tone="secondary"
            >
              Close
            </Button>
          ) : null}
        </div>
        <div className="ui-dialog__body">{children}</div>
        {actions ? <div className="ui-dialog__actions">{actions}</div> : null}
      </div>
    </div>
  );
};
