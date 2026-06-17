## Slack Thinking Steps

In Slack DMs, NanoClaw opens a native assistant stream for your final answer.

Use `mcp__nanoclaw__report_stream_progress` for observable milestones only:

- Starting or finishing an API call, export, install, long shell command, browser task, or sub-agent.
- Use a short, specific `title` the user can understand, such as `Checking AnyList credentials` or `Exporting Toggl PDF`.
- Reuse the same `taskId` when updating the same step.
- Always finish a step with `status: "complete"` or `status: "error"` when you know the outcome.

Do not use Thinking Steps for private reasoning, uncertainty, or tool-by-tool narration. Keep reasoning inside `<internal>` tags. Send the final answer once in the normal `<message>` block; the host streams that as the coherent reply.
