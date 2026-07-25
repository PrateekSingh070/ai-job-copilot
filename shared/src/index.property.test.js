// Feature: typescript-to-javascript-migration, Property 3: Zod schema validation boundaries are preserved
//
// Property 3 (design.md): For any generated input to a representative migrated
// Zod schema (registerSchema, loginSchema, jobCreateSchema, jobQuerySchema), the
// schema SHALL accept the input if and only if it satisfies the schema's
// documented constraints (field presence, string length bounds, email/url format,
// enum membership), and for accepted inputs the parsed output SHALL reflect the
// schema's declared defaults and coercions.
//
// Validates: Requirements 6.3

import { test, expect } from "vitest";
import fc from "fast-check";
import {
  registerSchema,
  loginSchema,
  jobCreateSchema,
  jobQuerySchema,
} from "./index.js";

const NUM_RUNS = 100;

const JOB_STATUSES = ["APPLIED", "INTERVIEW", "OFFER", "REJECTED"];

const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const ALNUM = [...LETTERS, ..."0123456789".split("")];

// A string whose `.length` (UTF-16 code units, which is what Zod's .min/.max
// count) is guaranteed to equal the generated array length, because every
// character is a single code unit. This lets us hit exact length boundaries.
function boundedString(min, max) {
  return fc
    .array(fc.constantFrom(...ALNUM), { minLength: min, maxLength: max })
    .map((chars) => chars.join(""));
}

// A letters-only token: never contains "@" or "://", so it is guaranteed to be
// an invalid email AND an invalid URL. Used to violate format constraints.
function lettersToken(min = 1, max = 15) {
  return fc
    .array(fc.constantFrom(...LETTERS), { minLength: min, maxLength: max })
    .map((chars) => chars.join(""));
}

// Guaranteed-valid email: local@domain.tld with a 2+ char alphabetic TLD.
const validEmail = fc
  .tuple(boundedString(1, 10), lettersToken(1, 10), lettersToken(2, 4))
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

// Guaranteed-valid https URL with a dotted hostname.
const validUrl = fc
  .tuple(lettersToken(1, 10), lettersToken(2, 4))
  .map(([host, tld]) => `https://${host}.${tld}`);

// A finite, valid Date (never an Invalid Date).
const validDate = fc.date().filter((d) => !Number.isNaN(d.getTime()));

const invalidEnum = (allowed, min = 1, max = 10) =>
  lettersToken(min, max).filter((s) => !allowed.includes(s));

test("Property 3: Zod schema validation boundaries are preserved", () => {
  // ---------------------------------------------------------------------------
  // registerSchema: name 2..80, email format, password 8..128 (all required)
  // ---------------------------------------------------------------------------
  fc.assert(
    fc.property(
      boundedString(2, 80),
      validEmail,
      boundedString(8, 128),
      (name, email, password) => {
        const r = registerSchema.safeParse({ name, email, password });
        expect(r.success).toBe(true);
        // no defaults/coercions declared: output mirrors input exactly
        expect(r.data).toEqual({ name, email, password });
      },
    ),
    { numRuns: NUM_RUNS },
  );

  const invalidRegister = fc.oneof(
    fc.record({ name: boundedString(0, 1), email: validEmail, password: boundedString(8, 128) }),
    fc.record({ name: boundedString(81, 90), email: validEmail, password: boundedString(8, 128) }),
    fc.record({ name: boundedString(2, 80), email: lettersToken(1, 15), password: boundedString(8, 128) }),
    fc.record({ name: boundedString(2, 80), email: validEmail, password: boundedString(0, 7) }),
    fc.record({ name: boundedString(2, 80), email: validEmail, password: boundedString(129, 140) }),
    fc.record({ email: validEmail, password: boundedString(8, 128) }), // missing name
    fc.record({ name: boundedString(2, 80), password: boundedString(8, 128) }), // missing email
    fc.record({ name: boundedString(2, 80), email: validEmail }), // missing password
  );
  fc.assert(
    fc.property(invalidRegister, (input) => {
      expect(registerSchema.safeParse(input).success).toBe(false);
    }),
    { numRuns: NUM_RUNS },
  );

  // ---------------------------------------------------------------------------
  // loginSchema: email format, password 8..128 (all required)
  // ---------------------------------------------------------------------------
  fc.assert(
    fc.property(validEmail, boundedString(8, 128), (email, password) => {
      const r = loginSchema.safeParse({ email, password });
      expect(r.success).toBe(true);
      expect(r.data).toEqual({ email, password });
    }),
    { numRuns: NUM_RUNS },
  );

  const invalidLogin = fc.oneof(
    fc.record({ email: lettersToken(1, 15), password: boundedString(8, 128) }),
    fc.record({ email: validEmail, password: boundedString(0, 7) }),
    fc.record({ email: validEmail, password: boundedString(129, 140) }),
    fc.record({ password: boundedString(8, 128) }), // missing email
    fc.record({ email: validEmail }), // missing password
  );
  fc.assert(
    fc.property(invalidLogin, (input) => {
      expect(loginSchema.safeParse(input).success).toBe(false);
    }),
    { numRuns: NUM_RUNS },
  );

  // ---------------------------------------------------------------------------
  // jobCreateSchema: company/role required (1..120); status enum defaults to
  // "APPLIED"; jobUrl must be a valid URL; followUpAt is coerced to a Date.
  // ---------------------------------------------------------------------------
  const validJobCreate = fc.record(
    {
      company: boundedString(1, 120),
      role: boundedString(1, 120),
      jobUrl: fc.option(validUrl, { nil: undefined }),
      jobDescription: fc.option(boundedString(0, 200), { nil: undefined }),
      status: fc.option(fc.constantFrom(...JOB_STATUSES), { nil: undefined }),
      starred: fc.option(fc.boolean(), { nil: undefined }),
      followUpAt: fc.option(fc.oneof(validDate, fc.constant(null)), { nil: undefined }),
    },
    { requiredKeys: ["company", "role"] },
  );
  fc.assert(
    fc.property(validJobCreate, (input) => {
      const r = jobCreateSchema.safeParse(input);
      expect(r.success).toBe(true);
      if (!r.success) return;
      expect(r.data.company).toBe(input.company);
      expect(r.data.role).toBe(input.role);
      // declared default: status omitted/undefined -> "APPLIED"
      expect(r.data.status).toBe(input.status ?? "APPLIED");
      // declared coercion: a Date input stays a Date; null stays null
      if (input.followUpAt instanceof Date) {
        expect(r.data.followUpAt instanceof Date).toBe(true);
      } else if (input.followUpAt === null) {
        expect(r.data.followUpAt).toBeNull();
      }
    }),
    { numRuns: NUM_RUNS },
  );

  const invalidJobCreate = fc.oneof(
    fc.record({ company: fc.constant(""), role: boundedString(1, 120) }),
    fc.record({ company: boundedString(121, 130), role: boundedString(1, 120) }),
    fc.record({ company: boundedString(1, 120), role: fc.constant("") }),
    fc.record({ company: boundedString(1, 120), role: boundedString(121, 130) }),
    fc.record({ role: boundedString(1, 120) }), // missing company
    fc.record({ company: boundedString(1, 120) }), // missing role
    fc.record({
      company: boundedString(1, 120),
      role: boundedString(1, 120),
      status: invalidEnum(JOB_STATUSES),
    }),
    fc.record({
      company: boundedString(1, 120),
      role: boundedString(1, 120),
      jobUrl: lettersToken(1, 15),
    }),
  );
  fc.assert(
    fc.property(invalidJobCreate, (input) => {
      expect(jobCreateSchema.safeParse(input).success).toBe(false);
    }),
    { numRuns: NUM_RUNS },
  );

  // ---------------------------------------------------------------------------
  // jobQuerySchema: all fields optional; page coerces to a positive int
  // (default 1), pageSize coerces to an int in 1..50 (default 10); starred/status
  // are string enums.
  // ---------------------------------------------------------------------------
  const asNumberOrString = (gen) => gen.chain((n) => fc.constantFrom(n, String(n)));
  const validJobQuery = fc.record(
    {
      status: fc.option(fc.constantFrom(...JOB_STATUSES), { nil: undefined }),
      company: fc.option(boundedString(0, 120), { nil: undefined }),
      starred: fc.option(fc.constantFrom("true", "false"), { nil: undefined }),
      page: fc.option(asNumberOrString(fc.integer({ min: 1, max: 1000 })), { nil: undefined }),
      pageSize: fc.option(asNumberOrString(fc.integer({ min: 1, max: 50 })), { nil: undefined }),
    },
    { requiredKeys: [] },
  );
  fc.assert(
    fc.property(validJobQuery, (input) => {
      const r = jobQuerySchema.safeParse(input);
      expect(r.success).toBe(true);
      if (!r.success) return;
      // declared defaults + numeric coercion
      const expectedPage = input.page === undefined ? 1 : Number(input.page);
      const expectedPageSize = input.pageSize === undefined ? 10 : Number(input.pageSize);
      expect(r.data.page).toBe(expectedPage);
      expect(r.data.pageSize).toBe(expectedPageSize);
    }),
    { numRuns: NUM_RUNS },
  );

  const invalidJobQuery = fc.oneof(
    fc.record({ page: fc.constantFrom(0, -1, -5, "0", "-3") }), // not positive
    fc.record({ page: fc.constantFrom(1.5, "2.7") }), // not an integer
    fc.record({ pageSize: fc.constantFrom(0, -1, "0") }), // below min 1
    fc.record({ pageSize: fc.constantFrom(51, 100, "75") }), // above max 50
    fc.record({ pageSize: fc.constantFrom(2.5, "3.3") }), // not an integer
    fc.record({ starred: invalidEnum(["true", "false"], 1, 6) }),
    fc.record({ status: invalidEnum(JOB_STATUSES) }),
    fc.record({ company: boundedString(121, 130) }),
  );
  fc.assert(
    fc.property(invalidJobQuery, (input) => {
      expect(jobQuerySchema.safeParse(input).success).toBe(false);
    }),
    { numRuns: NUM_RUNS },
  );
});
