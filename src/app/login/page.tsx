import { redirect } from "next/navigation";

// There is no login screen (SPEC 2026-09-30, section 24): old links go to the entrance.
export default function LoginPage(): never {
  redirect("/");
}
