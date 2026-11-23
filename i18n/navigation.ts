import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Language-aware Link, router and pathname: links keep the visitor's
 * language (/fr/...) and usePathname() returns the path without it, so
 * checks like pathname.startsWith("/dashboard") work in every language.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
