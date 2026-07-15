# Local upload auto-selection

## Goal

Enable prompt generation immediately after a local image upload by selecting one uploaded image automatically.

## Behavior

- After one or more local images are uploaded, the first image from that upload is the active media and is selected for generation.
- Other images in a batch remain unselected.
- Reloading the page continues to select the first session image, preserving the existing startup behavior.
- Resetting the media session and manually clearing selection continue to leave no images selected.

## Implementation

Update `handleLocalImageUpload` in `src/App.tsx` to set `selectedForGeneration` to the first uploaded media ID, matching the existing Instagram-import flow. No API or persistence changes are required.

## Validation

Update the focused layout regression test to assert that local upload sets the first media ID as the generation selection, then run the focused test suite and the project check.
