import fs from "node:fs";
import { AnyListClient } from "/workspace/extra/skills/anylist/anylist.mjs";

const recipes = [
  { name: "Dark Chocolate Avocado Mousse", file: "dark_chocolate_avocado_mousse.png" },
  { name: "Chia Seed Pudding", file: "chia_seed_pudding.png" },
  { name: "Coconut Milk Ice Cream", file: "coconut_milk_ice_cream.png" },
  { name: "Almond Flour Cookies", file: "almond_flour_cookies.png" },
  { name: "Baked Apples or Pears", file: "baked_apples_or_pears.png" },
  { name: "Banana Nice Cream", file: "banana_nice_cream.png" },
  { name: "Date Energy Balls", file: "date_energy_balls.png" },
  { name: "Coconut Flour Brownies", file: "coconut_flour_brownies.png" },
  { name: "Berry Crumble", file: "berry_crumble.png" },
  { name: "Flourless Chocolate Cake", file: "flourless_chocolate_cake.png" },
  { name: "Homemade Taco Seasoning", file: "homemade_taco_seasoning.png" },
  { name: "Instant Pot Ground Beef & Red Lentil Coconut Curry", file: "instant_pot_ground_beef___red_lentil_coconut_curry.png" },
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
      console.log(`Photo added to: ${r.name}`);
    } catch (e) {
      console.error(`Failed for ${r.name}: ${e.message}`);
    }
  }
} finally {
  client.teardown();
}
