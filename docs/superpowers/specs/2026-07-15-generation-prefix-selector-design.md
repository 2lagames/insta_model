# Generation Prefix Selector Design

## Goal

Add a persisted selectable prefix to Generation workspace and combine it with every Ollama-generated prompt.

## Interface

Generation workspace contains a full-width select and adjacent pencil button. The select always begins with `Не выбрано`; choosing it keeps the generated text unchanged. The pencil opens a modal editor whose nonempty lines use `Название;Текст`. The part before the first semicolon is shown in the select and the remaining text is the selected prefix.

## Persistence and generation

The raw editor text and selected prefix name are stored in `data/connections.local.json`. Invalid nonempty lines without a semicolon prevent saving and explain the required format. After Ollama generates `Image`, a selected prefix produces `Текст, Image`; `Не выбрано` produces `Image`. The resulting value becomes the original prompt document and retains all existing edit-history controls.

## Tests

Unit tests cover parsing, invalid lines, no-selection, selected prefix composition, and persisted connection settings. Client layout tests cover the select, pencil, and editor controls.
