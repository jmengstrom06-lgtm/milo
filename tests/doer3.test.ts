import { describe, expect, it } from "vitest";
import { parseRemember, spokenEmail } from "../src/renderer/decide";
import { pickAddress } from "../src/main/google";
import { numbersIn } from "../src/main/mathcheck";

describe("remember, right away (from Jake's log)", () => {
  it("keeps the fact", () => {
    expect(parseRemember("Milo, remember my favorite study study spot in the library is the common area.")).toBe("Their favorite study study spot in the library is the common area");
    expect(parseRemember("remember that I'm allergic to mornings")).toBe("They're allergic to mornings");
    expect(parseRemember("don't forget my roommate is Tyler")).toBe("Their roommate is Tyler");
  });
  it("skips non-facts", () => {
    expect(parseRemember("remember this")).toBeNull();
    expect(parseRemember("remember to call mom")).toBeNull();
    expect(parseRemember("do you remember what we did")).toBeNull();
  });
});

describe("spoken email addresses", () => {
  it("turns speech into an address", () => {
    expect(spokenEmail("Okay. I will say their email. The email is Mike dot Angstrom at e a dash products dot com.")).toBe("mike.angstrom@ea-products.com");
    expect(spokenEmail("it's madeleine dot orwig at tcu dot edu")).toBe("madeleine.orwig@tcu.edu");
    expect(spokenEmail("jsmith@tcu.edu")).toBe("jsmith@tcu.edu");
  });
  it("ignores normal talk", () => {
    expect(spokenEmail("I'll be at the library")).toBeNull();
    expect(spokenEmail("No. No.")).toBeNull();
  });
});

describe("finding someone's address in your mail", () => {
  const headers = ['"Madeleine Orwig" <m.orwig@tcu.edu>, Jake <jmengstrom06@gmail.com>', "Mike Armstrong <mike.armstrong@ea-products.com>", "noreply@uber.com"];
  it("matches by name", () => {
    expect(pickAddress(headers, "Madeleine Orwig")).toBe("m.orwig@tcu.edu");
    expect(pickAddress(headers, "Mike Armstrong")).toBe("mike.armstrong@ea-products.com");
  });
  it("won't guess", () => {
    expect(pickAddress(headers, "Sarah Lee")).toBe("");
  });
});

describe("math checker reads fractions as one answer", () => {
  it("4/3 is 1.333, not 4 and 3", () => {
    expect(numbersIn("E(X) = 4/3")).toEqual([4 / 3]);
    expect(numbersIn("\\frac{4}{3}")).toEqual([4 / 3]);
    expect(numbersIn("eight over six, which is 4 over 3")).toEqual([4 / 3]);
  });
});
