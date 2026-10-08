import { describe, expect, it } from "vitest";

import { cleanRecipeName } from "../src";

const OPTS = {
  useBuiltInFillerWords: true,
  extraFillerWords: "",
  keptFillerWords: "",
  defaultLanguage: "en",
  filterVeganWords: true,
  filterGlutenFreeWords: true,
};

const clean = (name: string) => cleanRecipeName(name, OPTS);

describe("cleanRecipeName", () => {
  it("strips filler and dietary words", () => {
    expect(clean("Easy Vegan Gluten-Free Dumplings")).toBe("Dumplings");
    expect(clean("The Best Homemade Pizza")).toBe("Pizza");
  });

  /**
   * Stripping the words out of a parenthetical leaves the punctuation behind,
   * and the old rule only removed a group that was empty or whitespace. So a
   * real vault note ended up titled "20 Minute Creamy Quinoa Porridge ()".
   */
  it("removes a bracketed group left with nothing meaningful in it", () => {
    expect(clean("20 Minute Creamy Quinoa Porridge (Vegan, Gluten-Free)")).toBe(
      "20 Minute Creamy Quinoa Porridge",
    );
    // The separator inside varies by site; none of them should survive.
    expect(clean("Porridge (vegan + gluten-free)")).toBe("Porridge");
    expect(clean("Soup (Dairy-Free / Vegan)")).toBe("Soup");
    expect(clean("Brownies (Easy, Healthy)")).toBe("Brownies");
    // Square and curly brackets too, which were never handled at all.
    expect(clean("Cake [Vegan]")).toBe("Cake");
    expect(clean("Cake {Vegan}")).toBe("Cake");
  });

  it("keeps a group that still says something", () => {
    expect(clean("Chili (Instant Pot)")).toBe("Chili (Instant Pot)");
    expect(clean("Pasta (Serves 4)")).toBe("Pasta (Serves 4)");
    // Only the emptied group goes; the rest of the title is untouched.
    expect(clean("Curry (Vegan) with Rice")).toBe("Curry with Rice");
  });

  it("takes the joining word with a pair of filler words", () => {
    // Stripping "quick" and "easy" one at a time left "and Soup" behind.
    expect(clean("Quick and Easy Soup")).toBe("Soup");
    expect(clean("Easy & Healthy Granola")).toBe("Granola");
    expect(clean("Simple and Delicious Banana Bread")).toBe("Banana Bread");
    // An "and" that isn't between two filler words stays.
    expect(clean("Easy Rice and Beans")).toBe("Rice and Beans");
  });

  it("leaves an ordinary title alone", () => {
    expect(clean("Plain Old Soup")).toBe("Plain Old Soup");
    expect(clean("Roasted Beet Hummus")).toBe("Roasted Beet Hummus");
  });

  it("falls back to the original when stripping removes everything", () => {
    expect(clean("Vegan")).toBe("Vegan");
    expect(clean("(Vegan)")).toBe("(Vegan)");
  });

  it("title-cases accented and apostrophe words properly", () => {
    expect(clean("ÜBERBACKENE NUDELN")).toBe("Überbackene Nudeln");
    expect(clean("MOM'S EASY PIE")).toBe("Mom's Pie");
    expect(clean("PEANUT-BUTTER COOKIES")).toBe("Peanut-Butter Cookies");
  });

  it("keeps hyphens inside a word but not ones left dangling", () => {
    expect(clean("Stir-Fried Noodles")).toBe("Stir-Fried Noodles");
    expect(clean("Chicken Tikka Masala - Easy")).toBe("Chicken Tikka Masala");
    // Stripping one half of a compound leaves its hyphen behind.
    expect(clean("Super-Moist Chocolate Cake")).toBe("Moist Chocolate Cake");
    expect(clean("Chili -- Vegan")).toBe("Chili");
  });
});

describe("cleanRecipeName in other languages", () => {
  const inLanguage = (name: string, language: string, opts = {}) =>
    cleanRecipeName(name, { ...OPTS, ...opts }, language);

  it("uses the German list for a German recipe", () => {
    expect(inLanguage("Einfacher Apfelkuchen", "de")).toBe("Apfelkuchen");
    expect(inLanguage("Der beste Käsekuchen", "de")).toBe("Käsekuchen");
    expect(inLanguage("Omas bester Bienenstich", "de")).toBe("Bienenstich");
    expect(inLanguage("Christstollen - Omas bestes Rezept", "de")).toBe("Christstollen");
    expect(inLanguage("Himbeer-Joghurt-Torte ohne Backen – super cremig!", "de")).toBe("Himbeer-Joghurt-Torte");
    expect(inLanguage("Schokotorte einfach backen", "de")).toBe("Schokotorte");
    expect(inLanguage("Kandierte Wahlnüsse Originalrezept von Oma", "de")).toBe("Kandierte Wahlnüsse");
    expect(inLanguage("Das Rezept wie von Oma für Kandierte Wahlnüsse", "de")).toBe("Kandierte Wahlnüsse");
    expect(inLanguage("Leckeres Tiramisu nach Omas Rezept", "de")).toBe("Tiramisu");
    expect(inLanguage("Puddingteilchen wie vom Bäcker", "de")).toBe("Puddingteilchen");
    expect(inLanguage("Rezept für selbstgemachtes Vanilleeis", "de")).toBe("Vanilleeis");
    expect(inLanguage("Franzbrötchen von M_Mustermann", "de")).toBe("Franzbrötchen");
    expect(inLanguage("Apfelmustorte – SO cremig & fruchtig mit Pudding", "de")).toBe("Apfelmustorte mit Pudding");
    expect(inLanguage("Kirsch-Kokos-Blechkuchen - luftig locker", "de")).toBe("Kirsch-Kokos-Blechkuchen");
    expect(inLanguage("Schwarzwälder Kirschtorte das klassische Rezept", "de")).toBe("Schwarzwälder Kirschtorte");

    expect(inLanguage("Schnelle und einfache Gemüsesuppe", "de")).toBe(
      "Gemüsesuppe",
    );
    expect(inLanguage("Vegane Lasagne (glutenfrei)", "de")).toBe("Lasagne");
  });

  it("only applies the recipe's own language", () => {
    // English words stay in a German title, and German ones in an English one.
    expect(inLanguage("Easy Apfelkuchen", "de")).toBe("Easy Apfelkuchen");
    expect(inLanguage("Einfacher Apple Pie", "en")).toBe("Einfacher Apple Pie");
    // "die" only goes as part of a German phrase, never on its own.
    expect(inLanguage("Soup You Can Die From", "en")).toBe(
      "Soup You Can Die From",
    );
  });

  it("falls back to the default language when none is given", () => {
    expect(
      cleanRecipeName("Einfacher Apfelkuchen", {
        ...OPTS,
        defaultLanguage: "de",
      }),
    ).toBe("Apfelkuchen");
  });

  it("strips only extra words in a language with no list", () => {
    expect(inLanguage("Easy Zuppa Veloce", "it")).toBe("Easy Zuppa Veloce");
    expect(
      inLanguage("Easy Zuppa Veloce", "it", { extraFillerWords: "veloce" }),
    ).toBe("Easy Zuppa");
  });

  it("uses the Spanish list for a Spanish recipe", () => {
    expect(inLanguage("Tortilla de patatas fácil", "es")).toBe(
      "Tortilla de patatas",
    );
    expect(inLanguage("Flan casero fácil y rápido", "es")).toBe("Flan");
    expect(inLanguage("La mejor receta de paella", "es")).toBe("paella");
    expect(inLanguage("Lentejas veganas sin gluten", "es")).toBe("Lentejas");
    // "rico" only goes in a pair like "fácil y rico", never on its own.
    expect(inLanguage("Arroz con pollo de Puerto Rico", "es")).toBe(
      "Arroz con pollo de Puerto Rico",
    );
  });

  it("uses the French list for a French recipe", () => {
    expect(inLanguage("Crêpes faciles et rapides", "fr")).toBe("Crêpes");
    expect(inLanguage("Le meilleur gâteau au chocolat", "fr")).toBe(
      "gâteau au chocolat",
    );
    expect(inLanguage("Burger végé sans gluten", "fr")).toBe("Burger");
    // Dish names that sound like filler stay put.
    expect(inLanguage("Moelleux au chocolat", "fr")).toBe(
      "Moelleux au chocolat",
    );
    expect(inLanguage("Crème fraîche maison", "fr")).toBe("Crème fraîche");
  });

  it("matches words that start with an umlaut", () => {
    // `\b` sees no boundary between a space and "Ü", so this used to miss.
    expect(
      inLanguage("Überbackene Nudeln", "de", {
        extraFillerWords: "überbackene",
      }),
    ).toBe("Nudeln");
    // Still whole words only: "käse" doesn't come out of "Ofenkäse".
    expect(
      inLanguage("Ofenkäse mit Brot", "de", { extraFillerWords: "käse" }),
    ).toBe("Ofenkäse mit Brot");
  });
});

describe("cleanRecipeName word settings", () => {
  it("keeps built-in words the user listed", () => {
    expect(
      cleanRecipeName("Classic Easy Lasagna", {
        ...OPTS,
        keptFillerWords: "classic",
      }),
    ).toBe("Classic Lasagna");
    // A kept phrase drops the pattern that covers it, hyphen or not.
    expect(
      cleanRecipeName("One-Pot Easy Pasta", {
        ...OPTS,
        keptFillerWords: "one pot",
      }),
    ).toBe("One-Pot Pasta");
  });

  it("adds extra words on top of the built-in list", () => {
    expect(
      cleanRecipeName("Easy Spicy Ribs", {
        ...OPTS,
        extraFillerWords: "spicy",
      }),
    ).toBe("Ribs");
  });

  it("strips nothing but extra words with the built-in list off", () => {
    expect(
      cleanRecipeName("Easy Spicy Ribs", {
        ...OPTS,
        useBuiltInFillerWords: false,
        filterVeganWords: false,
        filterGlutenFreeWords: false,
        extraFillerWords: "spicy",
      }),
    ).toBe("Easy Ribs");
  });
});
