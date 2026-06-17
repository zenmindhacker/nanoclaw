import { AnyListClient } from "/workspace/extra/skills/anylist/anylist.mjs";

const client = new AnyListClient();
try {
  await client.login();
  await client.refresh();

  const name = "Instant Pot Ground Beef & Red Lentil Coconut Curry";
  const existing = await client.getRecipeByName(name).catch(() => null);
  if (existing) {
    console.log(`Recipe already exists: ${name}`);
    process.exit(0);
  }

  const recipe = await client.saveRecipe({
    name,
    servings: "serves 8-12",
    prepTime: "10 mins",
    cookTime: "20 mins",
    ingredients: [
      { text: "2 lbs ground beef", name: "ground beef", quantity: "2 lbs" },
      { text: "3 cups red lentils, rinsed", name: "red lentils, rinsed", quantity: "3 cups" },
      { text: "2 cans (14 oz each) coconut milk (full-fat)", name: "coconut milk (full-fat)", quantity: "2 cans (14 oz each)" },
      { text: "2 large yellow onions, diced", name: "yellow onions, diced", quantity: "2 large" },
      { text: "8-10 garlic cloves, minced", name: "garlic cloves, minced", quantity: "8-10" },
      { text: "2 tbsp fresh ginger, grated", name: "fresh ginger, grated", quantity: "2 tbsp" },
      { text: "4 tbsp curry powder", name: "curry powder", quantity: "4 tbsp" },
      { text: "2 tsp ground turmeric", name: "ground turmeric", quantity: "2 tsp" },
      { text: "2 tsp cumin", name: "cumin", quantity: "2 tsp" },
      { text: "1/2–1 tsp cayenne pepper (optional)", name: "cayenne pepper", quantity: "1/2–1 tsp", note: "optional" },
      { text: "2 cans (14 oz each) diced tomatoes (with juices)", name: "diced tomatoes (with juices)", quantity: "2 cans (14 oz each)" },
      { text: "3 cups beef or vegetable broth", name: "beef or vegetable broth", quantity: "3 cups" },
      { text: "Salt & black pepper, to taste", name: "Salt & black pepper", quantity: "to taste" },
      { text: "2 tbsp oil (for sautéing)", name: "oil (for sautéing)", quantity: "2 tbsp" },
      { text: "Fresh cilantro & lime, for garnish", name: "Fresh cilantro & lime", note: "for garnish" },
    ],
    preparationSteps: [
      "Sauté the beef: Set Instant Pot to Sauté (High). Add oil and ground beef. Break up and cook until browned, 5-6 minutes. Drain excess fat if needed.",
      "Build the aromatics: Add diced onions. Cook 3 minutes until soft. Stir in garlic, ginger, curry powder, turmeric, cumin, and cayenne. Cook 1 minute until fragrant.",
      "Deglaze & add lentils: Pour in a splash of broth and scrape up browned bits. Add rinsed red lentils, diced tomatoes (with juices), and remaining broth. Stir well.",
      "Pressure cook: Seal lid, set valve to Sealing. Cook on Manual/Pressure Cook (High) for 10 minutes.",
      "Natural release & finish: Let pressure release naturally for 10 minutes, then quick-release remaining pressure. Stir in coconut milk. Do not boil.",
      "Season & serve: Adjust salt to taste. Add fresh lime juice and garnish with cilantro. Serve over rice or with naan.",
    ],
  });
  console.log(`Created: ${name} (${recipe.recipeId})`);
} finally {
  client.teardown();
}
