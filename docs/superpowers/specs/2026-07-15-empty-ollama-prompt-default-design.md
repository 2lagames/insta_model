# Empty Ollama Prompt Default Design

## Goal

Ensure the Connections page opens the shared Ollama generation-prompt field empty on a clean installation, instead of restoring the retired Ideogram instruction.

## Scope

- A missing `ollamaPromptInstruction` in local connection data resolves to `""`.
- An explicitly saved prompt, including the empty string, is returned unchanged.
- The retired Ideogram prompt constant is no longer used as the Connections-store fallback.
- Prompt generation continues to require a non-empty instruction, preserving its existing validation.

## Data flow

1. On first launch, no local connections file or no prompt-instruction property is present.
2. `ConnectionsStore` returns an empty `ollamaPromptInstruction`.
3. The client renders the controlled textarea with that empty value.
4. If a user saves an instruction, the store returns that saved text on later launches.

## Compatibility

Existing local connection files that already contain `ollamaPromptInstruction` retain their value. No migration writes or deletions are performed.

## Testing

Update Connections-store tests to assert an empty prompt instruction for a new or legacy file without the property, and retain coverage for saved non-empty and empty values. Run the focused test, the full test suite, and the production build.
