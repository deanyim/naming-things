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
];

const COLORS = [
  "red", "blue", "green", "gold", "pink", "gray", "teal", "plum",
  "jade", "rose", "sage", "rust", "sand", "lime", "mint", "navy",
  "ruby", "coal", "snow", "fawn", "onyx", "opal", "coral", "ivory",
  "amber", "azure", "blush", "cedar", "cream", "frost", "hazel",
  "lemon", "lilac", "maple", "mocha", "olive", "peach", "pearl",
  "slate", "steel", "wheat", "wine", "mauve", "bronze", "cobalt",
  "copper", "indigo", "silver", "violet",
];

const ANIMALS = [
  "fox", "owl", "cat", "dog", "elk", "bee", "ant", "bat", "cod",
  "eel", "hen", "jay", "ram", "yak", "ape", "cub", "doe", "gnu",
  "hog", "koi", "pug", "rat", "wolf", "bear", "crow", "dart",
  "frog", "goat", "hawk", "lion", "moth", "newt", "puma", "seal",
  "swan", "toad", "wren", "crane", "eagle", "finch", "horse",
  "lemur", "moose", "otter", "robin", "shark", "snake", "tiger",
  "whale", "zebra",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function generateSoloSlug(): string {
  return `${pick(ADJECTIVES)}-${pick(COLORS)}-${pick(ANIMALS)}`;
}
