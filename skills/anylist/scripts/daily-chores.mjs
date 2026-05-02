// daily-chores.mjs — reset + seed today's chores on the Chores list.
// Edit todayChores, run: node scripts/daily-chores.mjs

import { AnyListClient } from "../anylist.mjs";

const GROUP = "c419552fe2b369ce4738552c160ead1d";
const CATS = {
  lily: "8090bb57f3bf99f51233e02756e8f4cb",
  ava: "25864f127f3c1f37de72faa608b85fc6",
  sam: "b4a64b65a5fef79e99a97e48f7b3fa11",
  bonus: "014b9a311e8f3545d0bfc532a9bbb40b",
};

const kidOf = (n) =>
  /Sam ·/.test(n) ? "sam" :
  /Lily ·/.test(n) ? "lily" :
  /Ava ·/.test(n) ? "ava" :
  /BONUS/.test(n) ? "bonus" : null;

const todayChores = [
  "🐱 Sam · Cat litter",
  "🐾 Sam · Pet food & water",
  "🍽️ Lily · Dishes",
  "🗑️ Ava · Take out trash",
  "⭐ BONUS · Mop kitchen · $4",
];

const client = new AnyListClient();
await client.login();
await client.refresh();

const list = client.getListByName("Chores");
console.log(`Resetting ${list.items.filter(i => i.checked).length} completed items`);
for (const it of list.items.filter(i => i.checked)) await client.removeItem(it);

console.log(`Adding ${todayChores.length} chores`);
for (const name of todayChores) {
  const item = await client.addItem("Chores", name);
  const kid = kidOf(name);
  if (kid) {
    await client.assignItemCategory(item, {
      matchKey: kid,
      categoryGroupId: GROUP,
      categoryId: CATS[kid],
    });
  }
  console.log(`  + ${name}${kid ? ` [${kid}]` : ""}`);
}

client.teardown();
console.log("done");
