import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectAuthForm,
  isPasswordField,
  isUsernameField,
  type AuthFieldMeta,
} from "./auth-form.ts";

function field(partial: AuthFieldMeta): AuthFieldMeta {
  return partial;
}

test("username + password form is detected as auth form", () => {
  const auth = detectAuthForm([
    field({ name: "username", type: "text" }),
    field({ name: "password", type: "password" }),
  ]);
  assert.equal(auth.isAuthForm, true);
  assert.ok(auth.username);
  assert.ok(auth.password);
});

test("password alone is not an auth form", () => {
  const auth = detectAuthForm([
    field({ name: "password", type: "password" }),
    field({ placeholder: "Search member", type: "text" }),
  ]);
  assert.equal(auth.isAuthForm, false);
});

test("email + password is an auth form", () => {
  const auth = detectAuthForm([
    field({ placeholder: "Email address", type: "email" }),
    field({ type: "password", ariaLabel: "Password" }),
  ]);
  assert.equal(auth.isAuthForm, true);
});

test("isUsernameField matches login labels", () => {
  assert.equal(isUsernameField(field({ name: "user id" })), true);
  assert.equal(isUsernameField(field({ placeholder: "Member login" })), true);
  assert.equal(isUsernameField(field({ placeholder: "Search member" })), false);
});

test("isPasswordField matches type=password and labels", () => {
  assert.equal(isPasswordField(field({ type: "password" })), true);
  assert.equal(isPasswordField(field({ ariaLabel: "Current password" })), true);
  assert.equal(isPasswordField(field({ placeholder: "Search" })), false);
});

test("member ID text does not make a search field a username field", () => {
  assert.equal(
    isUsernameField(field({ placeholder: "Search member", text: "002010" })),
    false,
  );
});
