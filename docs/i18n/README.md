# Bilingual documentation

English | [中文](README.zh.md)

This repo's documentation is read by people and agents, so every document in scope is maintained in English and Simplified Chinese. This page defines the pairing contract, checks, scope, and exclusions; [translation-rules.md](translation-rules.md) defines how to translate; [terminology.md](terminology.md) is the terminology source of truth. Routine agent work follows the lightweight path in the root [AGENTS.md](../../AGENTS.md); the extended [.agents/skills/dsh-translate-docs](../../.agents/skills/dsh-translate-docs/SKILL.md) workflow is available only through explicit user invocation.

## The pairing contract

- **Both languages carry equal authority.** A document may be authored and reviewed in either language first, and the counterpart is translated from it. Neither file outranks the other; what binds them is that they must say the same thing.
- **A pair is three sibling files.** The English `foo.md`, the Chinese `foo.zh.md`, and a consistency record `foo.i18n.yaml`, all in the same directory. No locale directories, no separate translation repo, no interleaved bilingual files. Pairs merge whole: a PR never lands one language without the other two files.
- **The consistency record.** `foo.i18n.yaml` holds the full git blob hash of each side as of the last time the two were confirmed to say the same thing:

  ```yaml
  foo.md: 3f786850e387550fdab836ed7e6dc881de23001b
  foo.zh.md: 89e6c98d92887913cadf06b2adb97f26cde4849b
  ```

  Blob hashes, not commit hashes, so the record is computable for files edited in the same PR (`git hash-object foo.md`) and consistency is a pure content comparison. `--write` stores those snapshots in the local Git object database before recording them, including uncommitted working-tree contents. The recorded hashes therefore recover the exact last-confirmed text of either side, so an out-of-sync pair is updated by patching the counterpart minimally against the edited side's diff — never by re-translating whole files. After bringing the pair back in line, `pnpm run verify-translation-pairing --write <pair>` re-records both hashes; that yaml diff is the reviewable act of confirming consistency, which is why `--write` requires naming the pairs you confirmed (`--write --all` is the explicit corpus-wide form).
- **Language switcher.** The Chinese file always links back immediately after its H1 heading with `[English](foo.md) | 中文`. An authored English file reciprocates there with `English | [中文](foo.zh.md)`.
- **Structure mirrors the counterpart.** Heading depths and order, list kinds, ordered-list starts, list item counts, table row and column counts, link targets, and verbatim code blocks match one to one across the pair — see [translation-rules.md](translation-rules.md) for the full preservation rules.

## The gate: verify-translation-pairing

`pnpm run verify-translation-pairing` enforces the contract mechanically; CI runs it on every PR:

1. Every document in scope has a complete pair.
2. Every pair artifact that exists at all is complete and consistent: all three files present, each side's current blob hash equals the recorded one (editing either side without re-confirming the pair goes red), both sides carry their language switchers, and the structural signatures match in order — heading depths, verbatim code blocks (info string and content), table row and column counts, list kinds, ordered-list starts, item counts, and every link target apart from the switcher.
3. Files listed as `excluded` have no `.zh.md` and no `.i18n.yaml` at all. Frozen Agent Notes under `.agents/notes/archived/` are outside this evolving gate; their dedicated verifier requires and seals the complete existing triplet instead.

`pnpm run verify-translation-pairing --list` prints the current pairing state of every document in scope — missing, out-of-sync, or ok. It never fails; `missing` and `out-of-sync` rows identify violations that the normal check rejects.

`pnpm run verify-translation-pairing <pair...>` checks just the named pairs — any of a pair's three files (or its bare stem) names it — so an update loop verifies its own pair in seconds instead of re-scanning the corpus. The no-argument corpus-wide form is what CI runs; a scoped green never substitutes for it at PR level.

The practical rule this gate creates: **when a PR edits either side of a paired document, the same PR updates the counterpart directly in one terminology-guided pass and re-records the pair with `--write <pair>`**. A PR that leaves a pair out of sync goes red in CI.

The gate's limit, stated plainly: **a green gate means the pair was confirmed consistent at these exact contents, not that the confirmation was sound.** It checks hashes and Markdown structure; it cannot judge whether the two sides actually say the same thing, or whether the wording is accurate, well-termed, and natural — that is the reviewer's half of the contract, per [translation-rules.md](translation-rules.md). A re-recorded pair with a sloppy counterpart passes the gate; it must not pass review.

## Scope and exclusions

**Scope**: every active document under `.agents/notes/**` and `docs/**`. Dependency and ignored build-output trees and the frozen `.agents/notes/archived/` tree are discovery exclusions, not evolving translation source.

**Excluded** (never paired, and the gate rejects a `.zh.md` or `.i18n.yaml` for them):

- Root `README.md` and `README.en.md` — the Chinese homepage keeps its existing single-language layout; both files stay out of the pairing contract.
- `.agents/notes/**/AGENTS.md` and their `CLAUDE.md` instruction symlinks — agent instructions, maintained in English only like the root `AGENTS.md`.
- `docs/i18n/terminology.md` and [style-samples.md](style-samples.md) — both are bilingual by construction.
- [translation-prompt.md](translation-prompt.md) — the translation pipeline's prompt template; its body is machine-consumed verbatim, so a paired translation would change pipeline behavior.
- `.agents/notes/archived/` — frozen historical triplets. [`verify-archived-agent-notes`](../../scripts/verify-archived-agent-notes.ts) validates their completeness and content seals; translation maintenance must never rewrite them.

**Universal requirement**: every current or future document in scope must merge as a complete bilingual pair. [scripts/translation-pairing.manifest.json](../../scripts/translation-pairing.manifest.json) contains only explicit exclusions; there is no per-file rollout list, date cutoff, or README-specific policy class.

## Division of labor

Routine counterparts are updated directly by the working agent in one shot and one pass after it loads [terminology.md](terminology.md); it does not invoke a translation skill, generate a briefing, run a separate translation-review pass, or delegate to a subagent. The extended [dsh-translate-docs](../../.agents/skills/dsh-translate-docs/SKILL.md) workflow retains those heavier mechanisms for explicit user invocation. The gate checks pair completeness, recorded hashes, both language switchers, and its documented structural signature. Review still owns translation quality, terminology, and structural requirements that the signature does not encode.
