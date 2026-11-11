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

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <nav className="flex w-44 shrink-0 flex-col gap-1 border-r bg-sidebar p-3 text-sidebar-foreground">
        <div className="px-2 pb-3 pt-1 text-lg font-semibold">studyPal</div>
        {routes.map((route) => (
          <a
            key={route.path}
            href={`#/${route.path}`}
            aria-current={route === active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
              route === active
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "hover:bg-sidebar-accent/60",
            )}
          >
            <route.icon className="size-4" />
            {route.label}
          </a>
        ))}
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <Page />
      </main>
    </div>
  );
}

export default App;
