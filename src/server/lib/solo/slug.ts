const ADJECTIVES = [
  "brave", "calm", "dark", "eager", "fair", "glad", "happy", "keen",
  "lively", "merry", "noble", "proud", "quick", "rapid", "sharp",
  "swift", "tall", "vivid", "warm", "wild", "bold", "cool", "deft",
  "fine", "grand", "jolly", "kind", "loud", "neat", "pale", "rich",
  "slim", "soft", "true", "vast", "wise", "young", "zany", "bright",
  "crisp", "fresh", "gentle", "humble", "lucky", "mighty", "quiet",
  "smooth", "steady", "tender", "clever", "witty", "fierce", "agile",
  "blissful", "daring", "earnest", "fearless", "gleeful", "hardy",
  "jaunty", "knowing", "loving", "modest", "nimble", "plucky",
  "rugged", "serene", "thrifty", "upbeat", "valiant", "zealous",
  "ancient", "cosmic", "dreamy", "elegant", "frosty", "golden",
  "honest", "icy", "jazzy", "knotty", "lanky", "misty", "nutty",
  "odd", "peppy", "quirky", "rowdy", "snappy", "tricky", "urgent",
  "wicked", "breezy", "chunky", "dizzy", "edgy", "funky", "gritty",
  "hasty", "itchy", "jumpy", "murky", "perky", "rusty", "salty",
  "shady", "spicy", "stormy", "sunny", "tasty", "toasty", "twisted",
  "wiry", "dusty", "fluffy", "glossy", "grumpy", "husky", "leafy",
  "lumpy", "rainy", "rocky", "sandy", "silky", "smoky", "snowy",
  "thorny", "windy", "woody", "curly", "fuzzy", "hazy",
  "silent", "sleek", "slender", "stout", "sturdy", "vibrant", "regal",
  "royal", "stellar", "cheerful", "crafty", "candid", "lush", "lofty",
  "wistful", "playful", "peaceful", "graceful", "mindful", "hopeful",
  "bouncy", "bubbly", "brisk", "creamy", "dainty", "dapper", "feisty",
  "hearty", "mellow", "muddy", "pesky", "ruddy", "sassy", "savory",
  "silly", "snooty", "sparkly", "stately", "tidy", "timid", "tiny",
  "weary", "zesty", "bumpy", "chilly", "craggy", "dreary", "drowsy",
  "giddy", "nifty",
];

const COLORS = [
  "red", "blue", "green", "gold", "pink", "gray", "teal", "plum",
  "jade", "rose", "sage", "rust", "sand", "lime", "mint", "navy",
  "ruby", "coal", "snow", "fawn", "onyx", "opal", "coral", "ivory",
  "amber", "azure", "blush", "cedar", "cream", "frost", "hazel",
  "lemon", "lilac", "maple", "mocha", "olive", "peach", "pearl",
  "slate", "steel", "wheat", "wine", "mauve", "bronze", "cobalt",
  "copper", "indigo", "silver", "violet",
  "auburn", "beige", "brick", "brown", "buff", "burgundy", "butter",
  "canary", "cerise", "charcoal", "cherry", "chestnut", "chocolate",
  "clay", "coffee", "crimson", "cyan", "denim", "ebony", "emerald",
  "fern", "flame", "fuchsia", "ginger", "graphite", "honey", "khaki",
  "lavender", "magenta", "mahogany", "marigold", "midnight", "moss",
  "mustard", "ochre", "peacock", "periwinkle", "pewter", "pine",
  "poppy", "saffron", "scarlet", "seafoam", "sepia", "sky", "sorrel",
  "tangerine", "taupe", "topaz", "tulip",
];

const ANIMALS = [
  "fox", "owl", "cat", "dog", "elk", "bee", "ant", "bat", "cod",
  "eel", "hen", "jay", "ram", "yak", "ape", "cub", "doe", "gnu",
  "hog", "koi", "pug", "rat", "wolf", "bear", "crow", "dart",
  "frog", "goat", "hawk", "lion", "moth", "newt", "puma", "seal",
  "swan", "toad", "wren", "crane", "eagle", "finch", "horse",
  "lemur", "moose", "otter", "robin", "shark", "snake", "tiger",
  "whale", "zebra",
  "duck", "beaver", "badger", "boar", "bison", "camel", "cheetah",
  "chimp", "cobra", "crab", "deer", "dingo", "dolphin", "donkey",
  "falcon", "ferret", "flamingo", "gazelle", "gecko", "giraffe",
  "gopher", "hare", "hedgehog", "heron", "hippo", "hound", "iguana",
  "impala", "jackal", "jaguar", "kangaroo", "koala", "lark",
  "leopard", "llama", "lynx", "macaw", "magpie", "mole", "mouse",
  "octopus", "ostrich", "panda", "panther", "parrot", "penguin",
  "pony", "porcupine", "possum", "quail",
];

// Exported (read-only) for tests that assert list sizes and uniqueness.
export const SLUG_WORD_LISTS = {
  adjectives: ADJECTIVES as readonly string[],
  colors: COLORS as readonly string[],
  animals: ANIMALS as readonly string[],
} as const;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function generateSoloSlug(): string {
  return `${pick(ADJECTIVES)}-${pick(COLORS)}-${pick(ANIMALS)}`;
}

/**
 * Total size of the slug space: `ADJECTIVES.length * COLORS.length * ANIMALS.length`.
 * Exported so tests and ops docs can reference the ceiling.
 */
export const SOLO_SLUG_SPACE = ADJECTIVES.length * COLORS.length * ANIMALS.length;

export const SOLO_SLUG_MAX_ATTEMPTS = 10;

/**
 * Thrown when `insertWithUniqueSoloSlug` exhausts its retry budget without
 * finding an unused slug. Distinct from errors thrown inside the `attempt`
 * callback (DB failures, etc.) so callers can distinguish "we're running
 * out of slug space" from generic insert failures.
 */
export class SoloSlugExhaustedError extends Error {
  constructor(public readonly attempts: number) {
    super(
      `Failed to generate a unique solo run slug after ${attempts} attempts`,
    );
    this.name = "SoloSlugExhaustedError";
  }
}

/**
 * Retry wrapper for inserts that depend on a generated slug. Calls `attempt`
 * with a fresh slug; if it returns `null` (meaning a unique-constraint
 * conflict caught by `onConflictDoNothing`), tries again with a new slug,
 * up to `maxAttempts` times.
 *
 * Only retries on the `null` conflict signal — errors thrown inside the
 * attempt callback propagate immediately so transient DB failures aren't
 * masked as "out of slug space".
 *
 * Against a slug space of `SOLO_SLUG_SPACE` and `maxAttempts` retries, the
 * probability of exhaustion is roughly `(N / SOLO_SLUG_SPACE) ^ maxAttempts`
 * where N is the number of existing runs — negligible until the DB holds
 * a sizeable fraction of the total space.
 */
export async function insertWithUniqueSoloSlug<T>(
  attempt: (slug: string) => Promise<T | null>,
  maxAttempts: number = SOLO_SLUG_MAX_ATTEMPTS,
): Promise<T> {
  for (let i = 0; i < maxAttempts; i++) {
    const slug = generateSoloSlug();
    const result = await attempt(slug);
    if (result !== null) return result;
  }
  throw new SoloSlugExhaustedError(maxAttempts);
}
