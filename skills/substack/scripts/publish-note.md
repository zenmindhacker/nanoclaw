# publish-note — Step-by-step runbook

Called from SKILL.md Step 3 after login is confirmed.

## Input
- `NOTE_TEXT` — the text to post (plain text or simple markdown)

## Procedure

### 1. Open the Notes composer

On the Notes feed (`https://substack.com/`), find and click the compose button.

Look for (in order of preference):
1. `button "New post"` — the compose area at top of feed
2. Any button containing text "What's on your mind?"

Click it. Wait 2 seconds.

### 2. Confirm dialog opened

Take snapshot. Expect: `dialog "New note"` with:
- `heading "New note"`
- A `paragraph` with "What's on your mind?" placeholder
- `button "Post"` (will be disabled until text is entered)
- `button "Cancel"`

If dialog not found → report failure, do not proceed.

### 3. Inject note text

Use JS evaluate to inject text into the contenteditable editor:

```javascript
() => {
  const el = document.querySelector('[contenteditable="true"]');
  if (el) {
    el.focus();
    el.innerHTML = '<p>NOTE_TEXT_HERE</p>';
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return 'done';
  }
  return 'not found';
}
```

Replace `NOTE_TEXT_HERE` with the actual note text. Escape any single quotes in the text.

If result is `'not found'` → report failure.

### 4. Verify text and Post button state

Take snapshot. Confirm:
- The paragraph inside the dialog contains the note text
- `button "Post"` is present and NOT marked `[disabled]`

If Post button is still disabled → wait 1 second and re-snapshot. If still disabled after retry, report failure.

### 5. Post it

Click `button "Post"` (find by ref from snapshot).

Wait 3 seconds.

### 6. Confirm posted

Take snapshot. Confirm:
- Dialog "New note" is gone
- First article in `region "Notes feed"` contains:
  - `link "Rev. Cian Kenshin"` (author)
  - `link "just now"` (timestamp)
  - The note text in a paragraph

Capture the URL from `link "just now"` — this is the permanent note URL.

### 7. Return result

Report to user:
```
✅ Note published: https://substack.com/profile/112152828-rev-cian-kenshin/note/c-XXXXXXXXX
```
