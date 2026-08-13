# API Contract Reviewer experiment

Use this checklist to produce the homework A/B evidence without changing the
runtime seed data.

1. Create an **API Contract Reviewer** agent in the UI and paste
   [`agent-prompts/api-contract-reviewer.md`](./agent-prompts/api-contract-reviewer.md)
   as its system prompt.
2. Create or choose a PR that renames a response field or changes a public route.
   Keep the changed line in the PR diff so a finding can be grounded.
3. Run the agent with no linked skills and capture the result.
4. Import at least
   [`deprecation-policy/SKILL.md`](./skills/api-contract-reviewer/deprecation-policy/SKILL.md)
   through **Skills → Import from file**. Add the other three skills from the
   sibling folders and vet/enable them.
5. Link all four skills in **Agent → Skills**, rerun the same PR, and capture the
   breaking-change finding and inline evidence.

Record in the PR description:

| Run | Linked skills | Verdict | Breaking change detected? |
|---|---|---|---|
| Baseline | none |  |  |
| Skilled | four API contract skills |  |  |

For an honest comparison, use the same agent prompt, model, repository, PR head,
and review strategy in both runs. Change only the linked skills.

