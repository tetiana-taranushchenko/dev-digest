# Conventions Extractor

The Conventions page turns mechanically grounded repository observations into
an editable `repo-conventions` skill.

## Flow

1. Select a repository and run extraction.
2. The server reads root ESLint, TypeScript, Prettier, Biome, and EditorConfig
   files plus 12 ranked source files from `repoIntel.getConventionSamples()`.
3. The configured low-cost Conventions model proposes category, rule, exact
   evidence path and line, and confidence.
4. Code rejects candidates whose sampled file or non-empty line does not exist,
   whose confidence is below `0.60`, or whose path is unsafe. Evidence snippets
   are reread from disk and pinned to the current commit SHA.
5. Approve, reject, or edit candidates in the UI. Rejected candidates stay
   visible but never enter the skill draft.
6. Create and edit the draft, then save it. Link the resulting skill manually
   from **Agent → Skills**.

Successful re-scans replace the candidate set after UI confirmation. A failed
model or filesystem run leaves the existing set untouched.

## API

- `GET /repos/:id/conventions`
- `POST /repos/:id/conventions/extract`
- `PATCH /repos/:repoId/conventions/:conventionId`
- `GET /repos/:id/conventions/skill-draft`
- `POST /repos/:id/conventions/skill`

## Quality notes for the pull request

Record the repository, sampled-file count, raw model candidate count, verified
count, approved count, rejected count, and examples of false positives. Useful
next improvements are multi-evidence candidates, cross-file frequency checks,
language-aware AST verification, and feedback-based confidence calibration.

## Demo checklist

- Run extraction and show verified candidates.
- Open an evidence link at its exact GitHub line.
- Edit one candidate, approve useful rules, and reject a false positive.
- Open the draft and show that the rejected rule is absent.
- Save `repo-conventions`, link it to an agent, and run a review.
- Follow [`api-contract-reviewer-experiment.md`](./api-contract-reviewer-experiment.md)
  for the baseline-versus-skills comparison.

