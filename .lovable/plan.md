# Allow custom surface edges outside the base square

## Changes
- Stop limiting added edge points to the original four-corner square when they are dragged.
- Keep the four main warp corners constrained to the display area as they are now.
- Expand the rendered surface layer to include outward points, then apply the custom polygon cut-out so projected content remains visible beyond the original square.
- Preserve outward point coordinates when saving, exporting, importing, and reopening projects.

## Verification
- Add an edge point, drag it beyond each side of the original surface, and confirm it remains under the pointer.
- Confirm the extended area renders in Stage and projector output while the custom polygon still clips correctly.
- Confirm ordinary four-corner mapping and inward custom shapes still behave as before.
