# Optional code-intelligence indexing

gstack works fully without an index: grep and the file-only decision store are the default and never depend on a provider. Indexing is an optional enhancement that pays off in large repositories.

Once per invocation, before substantive specialist work inside a repository, run `"${GSTACK_HOME:-$HOME/.gstack}"/bin/gstack-code-intelligence suggest --json 2>/dev/null || true`. If the helper is unavailable or the result says `offer: false`, continue silently; pure judgment never requires it and the user is never nagged. The helper offers only for a large repository (tracked-file count above its threshold) with no prior decision, and an explicit decline is persisted so the question is never repeated.

When the result says `offer: true`, pause and ask via AskUserQuestion whether to index the repository, presenting exactly these options with these reasons and each option's availability from the suggest output:

- **GBrain** (recommended): semantic search over code plus federated memory across your repos; answers "where is X handled?" questions grep cannot. It sends repository content to your GBrain database, so it requires explicit per-repo consent before indexing.
- **Sourcebot**: self-hosted whole-repo regex and code search, fast on very large repos; local when the server runs on localhost, in which case nothing leaves the machine.
- **Graphify**: local tree-sitter code graph (definitions, references, structure); nothing ever leaves the machine and no consent is needed, but you install it yourself — it is never auto-installed.
- **No indexing**: gstack continues with grep and file-only state, fully supported. This choice is remembered and the question is not asked again.

Persist only the explicit choice: `"${GSTACK_HOME:-$HOME/.gstack}"/bin/gstack-code-intelligence select <gbrain|sourcebot|graphify|none>`. For a non-local provider, run `consent` for this repository only after the user explicitly approves sending its content off-machine, then `index`. Never infer a choice, never auto-install a provider, never treat an unavailable provider as forbidden (the user may set it up later), and never block or delay specialist work on indexing: if the user declines or the index is still building, proceed with grep.
