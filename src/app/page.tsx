import { redirect } from "next/navigation";

// Middleware already sends unauthenticated visitors to /login before this ever renders; this
// just gives authenticated visitors somewhere to land when they hit "/" directly.
export default function Home() {
  redirect("/dashboard");
}
