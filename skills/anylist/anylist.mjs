// anylist.mjs — AnyList client library
//
// Wraps the unofficial AnyList protobuf API, filling gaps the published
// `anylist` npm package silently no-ops on: categoryMatchId, category
// assignments, recipe CRUD via protobuf, photo upload, meal-plan events.
//
// Reverse-engineered endpoints:
//   /data/shopping-lists/update      — list/item ops
//   /data/shopping-lists/update-v2   — category-group / category / rule ops
//   /data/user-recipe-data/update    — recipe CRUD
//   /data/photos/upload              — recipe photo upload
//   /data/user-data/get              — full state fetch

import "dotenv/config";
import FormData from "form-data";
import crypto from "node:crypto";
import AnyList from "anylist";

// ============================================================================
// Helpers
// ============================================================================

const uuid = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const decodeUid = (jwt) => {
  const p = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString());
  return p.sub || p.user_id;
};

/**
 * Split a free-text ingredient like "1 ½ pounds lean ground beef" into
 * { quantity, name, note, rawIngredient }. AnyList renders name + quantity
 * separately; rawIngredient alone shows blank in the UI.
 */
function splitIngredient(raw) {
  if (!raw || typeof raw !== "string")
    return { rawIngredient: raw || "", name: "", quantity: "" };
  const text = raw.replace(/\s+/g, " ").trim();

  let name = text;
  let note;
  const noteMatch = text.match(
    /^(.*?),\s*(to taste|optional|or more to taste|divided|chopped|minced|sliced|diced|grated|shredded|crushed|drained)(.*)$/i,
  );
  if (noteMatch) {
    name = noteMatch[1].trim();
    note = (noteMatch[2] + (noteMatch[3] || "")).trim().replace(/^,\s*/, "");
  }

  // Quantity regex — order matters (longest/most-specific first):
  //   mixed+fraction → unicode fraction → ASCII fraction → range → decimal → int → bare unicode
  const qtyRe =
    /^(\d+\s+\d+\/\d+|\d+\s*[½¼¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|\d+\/\d+|\d+\s*[-–]\s*\d+(?:\/\d+)?|\d+[\.,]\d+|\d+|[½¼¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])(?:\s*\([^)]*\))?/;
  const qtyMatch = name.match(qtyRe);
  let quantity = "";
  let rest = name;
  if (qtyMatch) {
    quantity = qtyMatch[0].trim();
    rest = name.slice(qtyMatch[0].length).trim();

    const units = [
      "cups?","cupfuls?","tablespoons?","tbsp","tsps?","teaspoons?",
      "ounces?","oz","pounds?","lbs?","pints?","quarts?","gallons?",
      "grams?","g","kg","kilograms?","milliliters?","ml","liters?","l",
      "cloves?","cans?","bottles?","boxes?","bags?","packages?","packets?",
      "sprigs?","sticks?","slices?","dashes?","pinches?","bunches?","heads?","stalks?","ears?",
      "large","medium","small","extra-large","xl","sm","md","lg",
      "dry","fresh","whole","ground","chopped","minced",
      "inch","inches",
    ];
    const unitRe = new RegExp(`^(${units.join("|")})\\b\\.?`, "i");
    const unitMatch = rest.match(unitRe);
    if (unitMatch) {
      quantity = (quantity + " " + unitMatch[0]).trim();
      rest = rest.slice(unitMatch[0].length).trim();
    }
  }

  return { rawIngredient: text, name: rest || text, quantity, note };
}

/** Convert "PT1H20M", "1 hour 20 minutes", "20 min", or a number → int minutes. */
function parseMinutes(v) {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") return Math.round(v);
  const s = String(v).trim();
  const iso = s.match(/^PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (iso && (iso[1] || iso[2]))
    return parseInt(iso[1] || "0", 10) * 60 + parseInt(iso[2] || "0", 10);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  let total = 0;
  const h = s.match(/(\d+)\s*(?:h|hr|hour)/i);
  const m = s.match(/(\d+)\s*(?:m|min|minute)/i);
  if (h) total += parseInt(h[1], 10) * 60;
  if (m) total += parseInt(m[1], 10);
  return total || undefined;
}

// ============================================================================
// Recipe URL import (JSON-LD + Jina fallback)
// ============================================================================

/**
 * Fetch a URL and parse Schema.org Recipe metadata.
 * Tries: direct HTML → Wayback Machine → Jina Reader (markdown).
 */
export async function fetchRecipeFromUrl(url) {
  const ua =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

  async function tryFetch(u, { timeoutMs = 20000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(u, {
        headers: { "User-Agent": ua, Accept: "text/html,application/xhtml+xml,text/plain" },
        redirect: "follow",
        signal: ctrl.signal,
      });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Pass 1: JSON-LD from direct or Wayback
  const year = new Date().getFullYear();
  for (const u of [url, `https://web.archive.org/web/${year}id_/${url}`]) {
    const html = await tryFetch(u);
    if (!html) continue;
    const parsed = parseJsonLd(html);
    if (parsed) return parsed;
  }

  // Pass 2: Jina Reader fallback
  const md = await tryFetch(`https://r.jina.ai/${url}`, { timeoutMs: 30000 });
  if (md) {
    const parsed = parseJinaMarkdown(md, url);
    if (parsed) return parsed;
  }

  throw new Error(`could not parse a recipe from ${url} (direct/archive/jina all failed)`);
}

function parseJsonLd(html) {
  const blocks = [
    ...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ];
  for (const [, blob] of blocks) {
    let data;
    try {
      data = JSON.parse(blob.trim());
    } catch {
      continue;
    }
    const candidates = Array.isArray(data) ? data : data["@graph"] || [data];
    for (const obj of candidates) {
      const type = obj["@type"];
      if (type !== "Recipe" && !(Array.isArray(type) && type.includes("Recipe"))) continue;
      const image = Array.isArray(obj.image)
        ? obj.image[0]?.url || obj.image[0]
        : obj.image?.url || obj.image;
      const authorName = Array.isArray(obj.author)
        ? obj.author[0]?.name
        : obj.author?.name || obj.author;
      return {
        name: obj.name,
        description: obj.description,
        image: typeof image === "string" ? image : null,
        ingredients: obj.recipeIngredient || [],
        preparationSteps: flattenInstructions(obj.recipeInstructions),
        prepTime: obj.prepTime,
        cookTime: obj.cookTime,
        servings: String(obj.recipeYield || ""),
        sourceName: obj.publisher?.name || authorName,
      };
    }
  }
  return null;
}

function parseJinaMarkdown(md, url) {
  const titleMatch = md.match(/^Title:\s*(.+)$/m);
  const name = titleMatch?.[1]?.trim();
  if (!name) return null;

  const section = (header) => {
    const re = new RegExp(`##+\\s*${header}[^\\n]*\\n([\\s\\S]*?)(?=\\n##+\\s|$)`, "i");
    return md.match(re)?.[1] || "";
  };

  const ingredients = [...section("Ingredients").matchAll(/^\*\s+(.+)$/gm)]
    .map((m) => m[1].replace(/\s+/g, " ").trim())
    .filter((s) => s && !/^\d+x\s*$/.test(s) && !/^Oops!/.test(s));

  const dirBlock =
    section("Directions") || section("Instructions") || section("Steps") || section("Method");
  const steps = [...dirBlock.matchAll(/^(\d+)\.\s+(.+?)(?=\n\d+\.\s|\n!\[|\n##|$)/gms)]
    .map((m) => m[2].replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const allImages = [
    ...md.matchAll(
      /(?<![\[\d ])!\[[^\]]*\]\((https?:\/\/[^)]+?\.(?:jpg|jpeg|png|webp)(?:\?[^)]*)?)\)/gi,
    ),
  ].map((m) => m[1]);
  const isLarge = (u) =>
    !/[?&](w|width)=(\d+)/.test(u) ||
    parseInt(u.match(/[?&](w|width)=(\d+)/)?.[2] || "0", 10) >= 500;
  const image = allImages.find(isLarge) || allImages[0] || null;

  const metaValue = (label) => {
    const re = new RegExp(`${label}:\\s*\\n+\\s*([^\\n]+)`, "i");
    return md.match(re)?.[1]?.trim();
  };

  if (!ingredients.length && !steps.length) return null;

  return {
    name,
    description: "",
    image,
    ingredients,
    preparationSteps: steps,
    prepTime: metaValue("Prep Time"),
    cookTime: metaValue("Cook Time"),
    servings: metaValue("Servings") || metaValue("Yield") || "",
    sourceName: new URL(url).hostname.replace(/^www\./, ""),
  };
}

function flattenInstructions(v) {
  if (!v) return [];
  if (typeof v === "string")
    return v.split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
  if (!Array.isArray(v)) v = [v];
  const out = [];
  for (const item of v) {
    if (typeof item === "string") out.push(item);
    else if (item["@type"] === "HowToSection" && item.itemListElement)
      out.push(...flattenInstructions(item.itemListElement));
    else if (item.text) out.push(item.text);
    else if (item.name) out.push(item.name);
  }
  return out;
}

// ============================================================================
// AnyListClient
// ============================================================================

export class AnyListClient {
  constructor({ email, password } = {}) {
    this.email = email ?? process.env.ANYLIST_EMAIL;
    this.password = password ?? process.env.ANYLIST_PASSWORD;
    if (!this.email || !this.password)
      throw new Error("ANYLIST_EMAIL and ANYLIST_PASSWORD must be set");
    this.any = new AnyList({ email: this.email, password: this.password });
    this.pb = this.any.protobuf;
    this.uid = null;
  }

  async login() {
    await this.any.login();
    this.uid = decodeUid(this.any.accessToken);
    return this;
  }

  async refresh() {
    await this.any.getLists();
    return this.any.lists;
  }

  getLists() {
    return this.any.lists;
  }

  async getListByName(name) {
    if (!this.any.lists?.length) await this.refresh();
    const list = this.any.getListByName(name);
    if (!list) {
      const available = (this.any.lists || []).map((l) => l.name).join(", ");
      throw new Error(`list "${name}" not found. Available: ${available || "(none)"}`);
    }
    return list;
  }

  getListByNameSync(name) {
    return this.any.getListByName(name);
  }

  teardown() {
    this.any.teardown();
  }

  // --------------------------------------------------------------------------
  // Low-level protobuf transport
  // --------------------------------------------------------------------------

  async _post(endpoint, ops) {
    const lol = new this.pb.PBListOperationList();
    lol.setOperations(ops);
    const form = new FormData();
    form.append("operations", lol.toBuffer());
    const res = await this.any.client.post(endpoint, { body: form });
    let decoded = null;
    try {
      decoded = this.pb.PBEditOperationResponse.decode(res.body);
    } catch {}
    return {
      status: res.statusCode,
      processed: decoded?.processedOperations?.length ?? 0,
      originalTs: decoded?.originalLogicalTimestamps?.[0]?.logicalTimestamp?.toString(),
      currentTs: decoded?.currentLogicalTimestamps?.[0]?.logicalTimestamp?.toString(),
      fullRefresh: (decoded?.fullRefreshTimestampIds?.length ?? 0) > 0,
    };
  }

  _op(
    handlerId,
    {
      listId, listItemId, updatedValue, originalValue, listItem,
      updatedCategory, updatedCategoryGroup, updatedCategorizationRule,
      operationClass,
    } = {},
  ) {
    const op = new this.pb.PBListOperation();
    const meta = { operationId: uuid(), handlerId, userId: this.uid };
    if (operationClass !== undefined) meta.operationClass = operationClass;
    op.setMetadata(meta);
    if (listId) op.setListId(listId);
    if (listItemId) op.setListItemId(listItemId);
    if (updatedValue !== undefined) op.setUpdatedValue(updatedValue);
    if (originalValue !== undefined) op.setOriginalValue(originalValue);
    if (listItem) op.setListItem(listItem);
    if (updatedCategory) op.setUpdatedCategory(updatedCategory);
    if (updatedCategoryGroup) op.setUpdatedCategoryGroup(updatedCategoryGroup);
    if (updatedCategorizationRule) op.setUpdatedCategorizationRule(updatedCategorizationRule);
    return op;
  }

  // --------------------------------------------------------------------------
  // List operations
  // --------------------------------------------------------------------------

  async renameList(listId, newName) {
    return this._post("data/shopping-lists/update", [
      this._op("rename-list", { listId, updatedValue: newName }),
    ]);
  }

  // --------------------------------------------------------------------------
  // Item operations
  // --------------------------------------------------------------------------

  async addItem(listName, name, { details } = {}) {
    const list = await this.getListByName(listName);
    const init = { name };
    if (details) init.details = details;
    const item = this.any.createItem(init);
    await list.addItem(item);
    return item;
  }

  async checkItem(item, checked = true) {
    item.checked = checked;
    await item.save();
    return item;
  }

  async removeItem(item) {
    const list = this.any.lists.find((l) => l.identifier === item._listId);
    await list.removeItem(item);
  }

  async setItemName(item, newName) {
    item.name = newName;
    await item.save();
    return item;
  }

  /**
   * Move an item into a category. Sends the two-op batch the web client uses:
   *   update-list-item-category-assignment + set-list-item-category-match-id
   *
   * Caller can pass just { matchKey } — the client resolves categoryGroupId
   * and categoryId from the list's existing categorization rules.
   */
  async assignItemCategory(item, opts) {
    let { matchKey, categoryGroupId, categoryId } = opts;
    if (!categoryGroupId || !categoryId) {
      const resolved = this._lookupCategoryByMatchKey(item._listId, matchKey);
      if (!resolved) {
        throw new Error(
          `No categorization rule for matchKey="${matchKey}" on list ${item._listId}. ` +
            `Create one with saveCategorizationRule() first, or pass categoryGroupId+categoryId.`,
        );
      }
      categoryGroupId = categoryGroupId || resolved.categoryGroupId;
      categoryId = categoryId || resolved.categoryId;
    }
    const assignment = new this.pb.PBListItemCategoryAssignment({
      identifier: uuid(),
      categoryGroupId,
      categoryId,
    });
    const listItem = new this.pb.ListItem({
      identifier: item.identifier,
      listId: item._listId,
      name: item.name,
      checked: !!item.checked,
      category: "other",
      categoryMatchId: matchKey,
    });
    listItem.setCategoryAssignments([assignment]);

    return this._post("data/shopping-lists/update", [
      this._op("update-list-item-category-assignment", {
        listId: item._listId,
        listItemId: item.identifier,
        listItem,
      }),
      this._op("set-list-item-category-match-id", {
        listId: item._listId,
        listItemId: item.identifier,
        originalValue: matchKey,
        listItem,
      }),
    ]);
  }

  _lookupCategoryByMatchKey(listId, matchKey) {
    const raw = this.any._userData;
    const lr = raw?.shoppingListsResponse?.listResponses?.find((r) => r.listId === listId);
    if (!lr) return null;
    const needle = (matchKey || "").toLowerCase();
    for (const rule of lr.categorizationRules || []) {
      if ((rule.itemName || "").toLowerCase() === needle) {
        return { categoryGroupId: rule.categoryGroupId, categoryId: rule.categoryId };
      }
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // Category group / category / rule operations
  // --------------------------------------------------------------------------

  async createCategoryGroup(listId, { name = "", id = uuid() } = {}) {
    const group = new this.pb.PBListCategoryGroup({
      identifier: id, listId, name, logicalTimestamp: 1,
    });
    const r = await this._post("data/shopping-lists/update-v2", [
      this._op("create-category-group", { listId, updatedCategoryGroup: group, operationClass: 4 }),
    ]);
    return { ...r, categoryGroupId: id };
  }

  async createCategory(listId, { categoryGroupId, name, id = uuid(), sortIndex = 0 } = {}) {
    const cat = new this.pb.PBListCategory({
      identifier: id, listId, categoryGroupId, name, sortIndex, logicalTimestamp: 1,
    });
    const r = await this._post("data/shopping-lists/update-v2", [
      this._op("create-category", { listId, updatedCategory: cat, operationClass: 3 }),
    ]);
    return { ...r, categoryId: id };
  }

  async renameCategory({ listId, categoryGroupId, categoryId, newName, logicalTimestamp = 3 }) {
    const cat = new this.pb.PBListCategory({
      identifier: categoryId, listId, categoryGroupId, name: newName, logicalTimestamp,
    });
    return this._post("data/shopping-lists/update-v2", [
      this._op("set-category-name", { listId, updatedCategory: cat, operationClass: 3 }),
    ]);
  }

  async saveCategorizationRule({ listId, categoryGroupId, matchKey, categoryId, id = uuid() }) {
    const rule = new this.pb.PBListCategorizationRule({
      identifier: id, listId, categoryGroupId, itemName: matchKey, categoryId,
    });
    const r = await this._post("data/shopping-lists/update-v2", [
      this._op("save-categorization-rule", { listId, updatedCategorizationRule: rule, operationClass: 5 }),
    ]);
    return { ...r, ruleId: id };
  }

  /**
   * One-shot setup: creates a category group + categories + matching rules.
   * @param {string} listName
   * @param {string} groupName
   * @param {Record<string, string>} kidMap  { matchKey: displayName }
   */
  async setupCategoryGroup(listName, groupName, kidMap) {
    const list = await this.getListByName(listName);
    const { categoryGroupId } = await this.createCategoryGroup(list.identifier, { name: groupName });
    const categories = {};
    let sortIndex = 0;
    for (const [matchKey, displayName] of Object.entries(kidMap)) {
      const { categoryId } = await this.createCategory(list.identifier, {
        categoryGroupId, name: displayName, sortIndex: sortIndex++,
      });
      categories[matchKey] = categoryId;
      await this.saveCategorizationRule({
        listId: list.identifier, categoryGroupId, matchKey, categoryId,
      });
    }
    return { listId: list.identifier, categoryGroupId, categories };
  }

  // --------------------------------------------------------------------------
  // Recipes
  // --------------------------------------------------------------------------

  async getRecipes() {
    return this.any.getRecipes();
  }

  async getRecipeByName(name) {
    if (!this.any.recipes?.length) await this.getRecipes();
    const needle = name.toLowerCase();
    return this.any.recipes.find((r) => (r.name || "").toLowerCase() === needle);
  }

  async _recipeOp(handlerId, fields) {
    if (!this.any.recipeDataId) await this.getRecipes();
    const recipe = new this.pb.PBRecipe({
      ...fields,
      identifier: fields.identifier ?? uuid(),
      timestamp: fields.timestamp ?? Math.floor(Date.now() / 1000),
    });
    const op = new this.pb.PBRecipeOperation();
    op.setMetadata({ operationId: uuid(), handlerId, userId: this.uid });
    op.setRecipeDataId(this.any.recipeDataId);
    op.setRecipe(recipe);
    const ops = new this.pb.PBRecipeOperationList();
    ops.setOperations([op]);
    const form = new FormData();
    form.append("operations", ops.toBuffer());
    const res = await this.any.client.post("data/user-recipe-data/update", { body: form });
    return { status: res.statusCode, recipeId: recipe.identifier };
  }

  /**
   * Upload raw image bytes as a recipe photo.
   * Returns the photoId (32-char hex) to pass in saveRecipe({ photoIds: [...] }).
   *
   * IMPORTANT: always call uploadPhoto BEFORE saveRecipe — the server silently
   * strips photoIds that weren't uploaded first.
   */
  async uploadPhoto(bytes, mimeType = "image/jpeg") {
    const photoId = crypto.randomUUID().replace(/-/g, "");
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const form = new FormData();
    form.append("filename", `${photoId}.jpg`);
    form.append("photo", buf, { filename: `${photoId}.jpg`, contentType: mimeType });
    const resp = await this.any.client.post("data/photos/upload", {
      body: form, throwHttpErrors: false, responseType: "buffer",
    });
    if (resp.statusCode !== 200) {
      throw new Error(`photo upload failed: ${resp.statusCode} ${resp.rawBody?.toString().slice(0, 200) || ""}`);
    }
    return photoId;
  }

  /**
   * Create or update a recipe. When updating (identifier matches an existing
   * recipe), omitted fields are auto-merged from cached state so partial
   * updates don't wipe ingredients/steps/etc.
   *
   * Array fields (ingredients, preparationSteps, photoIds) are replace-all.
   */
  async saveRecipe(fields) {
    let base = {};
    if (fields.identifier) {
      const existing = (this.any.recipes || []).find((r) => r.identifier === fields.identifier);
      if (existing) {
        base = {
          name: existing.name,
          note: existing.note,
          sourceName: existing.sourceName,
          sourceUrl: existing.sourceUrl,
          servings: existing.servings,
          prepTime: existing.prepTime,
          cookTime: existing.cookTime,
          rating: existing.rating,
          nutritionalInfo: existing.nutritionalInfo,
          scaleFactor: existing.scaleFactor,
          creationTimestamp: existing.creationTimestamp,
          ingredients: (existing.ingredients || []).map((i) => ({
            rawIngredient: i.rawIngredient, name: i.name, quantity: i.quantity, note: i.note,
          })),
          preparationSteps: [...(existing.preparationSteps || [])],
          photoIds: [...(existing.photoIds || [])],
          photoUrls: [...(existing.photoUrls || [])],
        };
      }
    }
    const merged = { ...base, ...fields };
    merged.timestamp = Date.now() / 1000;
    if (!merged.creationTimestamp) merged.creationTimestamp = merged.timestamp;
    if (merged.sourceUrl && !(merged.note || "").trim()) {
      merged.note = `Source: ${merged.sourceUrl}`;
    }
    merged.prepTime = parseMinutes(merged.prepTime);
    merged.cookTime = parseMinutes(merged.cookTime);

    const ingredients = (merged.ingredients || []).map((i) => {
      const hasSplit = i.name && (i.quantity || i.quantity === "");
      const src = hasSplit ? i : splitIngredient(i.rawIngredient ?? i.name ?? "");
      return new this.pb.PBIngredient({
        rawIngredient: i.rawIngredient ?? src.rawIngredient,
        name: i.name ?? src.name,
        quantity: i.quantity ?? src.quantity,
        note: i.note ?? src.note,
      });
    });
    return this._recipeOp("save-recipe", { ...merged, ingredients });
  }

  /**
   * Import a recipe from a URL. Parses Schema.org JSON-LD, fetches + uploads
   * the hero image, and saves the recipe.
   */
  async importRecipeFromUrl(url, overrides = {}) {
    const parsed = await fetchRecipeFromUrl(url);
    if (!parsed) throw new Error(`no Schema.org Recipe found at ${url}`);

    let photoIds = [];
    if (parsed.image) {
      try {
        const resp = await fetch(parsed.image);
        if (resp.ok) {
          const bytes = Buffer.from(await resp.arrayBuffer());
          const ct = (resp.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
          photoIds = [await this.uploadPhoto(bytes, ct)];
        }
      } catch {
        /* skip photo — don't block the import */
      }
    }

    return this.saveRecipe({
      name: parsed.name,
      note: parsed.description,
      sourceName: parsed.sourceName || new URL(url).hostname.replace(/^www\./, ""),
      sourceUrl: url,
      servings: parsed.servings,
      prepTime: parsed.prepTime,
      cookTime: parsed.cookTime,
      ingredients: parsed.ingredients.map((s) => ({ rawIngredient: s })),
      preparationSteps: parsed.preparationSteps,
      photoIds,
      ...overrides,
    });
  }

  async deleteRecipe(recipeOrId) {
    const identifier = typeof recipeOrId === "string" ? recipeOrId : recipeOrId.identifier;
    const existing = (this.any.recipes || []).find((r) => r.identifier === identifier);
    return this._recipeOp("remove-recipe", { identifier, name: existing?.name ?? "" });
  }

  // --------------------------------------------------------------------------
  // Meal plan
  // --------------------------------------------------------------------------

  async getMealEvents() {
    return this.any.getMealPlanningCalendarEvents();
  }

  getMealLabels() {
    return this.any.mealPlanningCalendarEventLabels || [];
  }

  getMealLabelByName(name) {
    const needle = name.toLowerCase();
    return this.getMealLabels().find((l) => (l.name || "").toLowerCase() === needle);
  }

  /**
   * Create or update a meal-plan event. Auto-merges on update.
   * Accepts labelName (resolved to labelId) and date as string or Date.
   */
  async saveMealEvent(opts) {
    if (!this.any.calendarId) await this.getMealEvents();

    let base = {};
    if (opts.identifier) {
      const existing = (this.any.mealPlanningCalendarEvents || []).find(
        (e) => e.identifier === opts.identifier,
      );
      if (existing) {
        base = {
          date: existing.date,
          labelId: existing.labelId,
          recipeId: existing.recipeId,
          title: existing.title,
          details: existing.details,
          recipeScaleFactor: existing.recipeScaleFactor,
        };
      }
    }
    const merged = { ...base, ...opts };

    if (!merged.labelId && opts.labelName) {
      const l = this.getMealLabelByName(opts.labelName);
      if (!l) {
        const available = this.getMealLabels().map((x) => x.name).join(", ");
        throw new Error(`meal label "${opts.labelName}" not found. Available: ${available}`);
      }
      merged.labelId = l.identifier;
    }
    if (!merged.date) throw new Error("saveMealEvent requires a date");
    const date = merged.date instanceof Date ? merged.date : new Date(merged.date);

    const ev = await this.any.createEvent({
      identifier: merged.identifier,
      date,
      labelId: merged.labelId,
      recipeId: merged.recipeId,
      title: merged.title,
      details: merged.details,
      recipeScaleFactor: merged.recipeScaleFactor,
    });
    if (merged.identifier && base.date) ev._isNew = false;
    await ev.save();
    return ev;
  }

  async deleteMealEvent(eventOrId) {
    if (!this.any.calendarId) await this.getMealEvents();
    const identifier = typeof eventOrId === "string" ? eventOrId : eventOrId.identifier;
    const existing = (this.any.mealPlanningCalendarEvents || []).find(
      (e) => e.identifier === identifier,
    );
    if (!existing) throw new Error(`meal event ${identifier} not found`);
    await existing.delete();
    return { identifier };
  }
}

export default AnyListClient;
