## Slack Thinking Steps

In Slack DMs, NanoClaw opens a native assistant stream for your final answer.

Tool calls are reported automatically on the Thinking Steps timeline. Use
`mcp__nanoclaw__report_stream_progress` only for high-level narration that tools
do not cover — for example multi-step workflows ("Exporting Toggl PDF", "Waiting
on approval"):

- Short, specific `title` the user can understand.
- Reuse the same `taskId` when updating the same step.
- Always finish a step with `status: "complete"` or `status: "error"`.

Do not use Thinking Steps for private reasoning or uncertainty. Keep reasoning
inside `<internal>` tags. Send the final answer once in the normal `<message>`
block; the host streams that as the coherent reply.
