import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/docs.tsx"),
  route("input", "routes/input.tsx"),
  route("admin", "routes/admin.tsx"),
  route("settings", "routes/settings.tsx"),
  route("my-logs", "routes/my-logs.tsx"),
  route("login", "routes/login.tsx"),
  route("selisih", "routes/selisih.tsx"),
] satisfies RouteConfig;
