import fs from "node:fs";
import { AnyListClient } from "/workspace/extra/skills/anylist/anylist.mjs";

const recipes = [
  { name: "Dark Chocolate Avocado Mousse", file: "ai_dark_chocolate_avocado_mousse.png" },
  { name: "Chia Seed Pudding", file: "ai_chia_seed_pudding.png" },
  { name: "Coconut Milk Ice Cream", file: "ai_coconut_milk_ice_cream.png" },
  { name: "Almond Flour Cookies", file: "ai_almond_flour_cookies.png" },
  { name: "Baked Apples or Pears", file: "ai_baked_apples.png" },
  { name: "Banana Nice Cream", file: "ai_banana_nice_cream.png" },
  { name: "Date Energy Balls", file: "ai_date_energy_balls.png" },
  { name: "Coconut Flour Brownies", file: "ai_coconut_flour_brownies.png" },
  { name: "Berry Crumble", file: "ai_berry_crumble.png" },
  { name: "Flourless Chocolate Cake", file: "ai_flourless_chocolate_cake.png" },
  { name: "Homemade Taco Seasoning", file: "ai_taco_seasoning.png" },
  { name: "Instant Pot Ground Beef & Red Lentil Coconut Curry", file: "ai_coconut_curry.png" },
];

const client = new AnyListClient();
try {
  await client.login();
  await client.refresh();

  for (const r of recipes) {
    try {
      const existing = await client.getRecipeByName(r.name);
      if (!existing) {
        console.log(`Not found: ${r.name}`);
        continue;
      }

      const bytes = fs.readFileSync(`/tmp/${r.file}`);
      const photoId = await client.uploadPhoto(bytes, "image/png");

      await client.saveRecipe({
        identifier: existing.identifier,
        photoIds: [photoId],
      });
      console.log(`AI photo added to: ${r.name}`);
    } catch (e) {
      console.error(`Failed for ${r.name}: ${e.message}`);
    }
  }
} finally {
  client.teardown();
}
