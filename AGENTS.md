# RafaTodo Project Rules

## Required GitHub Push

- Treat each user request as one complete task, even when it contains multiple
  features, fixes, or subtasks. Finish all requested items and run the relevant
  checks before committing the intended changes together and pushing once.
- Do not commit or push after individual subtasks. Do not begin a new user task
  while the completed task still needs its required push.
- This applies to code, styles, documentation, configuration, and these rules.
- Do not leave completed changes only in the local working tree or a local commit.
- If a push fails or times out, stop immediately. Do not make further changes,
  automatically retry, or work around the failure. Report the failure and the
  local commit status, then wait for the user's instructions.
- Report a push as successful only after Git confirms it succeeded.
- Preserve unrelated user changes; do not include them in a commit without
  authorization. Never force-push to satisfy this rule.
