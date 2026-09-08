import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import JSZip from "jszip";

import type { Project } from "./types";

interface PrismDB extends DBSchema {
  projects: { key: string; value: Project; indexes: { updatedAt: number } };
  blobs: { key: string; value: { id: string; projectId: string; blob: Blob; name: string; type: string } };
}

let dbp: Promise<IDBPDatabase<PrismDB>> | null = null;
const db = () =>
  (dbp ??= openDB<PrismDB>("prism", 1, {
    upgrade(d) {
      const p = d.createObjectStore("projects", { keyPath: "id" });
      p.createIndex("updatedAt", "updatedAt");
      d.createObjectStore("blobs", { keyPath: "id" });
    },
  }));

export type BlobMap = Map<string, Blob>;

export const LAST_KEY = "prism:lastProject";

export async function listProjects(): Promise<Project[]> {
  const all = await (await db()).getAll("projects");
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveProject(project: Project, blobs: BlobMap) {
  const d = await db();
  const tx = d.transaction(["projects", "blobs"], "readwrite");
  await tx.objectStore("projects").put(project);
  const store = tx.objectStore("blobs");
  const existing = (await store.getAll()).filter((b) => b.projectId === project.id);
  const wanted = new Set([...project.media.map((m) => m.id), ...project.sounds.map((s) => s.id)]);
  for (const e of existing) if (!wanted.has(e.id)) await store.delete(e.id);
  for (const id of wanted) {
    const blob = blobs.get(id);
    if (blob && !existing.some((e) => e.id === id)) {
      await store.put({ id, projectId: project.id, blob, name: id, type: blob.type });
    }
  }
  await tx.done;
  localStorage.setItem(LAST_KEY, project.id);
}

export async function loadProject(id: string): Promise<{ project: Project; blobs: BlobMap } | null> {
  const d = await db();
  const project = await d.get("projects", id);
  if (!project) return null;
  const blobs: BlobMap = new Map();
  for (const b of await d.getAll("blobs")) if (b.projectId === id) blobs.set(b.id, b.blob);
  return { project, blobs };
}

export async function deleteProject(id: string) {
  const d = await db();
  const tx = d.transaction(["projects", "blobs"], "readwrite");
  await tx.objectStore("projects").delete(id);
  const store = tx.objectStore("blobs");
  for (const b of await store.getAll()) if (b.projectId === id) await store.delete(b.id);
  await tx.done;
  if (localStorage.getItem(LAST_KEY) === id) localStorage.removeItem(LAST_KEY);
}

export async function exportProject(project: Project, blobs: BlobMap): Promise<Blob> {
  const zip = new JSZip();
  zip.file("project.json", JSON.stringify(project));
  const folder = zip.folder("blobs")!;
  for (const [id, blob] of blobs) folder.file(id, blob);
  return zip.generateAsync({ type: "blob" });
}

export async function importProject(file: Blob): Promise<{ project: Project; blobs: BlobMap }> {
  const zip = await JSZip.loadAsync(file);
  const json = await zip.file("project.json")?.async("string");
  if (!json) throw new Error("Not a Prism project file");
  const project = JSON.parse(json) as Project;
  const blobs: BlobMap = new Map();
  const folder = zip.folder("blobs");
  if (folder) {
    const entries: Promise<void>[] = [];
    folder.forEach((path, f) => {
      entries.push(f.async("blob").then((b) => void blobs.set(path, b)));
    });
    await Promise.all(entries);
  }
  // give it a fresh id so it never clashes with an existing one
  project.id = `p${Date.now()}`;
  return { project, blobs };
}
