import { Copy, Download, FolderOpen, Plus, Save, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { Project } from "@/lib/types";

type Props = {
  name: string;
  savedAt: number | null;
  projects: Project[];
  onRename: (name: string) => void;
  onSave: () => void;
  onSaveAs: (name: string) => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
};

export function ProjectsMenu(p: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.name);

  return (
    <div className="space-y-2">
      <input
        ref={fileRef}
        type="file"
        accept=".prism,.zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) p.onImport(f);
          e.target.value = "";
        }}
      />
      <div className="flex items-center gap-2">
        {editing ? (
          <Input
            autoFocus
            value={draft}
            className="h-8"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (draft.trim()) p.onRename(draft.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <button
            className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
            title="Rename project"
            onClick={() => {
              setDraft(p.name);
              setEditing(true);
            }}
          >
            {p.name}
          </button>
        )}
        <Button size="sm" variant="secondary" onClick={p.onSave} aria-label="Save project">
          <Save className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" aria-label="Projects menu">
              <FolderOpen className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onClick={p.onNew}>
              <Plus className="size-4" /> New project
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const n = window.prompt("Save as", `${p.name} copy`);
                if (n) p.onSaveAs(n);
              }}
            >
              <Save className="size-4" /> Save as…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={p.onDuplicate}>
              <Copy className="size-4" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={p.onExport}>
              <Download className="size-4" /> Export .prism file
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" /> Import .prism file
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => {
                if (window.confirm(`Delete "${p.name}"? This cannot be undone.`)) p.onDelete();
              }}
            >
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
            {p.projects.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">Open</DropdownMenuLabel>
                {p.projects.map((pr) => (
                  <DropdownMenuItem key={pr.id} onClick={() => p.onOpen(pr.id)}>
                    <span className="truncate">{pr.name}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {new Date(pr.updatedAt).toLocaleDateString()}
                    </span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {p.savedAt ? `Saved ${new Date(p.savedAt).toLocaleTimeString()} · autosaves on this device` : "Not saved yet · autosaves on this device"}
      </p>
    </div>
  );
}
