import { describe, expect, it } from "vitest";
import { needsYes } from "../src/main/commit";
import { parseGoogleMulti } from "../src/renderer/decide";

describe("browser safety net", () => {
  it("holds commits on calendar and mail", () => {
    expect(needsYes("Save", "https://calendar.google.com/calendar/r/eventedit")).toBe("save");
    expect(needsYes("Send", "https://mail.google.com/mail/u/0/#inbox?compose=new")).toBe("send");
    expect(needsYes("Submit quiz", "https://tcu.brightspace.com/d2l/lms/quizzing")).toBe("submit");
    expect(needsYes("Place order", "https://www.amazon.com/checkout")).toBe("place order");
  });
  it("lets normal clicks through", () => {
    expect(needsYes("Save", "https://tcu.brightspace.com/d2l/home")).toBeNull(); // not a personal site
    expect(needsYes("Create", "https://www.google.com")).toBeNull();
    expect(needsYes("How to submit assignments", "https://tcu.brightspace.com")).toBeNull(); // a help link, not a button
    expect(needsYes("Inbox", "https://mail.google.com/mail/u/0/")).toBeNull();
    expect(needsYes("", "https://mail.google.com")).toBeNull();
  });
});

describe("two questions at once", () => {
  it("splits calendar + mail (from Jake's log)", () => {
    expect(parseGoogleMulti("What's on my calendar this week, and is there any new emails?")?.map((a) => a.do)).toEqual(["calendar", "mail"]);
    expect(parseGoogleMulti("do I have any new emails and what's on my calendar tomorrow")?.map((a) => a.do)).toEqual(["mail", "calendar"]);
  });
  it("leaves single asks and actions alone", () => {
    expect(parseGoogleMulti("What's on my calendar this week?")).toBeNull();
    expect(parseGoogleMulti("add study group and dinner to my calendar")).toBeNull();
    expect(parseGoogleMulti("draft an email to Mike and check my calendar")).toBeNull();
  });
});
