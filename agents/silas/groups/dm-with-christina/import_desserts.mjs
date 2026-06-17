import { AnyListClient } from "/workspace/extra/skills/anylist/anylist.mjs";

const recipes = [
  {
    name: "Dark Chocolate Avocado Mousse",
    serves: "serves 4",
    ingredients: [
      "2 ripe avocados",
      "1/2 cup unsweetened cocoa powder",
      "1/3 cup maple syrup",
      "1 tsp vanilla extract",
      "3 tbsp full-fat coconut milk",
      "1/8 tsp salt",
    ],
    steps: [
      "Blend everything in a food processor until smooth.",
      "Chill 30 min.",
      "Top with berries or flaky salt.",
    ],
  },
  {
    name: "Chia Seed Pudding",
    serves: "serves 2",
    ingredients: [
      "1/4 cup chia seeds",
      "1 cup full-fat coconut milk",
      "2 tbsp maple syrup",
      "1/2 tsp vanilla extract",
      "1 cup mixed berries",
    ],
    steps: [
      "Whisk all but berries.",
      "Wait 10 min, whisk again.",
      "Chill 4 hrs or overnight.",
      "Top with berries.",
    ],
  },
  {
    name: "Coconut Milk Ice Cream",
    serves: "serves 4",
    ingredients: [
      "2 cans (28 oz total) full-fat coconut milk",
      "1/2 cup maple syrup or honey",
      "1 tbsp vanilla extract",
      "pinch salt",
    ],
    steps: [
      "Whisk together, chill thoroughly.",
      "Churn in an ice cream maker per its instructions.",
      "No machine: freeze in a shallow pan, stirring every 30 min for 3 hrs.",
    ],
  },
  {
    name: "Almond Flour Cookies",
    serves: "makes ~18",
    ingredients: [
      "2 cups almond flour",
      "1/4 cup coconut oil, melted",
      "1/4 cup maple syrup",
      "1 tsp vanilla extract",
      "1/4 tsp salt",
      "1/2 tsp baking soda",
      "1/2 cup dairy-free dark chocolate chips",
    ],
    steps: [
      "Mix all, fold in chips.",
      "Scoop onto lined sheet.",
      "Bake 350°F for 10-12 min.",
    ],
  },
  {
    name: "Baked Apples or Pears",
    serves: "serves 4",
    ingredients: [
      "4 apples or pears, cored",
      "2 tsp cinnamon",
      "2 tbsp maple syrup",
      "1/4 cup chopped nuts (optional)",
    ],
    steps: [
      "Place in baking dish, fill centers with cinnamon, maple, and nuts.",
      "Bake 375°F for 30-35 min until soft.",
    ],
  },
  {
    name: "Banana Nice Cream",
    serves: "serves 2",
    ingredients: [
      "3 frozen bananas, sliced",
      "1-2 tbsp cocoa powder or 1/2 cup berries (optional)",
      "splash coconut milk if needed",
    ],
    steps: [
      "Blend frozen bananas in a food processor until creamy, scraping down as needed.",
      "Add cocoa or berries.",
      "Eat soft or freeze 1 hr for firmer.",
    ],
  },
  {
    name: "Date Energy Balls",
    serves: "makes ~16",
    ingredients: [
      "1 cup Medjool dates, pitted",
      "1 cup nuts (almonds or walnuts)",
      "2 tbsp cocoa powder",
      "1/4 cup shredded coconut, plus more for rolling",
      "pinch salt",
    ],
    steps: [
      "Pulse nuts in food processor, add rest, blend until sticky.",
      "Roll into balls, coat in coconut.",
      "Chill.",
    ],
  },
  {
    name: "Coconut Flour Brownies",
    serves: "makes 9",
    ingredients: [
      "1/2 cup coconut flour",
      "1/2 cup cocoa powder",
      "1/2 cup maple syrup",
      "1/2 cup coconut oil, melted",
      "4 eggs",
      "1 tsp vanilla extract",
      "1/4 tsp salt",
    ],
    steps: [
      "Whisk eggs, maple, oil, vanilla.",
      "Stir in dry ingredients.",
      "Pour into lined 8x8 pan.",
      "Bake 350°F for 22-25 min.",
    ],
  },
  {
    name: "Berry Crumble",
    serves: "serves 6",
    ingredients: [
      "4 cups mixed berries",
      "1 tbsp maple syrup",
      "1 cup certified GF rolled oats",
      "1/2 cup almond flour",
      "1/4 cup coconut oil, melted",
      "1/4 cup maple syrup",
      "1/2 tsp cinnamon",
    ],
    steps: [
      "Toss berries with 1 tbsp maple in baking dish.",
      "Mix topping, scatter over.",
      "Bake 350°F for 30-35 min.",
    ],
  },
  {
    name: "Flourless Chocolate Cake",
    serves: "serves 8",
    ingredients: [
      "8 oz dairy-free dark chocolate",
      "1/2 cup coconut oil",
      "3/4 cup maple syrup",
      "5 eggs",
      "1/2 cup cocoa powder",
      "1 tsp vanilla extract",
      "1/4 tsp salt",
    ],
    steps: [
      "Melt chocolate and oil together.",
      "Whisk in maple, eggs, vanilla.",
      "Fold in cocoa and salt.",
      "Pour into lined 9-inch pan.",
      "Bake 350°F for 25-30 min.",
    ],
  },
];

const client = new AnyListClient();
try {
  await client.login();
  await client.refresh();

  for (const r of recipes) {
    const existing = await client.getRecipeByName(r.name).catch(() => null);
    if (existing) {
      console.log(`Recipe already exists: ${r.name}`);
      continue;
    }

    const recipe = await client.saveRecipe({
      name: r.name,
      servings: r.serves,
      ingredients: r.ingredients.map((text) => ({
        text,
        name: text,
      })),
      preparationSteps: r.steps,
    });
    console.log(`Created: ${r.name} (${recipe.recipeId})`);
  }
} finally {
  client.teardown();
}
