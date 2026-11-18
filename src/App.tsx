import {
  CalendarDays,
  ChartNoAxesColumn,
  ListChecks,
  MessageSquare,
  Settings,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { CalendarPage } from "./app/CalendarPage";
import { ChatPage } from "./app/ChatPage";
import { DeadlinesPage } from "./app/DeadlinesPage";
import { ProgressPage } from "./app/ProgressPage";
import { SettingsPage } from "./app/SettingsPage";
import { TodayPage } from "./app/TodayPage";
import { cn } from "./lib/utils";
import "./index.css";

interface Route {
  path: string;
  label: string;
  icon: LucideIcon;
  page: ComponentType;
}

const routes: Route[] = [
  { path: "today", label: "今天", icon: Sun, page: TodayPage },
  { path: "calendar", label: "日程", icon: CalendarDays, page: CalendarPage },
  { path: "deadlines", label: "作业", icon: ListChecks, page: DeadlinesPage },
  { path: "chat", label: "对话", icon: MessageSquare, page: ChatPage },
  {
    path: "progress",
    label: "进度",
    icon: ChartNoAxesColumn,
    page: ProgressPage,
  },
  { path: "settings", label: "设置", icon: Settings, page: SettingsPage },
];

function currentPath(): string {
  return window.location.hash.replace(/^#\/?/, "");
}

function useHashRoute(): Route {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return routes.find((route) => route.path === path) ?? routes[0]!;
}

export function App() {
  const active = useHashRoute();
  const Page = active.page;

  const navLink = (route: Route) => (
    <a
      key={route.path}
      href={`#/${route.path}`}
      aria-current={route === active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[14px] transition-colors",
        route === active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-black/[0.04] hover:text-sidebar-foreground dark:hover:bg-white/[0.05]",
      )}
    >
      <route.icon
        className={cn(
          "size-[18px]",
          route === active ? "text-sidebar-primary" : "opacity-70",
        )}
        strokeWidth={1.75}
      />
      {route.label}
    </a>
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-sidebar-border bg-sidebar p-3 text-sidebar-foreground">
        <div className="px-2.5 pb-5 pt-2 text-[19px] font-semibold tracking-tight">
          study<span className="text-sidebar-primary">Pal</span>
        </div>
        {routes.filter((route) => route.path !== "settings").map(navLink)}
        <div className="flex-1" />
        <div className="mb-1 border-t border-sidebar-border" />
        {navLink(routes.find((route) => route.path === "settings")!)}
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto px-8 py-7">
        <Page />
      </main>
    </div>
  );
}

export default App;
