import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createBrowserRouter,
  type RouteObject,
} from "react-router-dom";
import { AuthPage } from "./auth-page";
import { OnboardingGate, OnboardingPage } from "./onboarding-page";
import { ProjectsPage } from "./projects-page";
import { ProtectedRoute, ScreenRoute } from "./screen-route";
import { notFoundScreen, routeScreens, screens } from "./screens";
import { TeamMembersPage } from "./team-members-page";

export const appRoutes: RouteObject[] = [
  ...routeScreens.map((screen) => ({
    element: <ScreenRoute screen={screen} />,
    path: screen.path,
  })),
  {
    element: <AuthPage mode="login" />,
    path: "/login",
  },
  {
    element: <AuthPage mode="register" />,
    path: "/register",
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <OnboardingPage />,
        path: "/onboarding",
      },
      {
        element: <OnboardingGate />,
        children: [
          {
            element: <ProjectsPage />,
            path: "/projects",
          },
          {
            element: <TeamMembersPage />,
            path: "/teams/:teamId/members",
          },
          {
            element: <ScreenRoute screen={screens.operator} />,
            path: "/operator",
          },
        ],
      },
    ],
  },
  {
    element: <ScreenRoute screen={notFoundScreen} />,
    path: notFoundScreen.path,
  },
];

export const createAppRouter = () => createBrowserRouter(appRoutes);

export const createAppQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 60_000,
      },
    },
  });

const defaultQueryClient = createAppQueryClient();
const defaultRouter = createAppRouter();

type AppProps = {
  readonly queryClient?: QueryClient;
  readonly router?: ReturnType<typeof createBrowserRouter>;
};

export const App = ({
  queryClient = defaultQueryClient,
  router = defaultRouter,
}: AppProps) => (
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
);
