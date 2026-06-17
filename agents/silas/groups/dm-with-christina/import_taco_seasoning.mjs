import { AnyListClient } from "/workspace/extra/skills/anylist/anylist.mjs";

const client = new AnyListClient();
try {
  await client.login();
  await client.refresh();

  const name = "Homemade Taco Seasoning";
  const existing = await client.getRecipeByName(name).catch(() => null);
  if (existing) {
    console.log(`Recipe already exists: ${name}`);
    process.exit(0);
  }

  const recipe = await client.saveRecipe({
    name,
    servings: "makes ~3/4 cup — jar batch",
    ingredients: [
      { text: "4 tbsp chili powder", name: "chili powder", quantity: "4 tbsp" },
      { text: "2 tbsp ground cumin", name: "ground cumin", quantity: "2 tbsp" },
      { text: "4 tsp paprika", name: "paprika", quantity: "4 tsp" },
      { text: "4 tsp salt", name: "salt", quantity: "4 tsp" },
      { text: "2 tsp garlic powder", name: "garlic powder", quantity: "2 tsp" },
      { text: "2 tsp onion powder", name: "onion powder", quantity: "2 tsp" },
      { text: "2 tsp dried oregano", name: "dried oregano", quantity: "2 tsp" },
      { text: "2 tsp black pepper", name: "black pepper", quantity: "2 tsp" },
      { text: "1 tsp cayenne (optional, for heat)", name: "cayenne", quantity: "1 tsp", note: "optional, for heat" },
    ],
    preparationSteps: [
      "Mix everything together and store in an airtight jar up to 6 months.",
      "To use: use 2–3 tbsp per 1 lb ground meat. Brown the meat, add the seasoning plus ~1/4 cup water, and simmer 3–5 minutes.",
    ],
  });
  console.log(`Created: ${name} (${recipe.recipeId})`);
} finally {
  client.teardown();
}
