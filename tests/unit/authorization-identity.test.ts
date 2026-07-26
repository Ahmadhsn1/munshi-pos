import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Guards the fix for a privilege-escalation bug found during Phase 6.
 *
 * A cashier never gets their own Supabase Auth session -- PIN counter-login layers a signed cookie
 * on top of an owner/manager's still-live session (see AGENTS.md). Originally only the POS routes
 * resolved that acting identity; every back-office page and route authorized against the raw
 * session instead. The consequence was that a cashier PIN'd in at the counter could navigate to
 * Staff, Purchases or Inventory and be authorized as the OWNER -- creating staff accounts,
 * adjusting stock, paying suppliers, reading every cost price. The role model only actually held
 * on the single screen the cashier was meant to be confined to.
 *
 * The fix was to make getActingUserContext() the sole authorization source across the app. This
 * test stops it regressing: getSessionUserContext() answers "whose login is this device on", never
 * "what is this person allowed to do", so any NEW use of it is a potential re-introduction of the
 * same bug and has to be added here deliberately.
 */
const SRC_DIR = join(process.cwd(), "src");

// Files legitimately needing the REAL session identity rather than the acting one.
const ALLOWED_SESSION_CONTEXT_FILES = [
  // Defines both helpers.
  join("src", "lib", "permissions.ts"),
  // Decides who is at the counter, so it cannot itself ask who is at the counter without being
  // circular. Reads only tenantId, which is identical under either identity.
  join("src", "app", "api", "auth", "counter-login", "route.ts"),
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("authorization always resolves the acting identity", () => {
  const sourceFiles = walk(SRC_DIR).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

  it("finds source files to scan", () => {
    // Guards against the walk silently returning nothing and vacuously passing everything below.
    expect(sourceFiles.length).toBeGreaterThan(20);
  });

  it("only uses getSessionUserContext in files that genuinely mean 'whose login is this'", () => {
    const offenders = sourceFiles
      .filter((file) => readFileSync(file, "utf8").includes("getSessionUserContext"))
      .map((file) => relative(process.cwd(), file))
      .filter((rel) => !ALLOWED_SESSION_CONTEXT_FILES.includes(rel.split("/").join(sep)));

    expect(
      offenders,
      "getSessionUserContext() authorizes against the OWNER's session even when a cashier is " +
        "PIN'd in at the counter. Use getActingUserContext() for permission checks, or add this " +
        "file to ALLOWED_SESSION_CONTEXT_FILES with a comment explaining why the real session " +
        "identity is what it actually needs.",
    ).toEqual([]);
  });

  it("every route handler that checks a permission resolves the acting identity", () => {
    const routeHandlers = sourceFiles.filter((f) => f.endsWith(`${sep}route.ts`));
    expect(routeHandlers.length).toBeGreaterThan(10);

    const offenders = routeHandlers
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        // A handler that gates on permissions must have resolved them from the acting identity.
        return source.includes("permissions.has(") && !source.includes("getActingUserContext");
      })
      .map((file) => relative(process.cwd(), file));

    expect(
      offenders,
      "these route handlers gate on permissions.has(...) without resolving the acting identity",
    ).toEqual([]);
  });
});
