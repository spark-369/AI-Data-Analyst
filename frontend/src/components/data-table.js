"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatCell(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function DataTable({ columns, rows, maxHeight = 320 }) {
  if (!columns || columns.length === 0) {
    return <p className="text-sm text-muted-foreground">No columns.</p>;
  }

  return (
    <div className="overflow-auto rounded-md border" style={{ maxHeight }}>
      <Table>
        <TableHeader className="sticky top-0 bg-background">
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.name}>
                <span className="font-mono text-xs">{column.name}</span>
                {column.dtype ? (
                  <Badge variant="outline" className="ml-2 font-normal">
                    {column.dtype}
                  </Badge>
                ) : null}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {(rows || []).map((row, index) => (
            <TableRow key={index}>
              {columns.map((column) => (
                <TableCell key={column.name} className="max-w-[260px] truncate">
                  {formatCell(row[column.name])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
