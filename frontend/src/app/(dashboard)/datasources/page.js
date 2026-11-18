"use client";

import { useEffect, useState } from "react";
import { Database, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";

const DB_TYPES = [
  { value: "postgresql", label: "PostgreSQL", defaultPort: "5432" },
  { value: "mysql", label: "MySQL", defaultPort: "3306" },
  { value: "mssql", label: "SQL Server", defaultPort: "1433" },
];

const EMPTY_FORM = {
  name: "",
  db_type: "postgresql",
  host: "",
  port: "5432",
  database: "",
  username: "",
  password: "",
  ssl_enabled: false,
};

export default function DataSourcesPage() {
  const [datasources, setDatasources] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [schemaFor, setSchemaFor] = useState(null);
  const [schema, setSchema] = useState(null);
  const [schemaLoading, setSchemaLoading] = useState(false);

  async function load() {
    try {
      setDatasources(await api.listDatasources());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load data sources");
    }
  }

  useEffect(() => {
    load();
  }, []);

  function update(field, value) {
    setForm((prev) => {
      if (field === "db_type") {
        const meta = DB_TYPES.find((item) => item.value === value);
        return { ...prev, db_type: value, port: meta ? meta.defaultPort : prev.port };
      }
      return { ...prev, [field]: value };
    });
  }

  async function handleTest() {
    setTesting(true);
    try {
      const result = await api.testDatasource({
        db_type: form.db_type,
        host: form.host,
        port: Number(form.port),
        database: form.database,
        username: form.username,
        password: form.password,
        ssl_enabled: form.ssl_enabled,
      });
      if (result.ok) {
        toast.success(`${result.message} (${result.latency_ms} ms)`);
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Connection test failed");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.createDatasource({
        name: form.name,
        db_type: form.db_type,
        host: form.host,
        port: Number(form.port),
        database: form.database,
        username: form.username,
        password: form.password,
        ssl_enabled: form.ssl_enabled,
      });
      toast.success("Data source connected");
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save data source");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this data source? Chat history is kept.")) return;
    try {
      await api.deleteDatasource(id);
      toast.success("Data source deleted");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete");
    }
  }

  async function openSchema(datasource) {
    setSchemaFor(datasource);
    setSchema(null);
    setSchemaLoading(true);
    try {
      setSchema(await api.getSchema(datasource.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load schema");
    } finally {
      setSchemaLoading(false);
    }
  }

  async function refreshSchema() {
    if (!schemaFor) return;
    setSchemaLoading(true);
    try {
      setSchema(await api.getSchema(schemaFor.id));
      toast.success("Schema refreshed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh schema");
    } finally {
      setSchemaLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <PageHeader
        title="Data Sources"
        description="Enterprise databases the analyst can explore (read-only)."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> Add data source
          </Button>
        }
      />

      {!datasources ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((index) => (
            <Card key={index}>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Loading…
              </CardContent>
            </Card>
          ))}
        </div>
      ) : datasources.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Database className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No data sources yet. Add your first database to start asking questions.
            </p>
            <Button variant="outline" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" /> Add data source
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {datasources.map((item) => (
            <Card key={item.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Database className="h-4 w-4" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{item.name}</CardTitle>
                      <CardDescription className="font-mono text-xs">
                        {item.host}:{item.port}/{item.database}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="secondary">{item.db_type}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => openSchema(item)}>
                  View schema
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleDelete(item.id)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add data source</DialogTitle>
            <DialogDescription>
              The connection is tested before it is saved.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleSave}>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  required
                  placeholder="Sales warehouse"
                  value={form.name}
                  onChange={(event) => update("name", event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.db_type} onValueChange={(value) => update("db_type", value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DB_TYPES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="port">Port</Label>
                <Input
                  id="port"
                  required
                  type="number"
                  value={form.port}
                  onChange={(event) => update("port", event.target.value)}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="host">Host</Label>
                <Input
                  id="host"
                  required
                  placeholder="demo-db"
                  value={form.host}
                  onChange={(event) => update("host", event.target.value)}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="database">Database</Label>
                <Input
                  id="database"
                  required
                  placeholder="enterprise"
                  value={form.database}
                  onChange={(event) => update("database", event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  required
                  autoComplete="off"
                  value={form.username}
                  onChange={(event) => update("username", event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  required
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) => update("password", event.target.value)}
                />
              </div>
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.ssl_enabled}
                  onChange={(event) => update("ssl_enabled", event.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                Use SSL/TLS (PostgreSQL)
              </label>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Test connection
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>


      <Dialog
        open={Boolean(schemaFor)}
        onOpenChange={(open) => {
          if (!open) setSchemaFor(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Schema — {schemaFor?.name}</DialogTitle>
            <DialogDescription>Tables and columns the analyst can use.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={refreshSchema} disabled={schemaLoading}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
          {schemaLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading schema…
            </div>
          ) : schema ? (
            <div className="max-h-[50vh] space-y-1.5 overflow-y-auto pr-2">
              {schema.tables.map((table) => (
                <details key={table.name} className="rounded-md border px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium">
                    <span className="font-mono">{table.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {table.columns.length} columns
                    </span>
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {table.columns.map((column) => (
                      <li key={column.name} className="flex items-center gap-2 text-xs">
                        <span className="font-mono">{column.name}</span>
                        <span className="text-muted-foreground">{column.dtype}</span>
                        {column.primary_key ? <Badge variant="secondary">PK</Badge> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
              {schema.tables.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">No tables found.</p>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>


    </div>
  );

}
