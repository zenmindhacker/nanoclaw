---
name: anylist
description: Manage the family AnyList (shopping lists, chores, recipes, meal plan). Use when asked to add/check/remove items, manage chore assignments, import recipes from URLs, plan meals, attach photos to recipes, or query list state. Triggers on "add to groceries", "what chores are left", "check off X", "put X on the list", "import this recipe", "plan dinner", anything referencing AnyList or the Chores/Groceries lists.
allowed-tools: Bash
---

# AnyList Skill

Manage the family's AnyList (shopping lists, chores, recipes, meal plan) via the unofficial protobuf API.

## First-Run Setup

```bash
SKILL_DIR="/workspace/extra/skills/anylist"
cd "$SKILL_DIR" && [ ! -d node_modules ] && npm install --silent
```

Credentials `ANYLIST_EMAIL` and `ANYLIST_PASSWORD` are injected as env vars.

## CLI — Quick Reference

```bash
cd /workspace/extra/skills/anylist && node cli.mjs <cmd>
```

### Lists & Items

| Command | Description |
|---------|-------------|
| `list-names` | All lists with IDs and item counts |
| `show-list <name>` | Items in a list (id, checked, matchId, name) |
| `add-item <list> <name...>` | Add an item |
| `check-item <list> <itemId> [true\|false]` | Check/uncheck an item |
| `remove-item <list> <itemId>` | Remove an item |
| `rename-list <list> <newName>` | Rename a list |
| `assign-category <list> <itemId> <matchKey> <groupId> <catId>` | Move item to category |
| `save-rule <list> <groupId> <matchKey> <catId>` | Create categorization rule |
| `create-category-group <list> [name]` | Create a category group |
| `create-category <list> <groupId> <name>` | Create a category |
| `rename-category <list> <groupId> <catId> <newName>` | Rename a category |

### Recipes

| Command | Description |
|---------|-------------|
| `list-recipes` | All recipes (id, name, ingredient count, source URL) |
| `show-recipe <idOrName>` | Full recipe details (ingredients + steps) |
| `import-recipe <url>` | **Preferred** — auto-parses JSON-LD, fetches hero image |
| `create-recipe <name...>` | Create a blank recipe |
| `delete-recipe <idOrName>` | Delete a recipe |
| `attach-photo <idOrName> <imagePath>` | Upload image and attach to recipe |

### Meal Plan

| Command | Description |
|---------|-------------|
| `list-meals [startDate] [endDate]` | Calendar events, optionally filtered |
| `list-meal-labels` | Available labels (Breakfast/Lunch/Dinner) |
| `add-meal <date> <label> [recipeIdOrName] [title...]` | Add a meal event |
| `delete-meal <eventId>` | Delete an event |

## Recipe Photos

AnyList recipes can have a hero photo. Two paths:

**CLI (one-shot):**
```bash
cd /workspace/extra/skills/anylist
node cli.mjs attach-photo "Biohacker Oatmeal" /tmp/oatmeal.jpg
```

**Library script:**
```javascript
import fs from "node:fs";
import { AnyListClient } from "/workspace/extra/skills/anylist/anylist.mjs";
const client = new AnyListClient();
await client.login();
const bytes = fs.readFileSync("/tmp/oatmeal.jpg");
const photoId = await client.uploadPhoto(bytes, "image/jpeg");
await client.saveRecipe({ identifier: "<recipe-id>", photoIds: [photoId] });
client.teardown();
```

### Photo Footguns

- **`photoUrls` is a lie.** Server silently strips external URLs. You **must** use `uploadPhoto` then `photoIds`.
- **`photoIds` is server-validated.** Random UUIDs without calling `uploadPhoto` first are silently dropped.
- **Use the exact value** returned by `uploadPhoto` (32-char lowercase hex, no hyphens).
- **Replacing a photo**: `photoIds: [newId]`. Empty array clears the photo.

### Generating an image to attach

Display container is 320x240 (4:3). Generate at higher res for retina:

```javascript
const resp = await fetch("https://api.openai.com/v1/images/generations", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  body: JSON.stringify({ model: "gpt-image-1", prompt: "<description>", size: "1536x1024", n: 1 }),
});
const { data } = await resp.json();
const bytes = Buffer.from(data[0].b64_json, "base64");
// Then: uploadPhoto(bytes, "image/png")
```

## Library (for scripts)

For complex operations — daily chore rotation, meal-plan-to-grocery, batch imports:

```javascript
import { AnyListClient } from "/workspace/extra/skills/anylist/anylist.mjs";
const client = new AnyListClient();
await client.login();
await client.refresh();

// Add items, manage recipes, plan meals...
const list = client.getListByName("Chores");
for (const item of list.items.filter(i => i.checked)) await client.removeItem(item);
await client.addItem("Chores", "Sam · Cat litter");

client.teardown();
```

## Known IDs (Chores List)

```
list:           Chores                   f93ceecd665241f3b75b11615280d8d0
categoryGroup:                           c419552fe2b369ce4738552c160ead1d
  Lily    matchKey=lily   categoryId=   8090bb57f3bf99f51233e02756e8f4cb
  Ava     matchKey=ava    categoryId=   25864f127f3c1f37de72faa608b85fc6
  Sam     matchKey=sam    categoryId=   b4a64b65a5fef79e99a97e48f7b3fa11
  Bonus   matchKey=bonus  categoryId=   014b9a311e8f3545d0bfc532a9bbb40b
```

## Category Assignment

AnyList grouping is a two-step mechanism:
1. **Rule** (on category group): `matchKey -> categoryId`. Create once with `save-rule`.
2. **Item tag**: `categoryMatchId + categoryAssignments[]`. Both must be set. Use `assign-category` (the npm wrapper's `item.save()` silently no-ops on these).

With existing rules, `assignItemCategory({ matchKey })` is enough — the library resolves `categoryGroupId`/`categoryId` automatically.

## Recipe Import (preferred for URLs)

Always use `import-recipe` when the user gives a URL:
```bash
node cli.mjs import-recipe https://www.allrecipes.com/recipe/11729/american-lasagna/
```

Handles: HTML fetch, JSON-LD parsing, Jina Reader fallback for bot-blocked sites, hero image upload, prep/cook time conversion.

## Safe Partial Updates

Both `saveRecipe` and `saveMealEvent` auto-merge with existing state. Send only the fields you want to change — omitted fields are preserved. Array fields (ingredients, preparationSteps, photoIds) are replace-all.

## Safety Notes

- **`prepTime`/`cookTime`** accept "30 mins", "1 hr 20 min", "PT1H30M", or plain numbers
- **`creationTimestamp`** auto-set on new recipes
- **`sourceUrl`** auto-prepended to note when note is empty
- **`getListByName`/`getRecipeByName`** auto-refresh and throw helpful errors with available names
