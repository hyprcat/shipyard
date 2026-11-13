export type RouteSection = "public" | "authenticated" | "operator";

type NavigationItem = {
  readonly label: string;
  readonly to: string;
};

type BaseScreen = {
  readonly cta: NavigationItem;
  readonly highlights: readonly string[];
  readonly id: string;
  readonly path: string;
  readonly queryKey: readonly ["screen", string];
  readonly section: RouteSection;
  readonly summary: string;
  readonly title: string;
};

type RouteScreen = BaseScreen & {
  readonly kind: "route";
};

type NotFoundScreen = BaseScreen & {
  readonly errorCode: "ROUTE_NOT_FOUND";
  readonly kind: "not-found";
  readonly status: 404;
};

export type AppScreen = RouteScreen | NotFoundScreen;

export const sectionLabels: Record<RouteSection, string> = {
  authenticated: "Authenticated",
  operator: "Operator",
  public: "Public",
};

export const screens = {
  home: {
    cta: { label: "Create account", to: "/register" },
    highlights: [
      "Vite boots the client shell with no server-side fallback required.",
      "Public routes keep shared navigation, layout, and query hydration.",
      "Ready for marketing, docs, pricing, login, and registration views.",
    ],
    id: "home",
    kind: "route",
    path: "/",
    queryKey: ["screen", "home"],
    section: "public",
    summary:
      "Public pages plug into the same typed client shell as the rest of the product.",
    title: "Public entrypoint",
  },
  onboarding: {
    cta: { label: "Open projects", to: "/projects" },
    highlights: [
      "Authenticated routes can layer loaders, guards, and mutations later.",
      "The shell already carries route metadata through TanStack Query.",
      "Onboarding, settings, and billing can reuse the same frame.",
    ],
    id: "onboarding",
    kind: "route",
    path: "/onboarding",
    queryKey: ["screen", "onboarding"],
    section: "authenticated",
    summary:
      "Signed-in flows stay inside the same shell while swapping data and navigation state.",
    title: "Guided onboarding",
  },
  operator: {
    cta: { label: "Back to public shell", to: "/" },
    highlights: [
      "Operator routes can stay data-dense without changing client plumbing.",
      "The same router shell can host admin-only tools and dashboards.",
      "Shared navigation keeps context visible across route groups.",
    ],
    id: "operator",
    kind: "route",
    path: "/operator",
    queryKey: ["screen", "operator"],
    section: "operator",
    summary:
      "Operator surfaces share the same frame while carrying a different route group and data intent.",
    title: "Platform oversight",
  },
  pricing: {
    cta: { label: "Sign in", to: "/login" },
    highlights: [
      "Pricing can stay public while linking cleanly into authenticated flows.",
      "The router keeps a single in-app frame instead of hard route boundaries.",
      "Future plan data can hydrate through the same query client instance.",
    ],
    id: "pricing",
    kind: "route",
    path: "/pricing",
    queryKey: ["screen", "pricing"],
    section: "public",
    summary:
      "Public pricing and docs routes reuse the same shell instead of branching into a separate app.",
    title: "Plan and usage shell",
  },
  projects: {
    cta: { label: "Open operator shell", to: "/operator" },
    highlights: [
      "Projects and deployments can reuse the authenticated shell immediately.",
      "Query state is already wired for route-specific data keys.",
      "Unknown paths still stay inside the app instead of failing at the server edge.",
    ],
    id: "projects",
    kind: "route",
    path: "/projects",
    queryKey: ["screen", "projects"],
    section: "authenticated",
    summary:
      "Typed route metadata makes it easy to add project tables, filters, and deployment details next.",
    title: "Project workspace",
  },
} as const satisfies Record<string, AppScreen>;

export const notFoundScreen = {
  cta: { label: "Return home", to: "/" },
  errorCode: "ROUTE_NOT_FOUND",
  highlights: [
    "The client router stayed mounted.",
    "Navigation is still available inside the same shell.",
    "The fallback is a typed in-app 404 state.",
  ],
  id: "not-found",
  kind: "not-found",
  path: "*",
  queryKey: ["screen", "not-found"],
  section: "public",
  status: 404,
  summary:
    "An unknown route now resolves to an explicit 404 panel inside the app shell instead of a blank page.",
  title: "Route not found",
} as const satisfies AppScreen;

export const groupedNavigation: Readonly<
  Record<RouteSection, readonly NavigationItem[]>
> = {
  authenticated: [
    { label: screens.onboarding.title, to: screens.onboarding.path },
    { label: screens.projects.title, to: screens.projects.path },
  ],
  operator: [{ label: screens.operator.title, to: screens.operator.path }],
  public: [
    { label: screens.home.title, to: screens.home.path },
    { label: screens.pricing.title, to: screens.pricing.path },
  ],
};

export const routeScreens = [
  screens.home,
  screens.pricing,
] satisfies readonly RouteScreen[];
