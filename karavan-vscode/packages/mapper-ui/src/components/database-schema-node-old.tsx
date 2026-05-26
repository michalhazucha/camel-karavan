
import {
  BaseNode,
  BaseNodeContent,
  BaseNodeHeader,
} from "@/components/base-node";
import { TableBody, TableCell, TableRow } from "@/components/ui/table";
import type { ReactNode } from "react";



/* DATABASE SCHEMA NODE HEADER ------------------------------------------------ */
export const DatabaseSchemaNodeHeader = ({
  children,
}: {
  children?: React.ReactNode;
}) => {
  return (
    <BaseNodeHeader className="rounded-tl-md rounded-tr-md bg-secondary p-2 text-center text-sm text-muted-foreground">
      <h2>{children}</h2>
    </BaseNodeHeader>
  );
};

/* DATABASE SCHEMA NODE BODY -------------------------------------------------- */
/**
 * A container for the database schema node body that wraps the table.
 */
export type DatabaseSchemaNodeBodyProps = {
  children?: ReactNode;
};

export const DatabaseSchemaNodeBody = ({
  children,
}: DatabaseSchemaNodeBodyProps) => {
  return (
    <BaseNodeContent className="p-0">
      <table className="border-spacing-10 overflow-visible">
        <TableBody>{children}</TableBody>
      </table>
    </BaseNodeContent>
  );
};

/* DATABASE SCHEMA TABLE ROW -------------------------------------------------- */
/**
 * A wrapper for individual table rows in the database schema node.
 */

export type DatabaseSchemaTableRowProps = {
  children: ReactNode;
  className?: string;
};

export const DatabaseSchemaTableRow = ({
  children,
  className,
}: DatabaseSchemaTableRowProps) => {
  return (
    <TableRow className={`relative text-xs ${className || ""}`}>
      {children}
    </TableRow>
  );
};

export type DatabaseSchemaTableCellProps = {
  className?: string;
  children?: ReactNode;
};

export const DatabaseSchemaTableCell = ({
  className,
  children,
}: DatabaseSchemaTableCellProps) => {
  return <TableCell className={className}>{children}</TableCell>;
};

export type DatabaseSchemaNodeProps = {
  className?: string;
  children?: ReactNode;
};

export const DatabaseSchemaNode = ({
  className,
  children,
}: DatabaseSchemaNodeProps) => {
  return <BaseNode className={className}>{children}</BaseNode>;
};
