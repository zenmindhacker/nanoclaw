#!/usr/bin/env node
// cli.mjs — thin command-line wrapper around anylist.mjs.
// Usage: node cli.mjs <command> [args...]
//
// Silas calls this from the container. Credentials come from ../.env
// (ANYLIST_EMAIL, ANYLIST_PASSWORD).

import { AnyListClient } from "./anylist.mjs";

const commands = {
  async "list-names"(client) {
    await client.refresh();
    for (const l of client.getLists()) console.log(`${l.identifier}  ${l.name}  (${l.items.length} items)`);
  },

  async "show-list"(client, name) {
    if (!name) die("usage: show-list <listName>");
    await client.refresh();
    const list = await client.getListByName(name);
    if (!list) die(`list not found: ${name}`);
    console.log(`# ${list.name}  id=${list.identifier}  items=${list.items.length}`);
    for (const it of list.items) {
      console.log(`${it.identifier}  ${it.checked ? "[x]" : "[ ]"} matchId=${it.categoryMatchId ?? "-"}  ${it.name}`);
    }
  },

  async "add-item"(client, listName, ...nameParts) {
    if (!listName || !nameParts.length) die("usage: add-item <listName> <itemName...>");
    await client.refresh();
    const item = await client.addItem(listName, nameParts.join(" "));
    console.log(`added ${item.identifier}  ${item.name}`);
  },

  async "check-item"(client, listName, itemId, val = "true") {
    if (!listName || !itemId) die("usage: check-item <listName> <itemId> [true|false]");
    await client.refresh();
    const list = await client.getListByName(listName);
    const item = list.items.find((i) => i.identifier === itemId);
    if (!item) die(`item not found: ${itemId}`);
    await client.checkItem(item, val !== "false");
    console.log(`✓ ${item.name} → checked=${item.checked}`);
  },

  async "remove-item"(client, listName, itemId) {
    if (!listName || !itemId) die("usage: remove-item <listName> <itemId>");
    await client.refresh();
    const list = await client.getListByName(listName);
    const item = list.items.find((i) => i.identifier === itemId);
    if (!item) die(`item not found: ${itemId}`);
    await client.removeItem(item);
    console.log(`removed ${itemId}`);
  },

  async "rename-list"(client, listName, newName) {
    if (!listName || !newName) die("usage: rename-list <listName> <newName>");
    await client.refresh();
    const list = await client.getListByName(listName);
    if (!list) die(`list not found: ${listName}`);
    const r = await client.renameList(list.identifier, newName);
    console.log(JSON.stringify(r));
  },

  async "assign-category"(client, listName, itemId, matchKey, categoryGroupId, categoryId) {
    if (!listName || !itemId || !matchKey || !categoryGroupId || !categoryId) {
      die("usage: assign-category <listName> <itemId> <matchKey> <categoryGroupId> <categoryId>");
    }
    await client.refresh();
    const list = await client.getListByName(listName);
    const item = list.items.find((i) => i.identifier === itemId);
    if (!item) die(`item not found: ${itemId}`);
    const r = await client.assignItemCategory(item, { matchKey, categoryGroupId, categoryId });
    console.log(JSON.stringify(r));
  },

  async "save-rule"(client, listName, categoryGroupId, matchKey, categoryId) {
    if (!listName || !categoryGroupId || !matchKey || !categoryId) {
      die("usage: save-rule <listName> <categoryGroupId> <matchKey> <categoryId>");
    }
    await client.refresh();
    const list = await client.getListByName(listName);
    const r = await client.saveCategorizationRule({
      listId: list.identifier,
      categoryGroupId,
      matchKey,
      categoryId,
    });
    console.log(JSON.stringify(r));
  },

  async "create-category-group"(client, listName, groupName = "") {
    if (!listName) die("usage: create-category-group <listName> [groupName]");
    await client.refresh();
    const list = await client.getListByName(listName);
    const r = await client.createCategoryGroup(list.identifier, { name: groupName });
    console.log(JSON.stringify(r));
  },

  async "create-category"(client, listName, categoryGroupId, categoryName) {
    if (!listName || !categoryGroupId || !categoryName) die("usage: create-category <listName> <categoryGroupId> <name>");
    await client.refresh();
    const list = await client.getListByName(listName);
    const r = await client.createCategory(list.identifier, {
      categoryGroupId,
      name: categoryName,
    });
    console.log(JSON.stringify(r));
  },

  async "rename-category"(client, listName, categoryGroupId, categoryId, newName) {
    if (!listName || !categoryGroupId || !categoryId || !newName) {
      die("usage: rename-category <listName> <categoryGroupId> <categoryId> <newName>");
    }
    await client.refresh();
    const list = await client.getListByName(listName);
    const r = await client.renameCategory({
      listId: list.identifier,
      categoryGroupId,
      categoryId,
      newName,
    });
    console.log(JSON.stringify(r));
  },

  // --- RECIPES ---

  async "list-recipes"(client) {
    const recipes = await client.getRecipes();
    for (const r of recipes.sort((a,b) => (a.name||"").localeCompare(b.name||""))) {
      console.log(`${r.identifier}  ${r.name}  (${r.ingredients?.length || 0} ing)${r.sourceUrl ? "  " + r.sourceUrl : ""}`);
    }
  },

  async "import-recipe"(client, url) {
    if (!url) die("usage: import-recipe <url>");
    const result = await client.importRecipeFromUrl(url);
    console.log(`imported ${result.recipeId}  from ${url}`);
  },

  async "show-recipe"(client, idOrName) {
    if (!idOrName) die("usage: show-recipe <idOrName>");
    await client.getRecipes();
    const r = client.any.recipes.find((x) => x.identifier === idOrName) || await client.getRecipeByName(idOrName);
    if (!r) die(`recipe not found: ${idOrName}`);
    console.log(`# ${r.name}   id=${r.identifier}`);
    if (r.sourceUrl) console.log(`source: ${r.sourceUrl}`);
    if (r.servings) console.log(`servings: ${r.servings}`);
    if (r.prepTime) console.log(`prep: ${r.prepTime}min`);
    if (r.cookTime) console.log(`cook: ${r.cookTime}min`);
    if (r.note) console.log(`\nnote:\n${r.note}`);
    console.log(`\n## Ingredients`);
    for (const i of r.ingredients || []) console.log(`  - ${i.rawIngredient || i.name}`);
    console.log(`\n## Steps`);
    for (const [n, s] of (r.preparationSteps || []).entries()) console.log(`  ${n+1}. ${s}`);
  },

  async "create-recipe"(client, ...nameParts) {
    if (!nameParts.length) die("usage: create-recipe <name...>  (for complex recipes write a script)");
    const name = nameParts.join(" ");
    const r = await client.saveRecipe({ name });
    console.log(`created ${r.recipeId}  "${name}"`);
  },

  async "delete-recipe"(client, idOrName) {
    if (!idOrName) die("usage: delete-recipe <idOrName>");
    await client.getRecipes();
    const r = client.any.recipes.find((x) => x.identifier === idOrName) || await client.getRecipeByName(idOrName);
    if (!r) die(`recipe not found: ${idOrName}`);
    const res = await client.deleteRecipe(r);
    console.log(`deleted ${r.identifier} "${r.name}"  status=${res.status}`);
  },

  async "attach-photo"(client, idOrName, imagePath) {
    if (!idOrName || !imagePath) {
      die("usage: attach-photo <recipeIdOrName> <imagePath>\n  Uploads the image and links it to the recipe. Replaces any existing photo.");
    }
    const fs = await import("node:fs");
    if (!fs.existsSync(imagePath)) die(`image not found: ${imagePath}`);
    const bytes = fs.readFileSync(imagePath);
    // Detect format from magic bytes so we send the right content-type
    const magic = bytes.slice(0, 4).toString("hex");
    const mime =
      magic.startsWith("89504e47") ? "image/png" :
      magic.startsWith("ffd8ff")   ? "image/jpeg" :
      magic.startsWith("52494646") ? "image/webp" :
      "image/jpeg";
    await client.getRecipes();
    const r = client.any.recipes.find((x) => x.identifier === idOrName) || await client.getRecipeByName(idOrName);
    if (!r) die(`recipe not found: ${idOrName}`);
    const photoId = await client.uploadPhoto(bytes, mime);
    await client.saveRecipe({ identifier: r.identifier, photoIds: [photoId] });
    console.log(`attached photoId=${photoId} to "${r.name}" (${bytes.length} bytes, ${mime})`);
  },

  // --- MEAL PLAN ---

  async "list-meals"(client, startDate, endDate) {
    const events = await client.getMealEvents();
    const s = startDate ? new Date(startDate) : null;
    const e = endDate ? new Date(endDate) : null;
    for (const ev of events.sort((a,b) => (a.date?.getTime()||0) - (b.date?.getTime()||0))) {
      if (s && ev.date < s) continue;
      if (e && ev.date > e) continue;
      const d = ev.date?.toISOString().slice(0, 10);
      const label = ev.label?.name || "-";
      const title = ev.title || ev.recipe?.name || "(no title)";
      console.log(`${d}  ${label.padEnd(10)}  ${title}  id=${ev.identifier}`);
    }
  },

  async "list-meal-labels"(client) {
    await client.getMealEvents();
    for (const l of client.getMealLabels()) console.log(`${l.identifier}  ${l.name}  sortIndex=${l.sortIndex}`);
  },

  async "add-meal"(client, date, label, recipeIdOrName, ...titleParts) {
    if (!date || !label) die("usage: add-meal <date YYYY-MM-DD> <labelName|labelId> [recipeIdOrName] [title...]");
    await client.getMealEvents();
    await client.getRecipes();
    const opts = { date, labelName: label };
    if (recipeIdOrName) {
      const r = client.any.recipes.find((x) => x.identifier === recipeIdOrName) || await client.getRecipeByName(recipeIdOrName);
      if (r) opts.recipeId = r.identifier;
      else opts.title = recipeIdOrName + " " + titleParts.join(" ");
    }
    if (titleParts.length && !opts.title) opts.title = titleParts.join(" ");
    const ev = await client.saveMealEvent(opts);
    console.log(`created event ${ev.identifier} on ${date} [${label}]`);
  },

  async "delete-meal"(client, eventId) {
    if (!eventId) die("usage: delete-meal <eventId>");
    const r = await client.deleteMealEvent(eventId);
    console.log(`deleted ${r.identifier}`);
  },

  async help() {
    console.log("AnyList CLI commands:");
    for (const k of Object.keys(commands)) console.log(`  ${k}`);
  },
};

function die(msg) {
  console.error(msg);
  process.exit(2);
}

const [cmd, ...args] = process.argv.slice(2);
const fn = commands[cmd] ?? commands.help;

const client = new AnyListClient();
try {
  await client.login();
  await fn(client, ...args);
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exitCode = 1;
} finally {
  client.teardown();
}
