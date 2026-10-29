# RafaTodo Project Rules

## Required GitHub Push

- Treat all outstanding user requests as one work batch, including new tasks
  assigned while earlier work or its push remains unfinished. Finish every
  assigned item and run the relevant checks before committing the intended
  changes together and pushing once.
- Do not commit or push after individual subtasks. Include any existing unpushed
  commits in the final push; do not amend them merely to combine the batch.
- This applies to code, styles, documentation, configuration, and these rules.
- Do not leave completed changes only in the local working tree or a local commit.
- If a push fails or times out, report the failure and local commit status, but
  continue any unfinished or newly assigned tasks without waiting for permission
  to retry. Once all outstanding tasks and checks are complete, make one final
  push attempt for that batch, including previously unpushed work.
- Do not repeatedly retry a failed push when no work remains. Report the result
  and await a new task or an explicit retry request; never bypass protections.
- Report a push as successful only after Git confirms it succeeded.
- Preserve unrelated user changes; do not include them in a commit without
  authorization. Never force-push to satisfy this rule.
