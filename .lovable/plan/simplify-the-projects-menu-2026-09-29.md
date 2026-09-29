# Simplify the Projects menu

## Changes
- Remove the old "Save as…" item (the one that made a copy on this device).
- Remove "Duplicate".
- Rename "Export .prism file" to **Save as…**. It downloads the show as a `.prism` file, the same way export works today.
- Rename "Import .prism file" to **Open project…**. It picks a `.prism` file and opens it, the same way import works today.
- Keep these as they are: New project, the Save button (autosave on this device), Delete, and the list of recent projects on this device.

New menu order:
```text
New project
Save as…        (download .prism)
Open project…   (choose .prism)
Delete
---
Recent (on this device)
```

## Technical details
- `src/components/ProjectsMenu.tsx`: remove the `onSaveAs` and `onDuplicate` props and their menu items, and change the labels and icons of the export and import items. Rename the list label from "Open" to "Recent".
- `src/routes/index.tsx`: stop passing `onSaveAs`/`onDuplicate` and delete the handlers that are no longer used.
