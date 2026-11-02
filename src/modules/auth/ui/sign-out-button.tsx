"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      className="sign-out-button"
      onClick={() => signOut({ redirectTo: "/" })}
      type="button"
    >
      Sair
    </button>
  );
}
